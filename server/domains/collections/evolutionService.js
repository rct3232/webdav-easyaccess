'use strict';

/**
 * evolutionService — silent evolution triggers + the reconcile pass
 * (docs/spec/server/services/evolutionService.md §2.2/§2.3/§2.4-bis).
 *
 * Trigger surface:
 * - `armUploadTrigger(userId, { immediate })` is the ONLY upload-commit hook.
 *   It owns the per-user TRAILING-EDGE debounce (`AI_EVOLUTION_DEBOUNCE_S`);
 *   every arm re-arms the timer, a commit only happens after full receipt
 *   (multer buffers whole files), so the pass fires at batch-end. The client
 *   queue-drain hint fires the same timer with `immediate: true` — latency
 *   sugar only, never required for correctness.
 * - `armUploadTriggerForNode(nodeId)` resolves the node owner and arms it for
 *   the upload composition hook (fire-and-forget safe).
 *
 * Pass entry: `runEvolutionPass({ users, passes })` serializes per user on the
 * `evolution:user:<id>` lock and writes `admin_reports(kind='night_eval')`.
 * Every mutation is a journaled `collectionsStore` item command with
 * `actor='system'`; the pass is a compute-on-write diff of materialized rows
 * against the definition's admitted set (adds ← θ_in, removes ← θ_out,
 * hysteresis via the stored member set from collectionsService).
 *
 * As-built scope: reconcile (cheap+full), merge candidates (cheap+full) and
 * the auto-pin reconcile (full). Create/split/archive/purge are later waves;
 * their config keys are registered but unread here.
 */

/* eslint-disable no-console -- background pass logging, never throws to callers */

const collectionsStore = require('../../store/collectionsStore');
const userStore = require('../../store/userStore');
const lockManager = require('../../infrastructure/lockManager');
const definitionEngine = require('./definitionEngine');

const DEFAULT_DEBOUNCE_S = 90;
const USER_LOCK_PREFIX = 'evolution:user:';
const USER_LOCK_TTL_MS = 5 * 60 * 1000;
const DISABLED_VALUES = ['false', '0', 'off', 'no', 'disabled'];
/**
 * Merge-candidate pass (§2.8): materialized-set geometry. `sizeRatio` and
 * Jaccard are both product rules; centroid cosine is only an advisory
 * prefilter and never grounds a suggestion.
 */
const MERGE_MEMBER_CAP = 500;
const MERGE_SIZE_RATIO_MIN = 0.7;
const MERGE_JACCARD_MIN = 0.7;
const MERGE_CENTROID_PREFILTER = 0.7;
const MERGE_DISMISS_FIRST_MS = 14 * 86400000;
const MERGE_DISMISS_REPEAT_MS = 30 * 86400000;
/**
 * Upper bound of node ids per journaled item command. Mirrors the API's
 * MAX_NODE_IDS id-list bound so a large reconcile never writes an unbounded
 * journal payload; one command per (reason, chunk).
 */
const ITEM_BATCH_SIZE = 200;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Per-user debounce timers + in-flight upload passes. `running` makes a
// concurrent arm/hint a no-op (the per-user lock is the cross-replica guard).
let state = createState();

function createState() {
  return { timers: new Map(), running: new Set() };
}

/**
 * Test seam: cancel every pending debounce timer and drop in-flight markers.
 * The process-wide pass state is intentionally module-local.
 */
function __resetEvolutionStateForTests() {
  for (const timer of state.timers.values()) clearTimeout(timer);
  state = createState();
}

// ---------------------------------------------------------------------------
// Hot config reads (T2 dbOnly; resolver primed at boot)
// ---------------------------------------------------------------------------

function configValue(key) {
  try {
    const { getSharedResolver } = require('../../infrastructure/configResolver');
    return getSharedResolver().getConfigSync(key);
  } catch {
    return undefined;
  }
}

/** Unset/blank/invalid ⇒ `fallback`; explicit false-ish values ⇒ false. */
function readFlag(key, fallback = true) {
  const value = configValue(key);
  if (value === undefined || value === null || value === '') return fallback;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  return DISABLED_VALUES.includes(normalized) ? false : true;
}

function readPositiveNumber(key, fallback) {
  const value = configValue(key);
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function evolutionEnabled() {
  return readFlag('AI_EVOLUTION_ENABLED', true);
}

function uploadTriggerEnabled() {
  if (!evolutionEnabled()) return false;
  const raw = configValue('AI_EVOLUTION_TRIGGER');
  if (raw === undefined || raw === null || raw === '') return true;
  const trigger = String(raw).trim().toLowerCase();
  // Unknown values fall back to the shipped default ('both'); only the
  // explicit nightly-only mode suppresses upload arming.
  return trigger !== 'nightly';
}

function resolveDebounceMs() {
  return Math.round(readPositiveNumber('AI_EVOLUTION_DEBOUNCE_S', DEFAULT_DEBOUNCE_S) * 1000);
}

// ---------------------------------------------------------------------------
// Trigger arming (§2.2 — batch-end debounce + queue-drain hint)
// ---------------------------------------------------------------------------

function toUserId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Arm the caller's upload-batch debounce. Re-arms the per-user timer on every
 * call; `immediate` fires on the next tick instead of after the quiet period.
 * Returns whether this call started a NEW pending pass: a second arm while a
 * pass is already queued or running coalesces and returns false (the route's
 * 202 `scheduled` field). Disabled / nightly-only trigger modes return false
 * and schedule nothing.
 *
 * @param {number} userId
 * @param {{ immediate?: boolean }} [options]
 * @returns {boolean} true when a new pass was queued
 */
function armUploadTrigger(userId, { immediate = false } = {}) {
  const parsedUserId = toUserId(userId);
  if (!parsedUserId) return false;
  if (!uploadTriggerEnabled()) return false;
  if (state.running.has(parsedUserId)) return false;

  const queued = state.timers.has(parsedUserId);
  if (queued) {
    clearTimeout(state.timers.get(parsedUserId));
    state.timers.delete(parsedUserId);
  }

  const delay = immediate ? 0 : resolveDebounceMs();
  const timer = setTimeout(() => {
    state.timers.delete(parsedUserId);
    return runQueuedPass(parsedUserId);
  }, delay);
  if (timer && typeof timer.unref === 'function') timer.unref();
  state.timers.set(parsedUserId, timer);
  return !queued;
}

/**
 * Upload composition hook variant: resolve the node OWNER, then arm that
 * user's batch-end debounce. Never throws to the caller (the committed write
 * already succeeded; hook failures are logged by the composition).
 *
 * @param {number} nodeId freshly committed content node
 * @returns {Promise<boolean>} true when a new pass was queued
 */
async function armUploadTriggerForNode(nodeId) {
  const parsedNodeId = Number(nodeId);
  if (!Number.isInteger(parsedNodeId) || parsedNodeId <= 0) return false;
  const { resolveOwnerIdForNode } = require('./service');
  const ownerId = await resolveOwnerIdForNode(parsedNodeId);
  if (!ownerId) return false;
  return armUploadTrigger(ownerId);
}

/** Timer body: one cheap pass for one user under the per-user lock. */
function runQueuedPass(userId) {
  if (state.running.has(userId)) return Promise.resolve();
  state.running.add(userId);
  return runEvolutionPass({ users: [userId], passes: 'cheap' })
    .catch((error) => {
      console.error(`[evolution] upload pass failed for user ${userId}:`, error.message);
    })
    .finally(() => {
      state.running.delete(userId);
    });
}

// ---------------------------------------------------------------------------
// Pass entry (§2.3)
// ---------------------------------------------------------------------------

async function listEvolutionUserIds() {
  const users = await userStore.findAll();
  return (users || [])
    .filter((row) => row && !row.is_admin)
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Run the evolution passes for the given (or all non-admin) users.
 * @param {{ users?: number[], passes?: 'cheap'|'full' }} [scope]
 * @returns {Promise<{perUser: Array<Object>, report: Object|null, skipped?: string}>}
 */
async function runEvolutionPass({ users, passes = 'cheap' } = {}) {
  const mode = passes === 'full' ? 'full' : 'cheap';
  if (!evolutionEnabled()) {
    return { perUser: [], report: null, skipped: 'disabled' };
  }
  if (mode === 'full' && !readFlag('AI_EVOLUTION_NIGHTLY_ENABLED', true)) {
    return { perUser: [], report: null, skipped: 'nightly_disabled' };
  }

  const requested = Array.isArray(users) && users.length > 0 ? users : await listEvolutionUserIds();
  const userIds = [
    ...new Set(requested.map(toUserId).filter((id) => id !== null && Number.isInteger(id))),
  ];

  const perUser = [];
  for (const userId of userIds) {
    perUser.push(await runUserPass(userId, mode));
  }
  const report = await writeNightEvalReport(mode, perUser);
  return { perUser, report };
}

async function runUserPass(userId, mode = 'cheap') {
  let lock = null;
  try {
    lock = await lockManager.acquireLock(`${USER_LOCK_PREFIX}${userId}`, {
      ttlMs: USER_LOCK_TTL_MS,
      waitMs: 0,
    });
  } catch (error) {
    if (error && error.code === 'LOCK_TIMEOUT') {
      return { userId, skipped: 'locked' };
    }
    console.error(`[evolution] user lock failed for ${userId}:`, error.message);
    return { userId, error: error.message };
  }
  try {
    const reconciled = await reconcileUser(userId);
    const mergeCandidates = await runMergeCandidatePass(userId);
    // Auto-pin reconcile is nightly-only (§2.9 / §2.3 pass dispatch).
    const pinned = mode === 'full' ? await reconcileAutoPinUser(userId) : null;
    return { userId, reconciled, mergeCandidates, pinned, arbiterCalls: 0 };
  } catch (error) {
    console.error(`[evolution] reconcile failed for user ${userId}:`, error.message);
    return { userId, error: error.message };
  } finally {
    try {
      await lock.release();
    } catch {
      /* best effort — the TTL reclaims a leaked lock row */
    }
  }
}

/**
 * Report row: `admin_reports(kind='night_eval')` with the per-user reconcile
 * summary (best-effort — a writer failure never fails the pass).
 */
async function writeNightEvalReport(passes, perUser) {
  const totals = perUser.reduce(
    (acc, entry) => {
      acc.users += 1;
      if (entry && entry.reconciled) {
        acc.reconciled_users += 1;
        acc.added += entry.reconciled.added;
        acc.removed += entry.reconciled.removed;
        acc.collections += entry.reconciled.collections;
      }
      if (entry && entry.mergeCandidates) {
        acc.merge_suggested += entry.mergeCandidates.suggested ?? 0;
        acc.merge_reopened += entry.mergeCandidates.reopened ?? 0;
      }
      if (entry && entry.pinned) {
        acc.auto_pins_cleared += entry.pinned.cleared ?? 0;
      }
      return acc;
    },
    {
      users: 0,
      reconciled_users: 0,
      added: 0,
      removed: 0,
      collections: 0,
      merge_suggested: 0,
      merge_reopened: 0,
      auto_pins_cleared: 0,
    }
  );
  const payload = { passes, perUser, totals };
  try {
    const { getAdminReportsWriter } = require('../../domains/admin/services/adminReportsService');
    await getAdminReportsWriter().writeReport({ kind: 'night_eval', status: 'ok', payload });
  } catch (error) {
    console.error('[evolution] night_eval report failed:', error.message);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Reconcile pass (§2.4-bis — materialized membership diff)
// ---------------------------------------------------------------------------

/**
 * Reconcile every ACTIVE definition-driven collection the user owns. Manual
 * (`origin='user'`) rows without an evaluable definition are skipped by
 * construction; `{kind:'search'}` snapshot definitions are not evaluable and
 * are skipped by `hasDefinition` too.
 */
async function reconcileUser(userId) {
  const { evaluateDefinitionMembership } = require('./service');
  const owned = (await collectionsStore.listForUser(userId, { status: 'active' })).filter(
    (row) => row.ownerId === Number(userId) && definitionEngine.hasDefinition(row.definition)
  );

  const summary = { added: 0, removed: 0, collections: 0 };
  for (const collection of owned) {
    const diff = await reconcileCollection({ evaluateDefinitionMembership }, userId, collection);
    summary.added += diff.added;
    summary.removed += diff.removed;
    if (diff.added > 0 || diff.removed > 0) summary.collections += 1;
  }
  return summary;
}

async function reconcileCollection({ evaluateDefinitionMembership }, userId, collection) {
  const stored = await collectionsStore.listStoredItems(collection.id);
  const storedByNodeId = new Map(stored.map((row) => [Number(row.nodeId), row]));
  const previousMembers = new Set(storedByNodeId.keys());

  const admitted = await evaluateDefinitionMembership(userId, collection.definition, {
    previousMembers,
    collectionId: collection.id,
  });

  // Additions grouped by matched reason: one journaled command per reason.
  const additionsByReason = new Map();
  for (const [nodeId, reason] of admitted) {
    if (storedByNodeId.has(nodeId)) continue;
    const matched = reason || 'similar';
    if (!additionsByReason.has(matched)) additionsByReason.set(matched, []);
    additionsByReason.get(matched).push(nodeId);
  }

  // Automatic removals delete the row ONLY — never an exclusion, so a later
  // score above θ_in can re-admit the node. Manual rows are never removed.
  const removals = stored
    .filter((row) => row.source !== 'manual' && !admitted.has(Number(row.nodeId)))
    .map((row) => Number(row.nodeId));

  let added = 0;
  for (const [reason, nodeIds] of additionsByReason) {
    for (const batch of chunk(nodeIds, ITEM_BATCH_SIZE)) {
      const result = await collectionsStore.addItems(
        collection.id,
        batch,
        userId,
        {
          published: collection.publishMode === 'auto',
          source: 'system',
          reason,
        },
        { actor: 'system' }
      );
      added += result.added.length;
    }
  }

  let removed = 0;
  for (const batch of chunk(removals, ITEM_BATCH_SIZE)) {
    const result = await collectionsStore.removeItems(
      collection.id,
      { storedNodeIds: batch },
      { actor: 'system' }
    );
    removed += result.removed.length;
  }

  return { added, removed };
}

// ---------------------------------------------------------------------------
// Pass 5 — merge candidates on MATERIALIZED sets (§2.8)
// ---------------------------------------------------------------------------

function pairKey(aId, bId) {
  return `${Math.min(Number(aId), Number(bId))}:${Math.max(Number(aId), Number(bId))}`;
}

function parseCentroid(raw) {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return null;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mergeGeometry(a, b) {
  if (a.size === 0 || b.size === 0) return null;
  const intersection = countIntersection(a, b);
  const union = a.size + b.size - intersection;
  const sizeRatio = Math.min(a.size, b.size) / Math.max(a.size, b.size);
  const jaccard = union === 0 ? 0 : intersection / union;
  if (sizeRatio < MERGE_SIZE_RATIO_MIN || jaccard < MERGE_JACCARD_MIN) return null;
  return { sizeRatio, jaccard };
}

function countIntersection(a, b) {
  let count = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (large.has(id)) count += 1;
  return count;
}

function dismissedDue(row, now) {
  if (!row.dismissedAt) return false;
  const dismissedAt = new Date(row.dismissedAt).getTime();
  if (!Number.isFinite(dismissedAt)) return false;
  const delay =
    Number(row.dismissCount ?? 0) >= 2 ? MERGE_DISMISS_REPEAT_MS : MERGE_DISMISS_FIRST_MS;
  return now - dismissedAt >= delay;
}

/**
 * Cheap pass: propose merges from materialized membership only. Scope =
 * same-owner ACTIVE pairs where at least one side is `origin='system'`.
 * `sizeRatio ≥ 0.7 AND jaccard ≥ 0.7` are the product rules; centroid cosine
 * (when both rows have one in the active embed space) is an advisory
 * prefilter, never grounds for a card. Rejected rows stay terminal because
 * `upsertMergeSuggestion` preserves an existing row/state; dismissed rows are
 * re-raised once due (+14d after the first dismiss, +30d thereafter).
 */
async function runMergeCandidatePass(userId) {
  if (!readFlag('AI_MERGE_SUGGESTIONS_ENABLED', true)) {
    return { suggested: 0, reopened: 0, pairs: 0, prefiltered: 0 };
  }
  const owned = (await collectionsStore.listForUser(userId, { status: 'active' })).filter(
    (row) => row.ownerId === Number(userId)
  );
  if (owned.length < 2) return { suggested: 0, reopened: 0, pairs: 0, prefiltered: 0 };

  const memberSets = new Map();
  for (const collection of owned) {
    const rows = await collectionsStore.listStoredItems(collection.id);
    memberSets.set(
      collection.id,
      new Set(rows.slice(0, MERGE_MEMBER_CAP).map((row) => Number(row.nodeId)))
    );
  }

  // Advisory centroid prefilter (never a gate): count pairs whose centroid
  // cosine is already high; the materialized-set rule below is authoritative.
  let prefiltered = 0;
  const centroidVectors = await loadActiveCentroids(owned.map((row) => row.id));

  const collectionIds = owned.map((row) => row.id);
  const dismissedRows = await collectionsStore.listMergeSuggestions(collectionIds, {
    state: 'dismissed',
  });
  const dismissedByPair = new Map(dismissedRows.map((row) => [pairKey(row.aId, row.bId), row]));

  const now = Date.now();
  let suggested = 0;
  let reopened = 0;
  let pairs = 0;
  for (let i = 0; i < owned.length; i += 1) {
    for (let j = i + 1; j < owned.length; j += 1) {
      const a = owned[i];
      const b = owned[j];
      if (a.origin !== 'system' && b.origin !== 'system') continue;

      const aSet = memberSets.get(a.id);
      const bSet = memberSets.get(b.id);
      const geometry = mergeGeometry(aSet, bSet);
      if (!geometry) continue;
      pairs += 1;

      const cosineScore = cosine(
        centroidVectors.get(a.id) || null,
        centroidVectors.get(b.id) || null
      );
      if (cosineScore !== null && cosineScore >= MERGE_CENTROID_PREFILTER) prefiltered += 1;

      const score = Math.round(geometry.jaccard * 1000);
      const existing = dismissedByPair.get(pairKey(a.id, b.id));
      if (existing) {
        if (!dismissedDue(existing, now)) continue;
        const result = await collectionsStore.reopenMergeSuggestion(existing.id, { score });
        if (result.changes > 0) reopened += 1;
        continue;
      }
      const row = await collectionsStore.upsertMergeSuggestion(a.id, b.id, score);
      if (row && row.state === 'pending') suggested += 1;
    }
  }
  return { suggested, reopened, pairs, prefiltered };
}

async function loadActiveCentroids(collectionIds) {
  const map = new Map();
  try {
    const llmModelsStore = require('../../store/llmModelsStore');
    const active = await llmModelsStore.getActiveByRole('embed');
    if (!active) return map;
    const rows = await collectionsStore.getCentroids(collectionIds, Number(active.id));
    for (const row of rows || []) {
      const vector = parseCentroid(row.centroid);
      if (vector) map.set(Number(row.collectionId), vector);
    }
  } catch {
    // prefilters are advisory only; absence never blocks the set rule
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pass 6 — auto-pin touch-taxonomy reconcile (§2.9)
// ---------------------------------------------------------------------------

/**
 * Nightly idempotent reconcile: `pinned_by='auto'` is legal ONLY on
 * `origin='system'` rows whose pin flag is set. Illegal auto pins are cleared
 * (non-journaled, like the pin itself); `pinned_by='user'` is never touched.
 */
async function reconcileAutoPinUser(userId) {
  const owned = (await collectionsStore.listForUser(userId, { status: 'all' })).filter(
    (row) => row.ownerId === Number(userId)
  );
  let cleared = 0;
  for (const collection of owned) {
    if (collection.pinnedBy !== 'auto') continue;
    if (collection.origin === 'system' && collection.pinned) continue;
    const result = await collectionsStore.clearAutoPin(collection.id);
    cleared += result.changes;
  }
  return { cleared };
}

module.exports = {
  armUploadTrigger,
  armUploadTriggerForNode,
  runEvolutionPass,
  __resetEvolutionStateForTests,
};
