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
 * As-built scope: the reconcile pass only. Create/split/merge/auto-pin are
 * later waves; their config keys are registered but unread here.
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
    perUser.push(await runUserPass(userId));
  }
  const report = await writeNightEvalReport(mode, perUser);
  return { perUser, report };
}

async function runUserPass(userId) {
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
    return { userId, reconciled };
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
      return acc;
    },
    { users: 0, reconciled_users: 0, added: 0, removed: 0, collections: 0 }
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

module.exports = {
  armUploadTrigger,
  armUploadTriggerForNode,
  runEvolutionPass,
  __resetEvolutionStateForTests,
};
