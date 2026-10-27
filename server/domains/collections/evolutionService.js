'use strict';

/**
 * evolutionService — silent evolution triggers + the create/reconcile passes
 * (docs/spec/server/services/evolutionService.md §2.2/§2.3/§2.4/§2.4-bis).
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
 * As-built scope: create + split + reconcile + merge candidates (cheap+full,
 * incl. the nightly merge-arbiter adjudication of the 0.55–0.7 review band —
 * full leg only); the full leg additionally runs the auto-pin reconcile, the
 * archive pass (§2.6) and the purge pass (§2.7). Cheap passes never archive,
 * purge or call the arbiter.
 */

/* eslint-disable no-console -- background pass logging, never throws to callers */

const collectionsStore = require('../../store/collectionsStore');
const userStore = require('../../store/userStore');
const embeddingsStore = require('../../store/embeddingsStore');
const llmModelsStore = require('../../store/llmModelsStore');
const fileLikesStore = require('../../store/fileLikesStore');
const usageStore = require('../../store/usageStore');
const aiTagStore = require('../../store/aiTagStore');
const aiEnrichmentsStore = require('../../store/aiEnrichmentsStore');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const permissionStore = require('../../domains/permissions/stores/permissionStore');
const lockManager = require('../../infrastructure/lockManager');
const { getPresetByFamilyRole } = require('../../infrastructure/adapters/llm/presets');
const definitionEngine = require('./definitionEngine');
const { createNamer } = require('./namingService');
const { createMergeArbiter, MERGE_ARBITER_MAX_PAIRS } = require('./mergeArbiter');

const DEFAULT_DEBOUNCE_S = 90;
const USER_LOCK_PREFIX = 'evolution:user:';
const USER_LOCK_TTL_MS = 5 * 60 * 1000;
const DISABLED_VALUES = ['false', '0', 'off', 'no', 'disabled'];
/**
 * Create pass (evolutionService.md §2.4): product gates + per-model profile
 * tiers. Tier edge cosines come from `profile.edgeCos`; the literals are the
 * documented fallbacks for a profile without finite values.
 */
const CREATE_MIN_MEMBERS = 8;
const CREATE_K = 6;
const CREATE_PERSISTENCE_DAYS = 14;
const CREATE_ACTIVE_LIMIT = 12;
const CREATE_SIZE_CAPS = { tight: 120, mid: 120, loose: 500 };
const CREATE_JACCARD_MIN = 0.8;
const CREATE_PATH_PURITY_MIN = 0.8;
const CREATE_LIKE_DENSITY_MIN = 0.5;
const CREATE_TIER_DEFAULTS = { tight: 0.82, mid: 0.8, loose: 0.72 };
const CREATE_TIERS = ['tight', 'mid', 'loose'];
const CREATE_TAG_SCAN_LIMIT = 50;

/**
 * Split pass (evolutionService.md §2.5): the hot subset reuses the create
 * gates — min members, tier size caps, Jaccard/tombstone suppression, the
 * create rate window and the active-count limits. Persistence is deliberately
 * NOT re-applied: activity IS the trigger, so fresh hot content must not be
 * blocked by the two-week cluster-age rule. The sibling's initial rows carry
 * this reason prefix plus the parent id (stable across renames).
 */
const SPLIT_REASON_PREFIX = 'split:';

/**
 * Merge-candidate pass (§2.8): materialized-set geometry. `sizeRatio` and
 * Jaccard are both product rules; centroid cosine is only an advisory
 * prefilter and never grounds a suggestion.
 */
const MERGE_MEMBER_CAP = 500;
const MERGE_SIZE_RATIO_MIN = 0.7;
const MERGE_JACCARD_MIN = 0.7;
/** Review band 0.55–0.7 (§2.8): rows are created ONLY via an arbiter verdict. */
const MERGE_BAND_JACCARD_MIN = 0.55;
const MERGE_CENTROID_PREFILTER = 0.7;
const MERGE_DISMISS_FIRST_MS = 14 * 86400000;
const MERGE_DISMISS_REPEAT_MS = 30 * 86400000;
/** ≤5 sampled member summaries per side in the arbiter prompt (§4.19). */
const MERGE_ARBITER_SAMPLE_CAP = 5;

/**
 * Archive/purge passes (§2.6/§2.7). The gate is EVENT-based with ε=0: a
 * system collection survives while ANY member has positive usage inside the
 * `AI_EVOLUTION_INACTIVE_DAYS` window, read from the lifetime
 * `node_activity.last_seen_at` column (raw-event retention never corrupts the
 * gate). Min-age is a grace window on the collection's own `created_at`.
 * Purge keys on `archived_at` past `ARCHIVE_RETENTION_DAYS` and is
 * unrecoverable by design (trash-parity, no inverse).
 */
const ARCHIVE_INACTIVE_DAYS_DEFAULT = 30;
const ARCHIVE_MIN_AGE_DAYS_DEFAULT = 14;
const ARCHIVE_RETENTION_DAYS_DEFAULT = 30;
const DAY_MS = 86400000;
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
    const created = await runCreatePass(userId);
    const split = await runSplitPass(userId);
    const mergeCandidates = await runMergeCandidatePass(userId, {
      arbiterLeg: mode === 'full',
    });
    // Full-leg-only passes (§2.3): auto-pin reconcile precedes archive so a
    // pin lost between nightlies is honored before the gate evaluates; cheap
    // passes never archive or purge.
    const pinned = mode === 'full' ? await reconcileAutoPinUser(userId) : null;
    const archived = mode === 'full' ? await runArchivePass(userId) : null;
    const purged = mode === 'full' ? await runPurgePass(userId) : null;
    return {
      userId,
      reconciled,
      created,
      split,
      mergeCandidates,
      pinned,
      archived,
      purged,
      arbiterCalls: mergeCandidates.arbiterCalls ?? 0,
    };
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
      if (entry && entry.created) {
        acc.created += entry.created.created.length;
        acc.create_promoted += entry.created.promoted;
        acc.create_suppressed += entry.created.suppressed;
      }
      if (entry && entry.mergeCandidates) {
        acc.merge_suggested += entry.mergeCandidates.suggested ?? 0;
        acc.merge_reopened += entry.mergeCandidates.reopened ?? 0;
        acc.arbiter_calls += entry.mergeCandidates.arbiterCalls ?? 0;
        acc.arbiter_suggested += entry.mergeCandidates.arbiterSuggested ?? 0;
      }
      if (entry && entry.split) {
        acc.split_created += entry.split.created.length;
        acc.split_promoted += entry.split.promoted;
        acc.split_suppressed += entry.split.suppressed;
      }
      if (entry && entry.pinned) {
        acc.auto_pins_cleared += entry.pinned.cleared ?? 0;
      }
      if (entry && entry.archived) {
        acc.archived += entry.archived.archived ?? 0;
      }
      if (entry && entry.purged) {
        acc.purged += entry.purged.purged ?? 0;
      }
      return acc;
    },
    {
      users: 0,
      reconciled_users: 0,
      added: 0,
      removed: 0,
      collections: 0,
      created: 0,
      create_promoted: 0,
      create_suppressed: 0,
      merge_suggested: 0,
      merge_reopened: 0,
      arbiter_calls: 0,
      arbiter_suggested: 0,
      split_created: 0,
      split_promoted: 0,
      split_suppressed: 0,
      auto_pins_cleared: 0,
      archived: 0,
      purged: 0,
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
// Pass 1 — create (multi-tier mutual-kNN + facets, LLM-free candidates)
// ---------------------------------------------------------------------------

function emptyCreateResult() {
  return { created: [], promoted: 0, suppressed: 0 };
}

function createEnabled() {
  return evolutionEnabled() && readFlag('AI_EVOLUTION_CREATE_ENABLED', true);
}

function createRateDays() {
  return readPositiveNumber('AI_EVOLUTION_CREATE_RATE_DAYS', 7);
}

function parseEmbeddingVector(value) {
  if (Array.isArray(value)) {
    const out = value.map(Number);
    return out.length > 0 && out.every((n) => Number.isFinite(n)) ? out : null;
  }
  if (typeof value !== 'string' || value.length === 0) return null;
  const out = value.split(',').map(Number);
  return out.length > 0 && out.every((n) => Number.isFinite(n)) ? out : null;
}

/** Per-tier edge cosines from the ACTIVE model preset; finite values win. */
function resolveTierThresholds(model) {
  const preset = getPresetByFamilyRole(model.provider, 'embed');
  const profileEdge = preset && preset.profile && preset.profile.edgeCos;
  const thresholds = {};
  for (const tier of CREATE_TIERS) {
    const raw = profileEdge ? Number(profileEdge[tier]) : NaN;
    thresholds[tier] = Number.isFinite(raw) && raw > 0 ? raw : CREATE_TIER_DEFAULTS[tier];
  }
  return thresholds;
}

/**
 * Requester-visible node map: own-root subtree + path/point grants (the
 * collectionsService §2.3 candidate rule). Directories are retained so path
 * facets and event classes can resolve ancestors.
 */
async function loadVisibleNodeMap(userId) {
  const fileNodesStore = createFileNodesStore();
  const nodesById = new Map();
  const root = await fileNodesStore.getUserRootNode(userId);
  if (root) {
    nodesById.set(Number(root.id), root);
    for (const row of (await fileNodesStore.getDescendants(root.id)) || []) {
      nodesById.set(Number(row.id), row);
    }
  }
  const grants = await permissionStore.getUserPermissions(userId);
  for (const grant of grants || []) {
    const nodeId = Number(grant.file_node_id);
    if (!nodeId) continue;
    if (grant.type === 'path') {
      const folder = await fileNodesStore.getNode(nodeId);
      if (!folder) continue;
      nodesById.set(Number(folder.id), folder);
      for (const row of (await fileNodesStore.getDescendants(folder.id)) || []) {
        nodesById.set(Number(row.id), row);
      }
    } else {
      const node = await fileNodesStore.getNode(nodeId);
      if (node) nodesById.set(Number(node.id), node);
    }
  }
  return { fileNodesStore, nodesById, root };
}

/**
 * Pooled corpus of the active model intersected with the requester-visible
 * live file set. `contentHash` comes from the pooled row, with `filecache` as
 * the fallback for rows enqueued before the hash backfill.
 */
async function loadPooledCorpus(userId, modelId) {
  const { fileNodesStore, nodesById, root } = await loadVisibleNodeMap(userId);
  const rows = await embeddingsStore.listAll(modelId);
  const entries = [];
  for (const row of rows || []) {
    const nodeId = Number(row.nodeId);
    const node = nodesById.get(nodeId);
    if (!node || node.type !== 'file' || node.deletedAt) continue;
    const vector = parseEmbeddingVector(row.vector);
    if (!vector) continue;
    entries.push({
      nodeId,
      node,
      vector,
      contentHash: row.contentHash ? String(row.contentHash) : null,
    });
  }
  entries.sort((a, b) => a.nodeId - b.nodeId);
  for (const entry of entries) {
    if (entry.contentHash) continue;
    const cache = await fileNodesStore.getCache(entry.nodeId);
    const hash = cache && cache.content_hash != null ? String(cache.content_hash) : '';
    entry.contentHash = hash || null;
  }
  return { nodesById, root, entries };
}

/**
 * content_hash dedup pre-pass: identical-content twins never join a cluster.
 * NULL hashes pass through; a non-null group keeps its lowest node id as the
 * deterministic representative.
 */
function dedupeContentTwins(entries) {
  const byHash = new Map();
  for (const entry of entries) {
    if (!entry.contentHash) continue;
    if (!byHash.has(entry.contentHash)) byHash.set(entry.contentHash, []);
    byHash.get(entry.contentHash).push(entry);
  }
  const twins = new Set();
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.nodeId - b.nodeId);
    for (let i = 1; i < group.length; i += 1) twins.add(group[i].nodeId);
  }
  return entries.filter((entry) => !twins.has(entry.nodeId));
}

function jaccardSets(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (large.has(id)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function nodePath(node, nodesById) {
  const segments = [];
  let current = node;
  const seen = new Set();
  while (current && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    segments.unshift(String(current.name));
    current = current.parentId == null ? null : nodesById.get(Number(current.parentId));
  }
  return `/${segments.join('/')}`;
}

/** Dominant top-level directory beneath the user root (loose-tier identity). */
function eventClassFor(node, nodesById, rootId) {
  if (!node || node.parentId == null) return 'root';
  const topLevel = (row) => {
    if (!row || Number(row.id) === Number(rootId)) return 'root';
    return String(row.name).trim().toLowerCase() || 'root';
  };
  if (Number(node.parentId) === Number(rootId)) {
    return node.type === 'directory' ? topLevel(node) : 'root';
  }
  let current = node;
  const seen = new Set();
  while (current && current.parentId != null && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    if (Number(current.parentId) === Number(rootId)) return topLevel(current);
    current = nodesById.get(Number(current.parentId));
  }
  return 'root';
}

function dominantEventClass(memberIds, entriesByNodeId, nodesById, rootId) {
  const counts = new Map();
  for (const nodeId of memberIds) {
    const entry = entriesByNodeId.get(nodeId);
    if (!entry) continue;
    const eventClass = eventClassFor(entry.node, nodesById, rootId);
    counts.set(eventClass, (counts.get(eventClass) || 0) + 1);
  }
  let best = 'root';
  let bestCount = -1;
  for (const [eventClass, count] of counts) {
    if (count > bestCount || (count === bestCount && eventClass < best)) {
      best = eventClass;
      bestCount = count;
    }
  }
  return best;
}

function systemDefinition(tier, theta, eventClass) {
  return {
    kind: 'centroid',
    centroid_ref: null,
    theta,
    tier,
    event_class: eventClass,
  };
}

/** Pairwise pooled cosine adjacency, kept only at/above the loosest tier. */
function buildNeighborScores(entries, minThreshold) {
  const byNode = new Map(entries.map((entry) => [entry.nodeId, []]));
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      const score = definitionEngine.cosineSimilarity(a.vector, b.vector);
      if (score == null || score < minThreshold) continue;
      byNode.get(a.nodeId).push({ nodeId: b.nodeId, score });
      byNode.get(b.nodeId).push({ nodeId: a.nodeId, score });
    }
  }
  return byNode;
}

/**
 * One tier's components over either-side top-k edges. Mutual-kNN means an edge
 * survives when at least one endpoint ranks the other inside its k nearest
 * above the tier threshold — connected components must not chain arbitrary
 * cosine chains (only local neighborhoods bind them).
 */
function tierComponents(entries, neighborScores, threshold, k) {
  const parent = new Map(entries.map((entry) => [entry.nodeId, entry.nodeId]));
  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)));
      current = parent.get(current);
    }
    return current;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const entry of entries) {
    const neighbors = (neighborScores.get(entry.nodeId) || [])
      .filter((neighbor) => neighbor.score >= threshold)
      .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.nodeId - b.nodeId))
      .slice(0, k);
    for (const neighbor of neighbors) union(entry.nodeId, neighbor.nodeId);
  }

  const components = new Map();
  for (const entry of entries) {
    const root = find(entry.nodeId);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(entry.nodeId);
  }
  return [...components.values()]
    .filter((memberIds) => memberIds.length > 1)
    .map((memberIds) => memberIds.sort((a, b) => a - b));
}

function buildEmbeddingCandidates(entries, nodesById, root, thresholds) {
  const entriesByNodeId = new Map(entries.map((entry) => [entry.nodeId, entry]));
  const minThreshold = Math.min(...CREATE_TIERS.map((tier) => thresholds[tier]));
  const neighborScores = buildNeighborScores(entries, minThreshold);
  const selected = [];
  const seenSets = [];
  let deduped = 0;

  for (const tier of CREATE_TIERS) {
    const components = tierComponents(entries, neighborScores, thresholds[tier], CREATE_K).sort(
      (a, b) => (b.length !== a.length ? b.length - a.length : a[0] - b[0])
    );
    for (const memberIds of components) {
      const memberSet = new Set(memberIds);
      if (seenSets.some((seen) => jaccardSets(seen, memberSet) >= CREATE_JACCARD_MIN)) {
        deduped += 1;
        continue;
      }
      seenSets.push(memberSet);
      const eventClass = dominantEventClass(memberIds, entriesByNodeId, nodesById, root.id);
      const theta = thresholds[tier];
      selected.push({
        source: 'cluster',
        tier,
        theta,
        memberIds,
        memberSet,
        eventClass,
        definition: systemDefinition(tier, theta, eventClass),
        reason: 'similar',
        nameInput: { kind: 'system', tags: [], parentName: null },
      });
    }
  }
  return { candidates: selected, deduped };
}

/**
 * Facet candidates (deterministic, LLM-free):
 * - path-subtree purity: a non-root directory with ≥8 eligible embedded
 *   direct-child files whose direct files are ≥80% of its eligible subtree;
 *   members = those direct files.
 * - like density: a non-root directory subtree with ≥8 liked eligible files
 *   and liked/subtree density ≥0.5; members = the liked files.
 * Both become self-centroid definitions (the snapshot is the initial batch;
 * later membership is similarity-scored). Path facets use the mid tier;
 * like-density facets use the mid tier and waive persistence.
 */
function buildFacetCandidates({ entries, nodesById, root, likes, thresholds }) {
  const subtreeCount = new Map();
  const directByDir = new Map();
  const likedByDir = new Map();

  for (const entry of entries) {
    const parentId = entry.node.parentId == null ? null : Number(entry.node.parentId);
    if (parentId != null) {
      if (!directByDir.has(parentId)) directByDir.set(parentId, []);
      directByDir.get(parentId).push(entry.nodeId);
    }
    let current = parentId == null ? null : nodesById.get(parentId);
    const seen = new Set();
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      const dirId = Number(current.id);
      subtreeCount.set(dirId, (subtreeCount.get(dirId) || 0) + 1);
      if (likes.has(entry.nodeId)) {
        if (!likedByDir.has(dirId)) likedByDir.set(dirId, new Set());
        likedByDir.get(dirId).add(entry.nodeId);
      }
      current = current.parentId == null ? null : nodesById.get(Number(current.parentId));
    }
  }

  const directories = [...nodesById.values()]
    .filter((node) => node.type === 'directory' && Number(node.id) !== Number(root.id))
    .sort((a, b) => Number(a.id) - Number(b.id));

  const pathCandidates = [];
  const likeCandidates = [];
  const midTheta = thresholds.mid;

  for (const directory of directories) {
    const dirId = Number(directory.id);
    const total = subtreeCount.get(dirId) || 0;
    const direct = (directByDir.get(dirId) || []).slice().sort((a, b) => a - b);
    if (direct.length >= CREATE_MIN_MEMBERS && total > 0) {
      const purity = direct.length / total;
      if (purity >= CREATE_PATH_PURITY_MIN) {
        const eventClass = eventClassFor(directory, nodesById, root.id);
        const directoryName = String(directory.name).trim();
        pathCandidates.push({
          source: 'path',
          tier: 'mid',
          theta: midTheta,
          memberIds: direct,
          memberSet: new Set(direct),
          eventClass,
          definition: systemDefinition('mid', midTheta, eventClass),
          reason: `path:${nodePath(directory, nodesById)}`,
          nameInput: { kind: 'system', tags: [], parentName: directoryName },
        });
      }
    }

    const liked = [...(likedByDir.get(dirId) || [])].sort((a, b) => a - b);
    if (liked.length >= CREATE_MIN_MEMBERS && total > 0) {
      const density = liked.length / total;
      if (density >= CREATE_LIKE_DENSITY_MIN) {
        const eventClass = eventClassFor(directory, nodesById, root.id);
        likeCandidates.push({
          source: 'like',
          tier: 'mid',
          theta: midTheta,
          memberIds: liked,
          memberSet: new Set(liked),
          eventClass,
          definition: systemDefinition('mid', midTheta, eventClass),
          reason: `like:${nodePath(directory, nodesById)}`,
          nameInput: { kind: 'system', tags: [], parentName: String(directory.name).trim() },
          waivePersistence: true,
        });
      }
    }
  }

  const sortFacets = (a, b) =>
    b.memberIds.length !== a.memberIds.length
      ? b.memberIds.length - a.memberIds.length
      : a.memberIds[0] - b.memberIds[0];
  pathCandidates.sort(sortFacets);
  likeCandidates.sort(sortFacets);
  return [...pathCandidates, ...likeCandidates];
}

function likedDensityWaives(memberIds, likes) {
  let liked = 0;
  for (const nodeId of memberIds) if (likes.has(nodeId)) liked += 1;
  return liked >= CREATE_MIN_MEMBERS && liked / memberIds.length >= CREATE_LIKE_DENSITY_MIN;
}

function isPersistent(memberIds, entriesByNodeId, now) {
  let oldest = Infinity;
  for (const nodeId of memberIds) {
    const entry = entriesByNodeId.get(nodeId);
    const createdAt = entry ? new Date(entry.node.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt)) return false;
    if (createdAt < oldest) oldest = createdAt;
  }
  return Number.isFinite(oldest) && now - oldest >= CREATE_PERSISTENCE_DAYS * 86400000;
}

function meanVector(vectors) {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dim) return null;
    for (let i = 0; i < dim; i += 1) out[i] += vector[i];
  }
  for (let i = 0; i < dim; i += 1) out[i] /= vectors.length;
  return out;
}

async function topTagsFor(memberIds) {
  const counts = new Map();
  for (const nodeId of memberIds.slice(0, CREATE_TAG_SCAN_LIMIT)) {
    const tags = await aiTagStore.listRawTags(nodeId);
    for (const raw of tags || []) {
      const tag = String(raw).trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 2)
    .map(([tag]) => tag);
}

async function resolveSystemNamer() {
  let adapter = null;
  let chatConfigured = false;
  try {
    const { getLlmAdapter } = require('../../infrastructure/llmAdapterRuntime');
    adapter = getLlmAdapter();
    if (adapter && typeof adapter.roleConfigured === 'function') {
      chatConfigured = Boolean(await adapter.roleConfigured('chat'));
    }
  } catch {
    chatConfigured = false;
  }
  return createNamer({ llmAdapter: adapter, chatConfigured });
}

async function resolveCreateName(userId, baseName) {
  let candidate = baseName;
  for (let i = 2; await collectionsStore.existsActiveName(userId, candidate); i += 1) {
    candidate = `${baseName} (${i})`;
  }
  return candidate;
}

function tierOf(definition) {
  const tier = definition && typeof definition === 'object' ? definition.tier : null;
  return CREATE_TIERS.includes(tier) ? tier : 'mid';
}

async function createCandidateCollection({
  userId,
  candidate,
  entriesByNodeId,
  modelId,
  namer,
  fallbackIndex,
}) {
  const tags = await topTagsFor(candidate.memberIds);
  const nameInput = {
    ...candidate.nameInput,
    tags: tags.length > 0 ? tags : candidate.nameInput.tags,
    index: fallbackIndex,
  };
  const baseName = await namer(nameInput);
  const name = await resolveCreateName(userId, baseName);

  const created = await collectionsStore.createCollection(
    {
      ownerId: userId,
      name,
      origin: 'system',
      publishMode: 'ask',
      definition: candidate.definition,
    },
    { actor: 'system' }
  );

  await collectionsStore.addItems(
    created.id,
    candidate.memberIds,
    userId,
    { published: true, source: 'system', reason: candidate.reason },
    { actor: 'system' }
  );

  const vectors = candidate.memberIds
    .map((nodeId) => entriesByNodeId.get(nodeId))
    .filter(Boolean)
    .map((entry) => entry.vector);
  const centroid = meanVector(vectors);
  if (centroid) {
    await collectionsStore.upsertCentroid(
      created.id,
      modelId,
      centroid.join(','),
      candidate.memberIds.length
    );
  }

  return {
    id: created.id,
    name,
    tier: candidate.tier,
    event_class: candidate.eventClass,
    memberCount: candidate.memberIds.length,
  };
}

/**
 * Create pass (§2.4). Runs in the cheap and full legs. Candidate sources:
 * pooled mutual-kNN over the active model's tiers, plus deterministic path
 * purity and like-density facets. Every candidate is checked against the
 * user's ACTIVE materialized sets (Jaccard ≥0.8 ⇒ promotion, never a
 * duplicate), then the fingerprint tombstone set, then the per-tier gates.
 * A created collection is system-origin, self-centroid, named by the
 * template/chat namer, centroid-upserted, and its initial member batch is
 * materialized `source='system'`, `published=true` inside journaled
 * `actor='system'` commands.
 *
 * @param {number} userId
 * @returns {Promise<{ created: Array<Object>, promoted: number, suppressed: number }>}
 */
async function runCreatePass(userId) {
  const result = emptyCreateResult();
  const ownerId = Number(userId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return result;
  if (!createEnabled()) return result;

  const activeModel = await llmModelsStore.getActiveByRole('embed');
  if (!activeModel) return result;
  const modelId = Number(activeModel.id);
  if (!Number.isInteger(modelId) || modelId <= 0) return result;

  const thresholds = resolveTierThresholds(activeModel);
  const corpus = await loadPooledCorpus(ownerId, modelId);
  if (!corpus.root || corpus.entries.length < CREATE_MIN_MEMBERS) return result;

  const entries = dedupeContentTwins(corpus.entries);
  if (entries.length < CREATE_MIN_MEMBERS) return result;
  const entriesByNodeId = new Map(entries.map((entry) => [entry.nodeId, entry]));
  const likes = new Set((await fileLikesStore.listLikedNodeIds(ownerId)).map(Number));

  const embeddingCandidates = buildEmbeddingCandidates(
    entries,
    corpus.nodesById,
    corpus.root,
    thresholds
  );
  const facetCandidates = buildFacetCandidates({
    entries,
    nodesById: corpus.nodesById,
    root: corpus.root,
    likes,
    thresholds,
  });
  const candidates = [...embeddingCandidates.candidates, ...facetCandidates];
  result.suppressed += embeddingCandidates.deduped;
  if (candidates.length === 0) return result;

  const owned = (await collectionsStore.listForUser(ownerId, { status: 'all' })).filter(
    (row) => row.ownerId === ownerId
  );
  const ownedActive = owned.filter((row) => row.status === 'active');
  const storedSets = new Map();
  for (const collection of ownedActive) {
    const rows = await collectionsStore.listStoredItems(collection.id);
    storedSets.set(collection.id, new Set(rows.map((row) => Number(row.nodeId))));
  }

  const rateDays = createRateDays();
  const now = Date.now();
  const rateWindowMs = rateDays * 86400000;
  const rateBlocked =
    rateDays > 0 &&
    owned.some((row) => {
      if (row.origin !== 'system') return false;
      const createdAt = new Date(row.createdAt).getTime();
      return Number.isFinite(createdAt) && now - createdAt < rateWindowMs;
    });
  let createdThisPass = false;
  let activeTightMid = ownedActive.filter(
    (row) => row.origin === 'system' && tierOf(row.definition) !== 'loose'
  ).length;
  const looseEvents = new Set(
    ownedActive
      .filter((row) => row.origin === 'system' && tierOf(row.definition) === 'loose')
      .map((row) => eventClassOf(row.definition))
  );
  const systemCount = owned.filter((row) => row.origin === 'system').length;
  const namer = await resolveSystemNamer();

  for (const candidate of candidates) {
    const memberSet = candidate.memberSet;
    if (memberSet.size < CREATE_MIN_MEMBERS) {
      result.suppressed += 1;
      continue;
    }
    const cap = CREATE_SIZE_CAPS[candidate.tier] || CREATE_SIZE_CAPS.mid;
    if (memberSet.size > cap) {
      result.suppressed += 1;
      continue;
    }

    let promoted = false;
    for (const stored of storedSets.values()) {
      if (jaccardSets(stored, memberSet) >= CREATE_JACCARD_MIN) {
        promoted = true;
        break;
      }
    }
    if (promoted) {
      result.promoted += 1;
      continue;
    }

    const fingerprint = definitionEngine.fingerprintDefinition(candidate.definition);
    if (await collectionsStore.isTombstoned(ownerId, fingerprint)) {
      result.suppressed += 1;
      continue;
    }

    if (
      !candidate.waivePersistence &&
      !likedDensityWaives(candidate.memberIds, likes) &&
      !isPersistent(candidate.memberIds, entriesByNodeId, now)
    ) {
      result.suppressed += 1;
      continue;
    }

    if (rateDays > 0 && (rateBlocked || createdThisPass)) {
      result.suppressed += 1;
      continue;
    }

    if (candidate.tier === 'loose') {
      if (looseEvents.has(candidate.eventClass)) {
        result.suppressed += 1;
        continue;
      }
    } else if (activeTightMid >= CREATE_ACTIVE_LIMIT) {
      result.suppressed += 1;
      continue;
    }

    try {
      const created = await createCandidateCollection({
        userId: ownerId,
        candidate,
        entriesByNodeId,
        modelId,
        namer,
        fallbackIndex: systemCount + result.created.length + 1,
      });
      result.created.push(created);
      createdThisPass = true;
      storedSets.set(created.id, memberSet);
      if (candidate.tier === 'loose') {
        looseEvents.add(candidate.eventClass);
      } else {
        activeTightMid += 1;
      }
    } catch (error) {
      console.error(`[evolution] create failed for user ${ownerId}:`, error.message);
      result.suppressed += 1;
    }
  }

  return result;
}

function eventClassOf(definition) {
  const value =
    definition && typeof definition === 'object'
      ? (definition.event_class ?? definition.eventClass)
      : null;
  return value == null ? 'root' : String(value);
}

// ---------------------------------------------------------------------------
// Pass 2 — split (hot subset ⇒ NEW SIBLING system collection, §2.5)
// ---------------------------------------------------------------------------

function emptySplitResult() {
  return { candidates: 0, created: [], promoted: 0, suppressed: 0 };
}

/**
 * Deterministic hot-subset rule (§2.5). A materialized member is HOT when its
 * `node_activity.score` for the requesting user is positive OR the user
 * currently likes it. The subset is every hot member — no ranking, no
 * truncation — in ascending node-id order; over-cap subsets are blocked by the
 * tier cap instead of being sampled.
 *
 * @param {number[]} memberIds ascending materialized parent member ids
 * @param {Array<{nodeId:number, score:number}>} activityRows usageStore rows
 * @param {Set<number>} likedNodeIds live likes for the requester
 * @returns {number[]} ascending hot member ids
 */
function hotSubset(memberIds, activityRows, likedNodeIds) {
  const active = new Set(
    (activityRows || []).filter((row) => Number(row.score) > 0).map((row) => Number(row.nodeId))
  );
  return memberIds.filter((nodeId) => active.has(nodeId) || likedNodeIds.has(nodeId));
}

/**
 * Sibling definition: the same self-centroid shape as a create-pass cluster,
 * carrying the parent's tier/event class plus `split_of` provenance. `theta`
 * is the parent's tier edge cosine; a parent without a finite theta (rule
 * shapes written outside the create pass) inherits the active model profile's
 * value for its tier.
 */
function splitDefinition({ parent, tier, theta }) {
  return {
    kind: 'centroid',
    centroid_ref: null,
    theta,
    tier,
    event_class: eventClassOf(parent.definition),
    split_of: Number(parent.id),
  };
}

/**
 * Broad-tier slot check for a split. A sibling refines its parent's event
 * class, so the parent row and siblings already split from that parent never
 * consume a second slot; any OTHER active loose collection with the same
 * event class still blocks.
 */
function looseEventClassTaken(activeCollections, parent, eventClass) {
  return activeCollections.some((row) => {
    if (Number(row.id) === Number(parent.id)) return false;
    if (row.origin !== 'system' || tierOf(row.definition) !== 'loose') return false;
    if (eventClassOf(row.definition) !== eventClass) return false;
    const splitOf =
      row.definition && typeof row.definition === 'object' ? row.definition.split_of : null;
    return Number(splitOf) !== Number(parent.id);
  });
}

/**
 * Pooled vectors of the active model space for the candidate members
 * (cross-model rows are skipped — a centroid never mixes model spaces).
 */
async function loadSplitVectors(memberIds, modelId) {
  const rows = await embeddingsStore.getByNodeIds(memberIds);
  const vectors = [];
  for (const row of rows || []) {
    if (Number(row.modelId) !== Number(modelId)) continue;
    const vector = parseEmbeddingVector(row.vector);
    if (vector) vectors.push(vector);
  }
  return vectors;
}

/**
 * Create the sibling: template/chat namer with the `split` rule, journaled
 * create command, one journaled initial batch (`source='system'`, matched
 * reason, `published=true`), the member-mean centroid, and the parent's digest
 * note. The parent's definition and membership are never written.
 */
async function createSplitSibling({
  userId,
  parent,
  definition,
  memberIds,
  vectors,
  modelId,
  namer,
  fallbackIndex,
}) {
  const tags = await topTagsFor(memberIds);
  const baseName = await namer({
    kind: 'split',
    parentName: parent.name,
    diffTag: tags[0] ?? null,
    tags,
    index: fallbackIndex,
  });
  const name = await resolveCreateName(userId, baseName);

  const created = await collectionsStore.createCollection(
    {
      ownerId: userId,
      name,
      origin: 'system',
      publishMode: 'ask',
      definition,
    },
    { actor: 'system' }
  );

  await collectionsStore.addItems(
    created.id,
    memberIds,
    userId,
    {
      published: true,
      source: 'system',
      reason: `${SPLIT_REASON_PREFIX}${Number(parent.id)}`,
    },
    { actor: 'system' }
  );

  const centroid = meanVector(vectors);
  if (centroid) {
    await collectionsStore.upsertCentroid(
      created.id,
      modelId,
      centroid.join(','),
      memberIds.length
    );
  }

  // Parent digest note (§2.5): the membership/definition stay byte-identical;
  // only the digest stamp moves so the parent's list banner reflects the act.
  await collectionsStore.touchMemberChange(parent.id);

  return {
    id: created.id,
    name,
    parentId: Number(parent.id),
    tier: definition.tier,
    event_class: definition.event_class,
    memberCount: memberIds.length,
  };
}

/**
 * Split pass (§2.5). Runs in the cheap and full legs, gated by the global
 * switch and `AI_EVOLUTION_CREATE_ENABLED` (the split inherits the create
 * pause). For every ACTIVE `origin='system'` collection the user owns, the
 * deterministic hot subset is tested against the pass-1 gates: min 8 members,
 * the parent tier's size cap, Jaccard ≥0.8 against every active materialized
 * set (the parent included, so a subset that is a near-copy never splits),
 * owner tombstones on the parent-equivalent definition, the create rate window
 * and the active-count limits. A crossing candidate becomes a NEW SIBLING
 * `origin='system'` collection; the parent is never nested, renamed or mutated.
 *
 * @param {number} userId
 * @returns {Promise<{ candidates: number, created: Array<Object>, promoted: number, suppressed: number }>}
 */
async function runSplitPass(userId) {
  const result = emptySplitResult();
  const ownerId = Number(userId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return result;
  if (!createEnabled()) return result;

  const activeModel = await llmModelsStore.getActiveByRole('embed');
  if (!activeModel) return result;
  const modelId = Number(activeModel.id);
  if (!Number.isInteger(modelId) || modelId <= 0) return result;

  const owned = (await collectionsStore.listForUser(ownerId, { status: 'all' })).filter(
    (row) => row.ownerId === ownerId
  );
  const parents = owned.filter((row) => row.origin === 'system' && row.status === 'active');
  if (parents.length === 0) return result;

  const ownedActive = owned.filter((row) => row.status === 'active');
  const storedSets = new Map();
  for (const collection of ownedActive) {
    const rows = await collectionsStore.listStoredItems(collection.id);
    storedSets.set(collection.id, new Set(rows.map((row) => Number(row.nodeId))));
  }

  const thresholds = resolveTierThresholds(activeModel);
  const likes = new Set((await fileLikesStore.listLikedNodeIds(ownerId)).map(Number));

  const rateDays = createRateDays();
  const now = Date.now();
  const rateWindowMs = rateDays * 86400000;
  const rateBlocked =
    rateDays > 0 &&
    owned.some((row) => {
      if (row.origin !== 'system') return false;
      const createdAt = new Date(row.createdAt).getTime();
      return Number.isFinite(createdAt) && now - createdAt < rateWindowMs;
    });
  let createdThisPass = false;
  let activeTightMid = ownedActive.filter(
    (row) => row.origin === 'system' && tierOf(row.definition) !== 'loose'
  ).length;
  const systemCount = owned.filter((row) => row.origin === 'system').length;
  let namer = null;

  for (const parent of parents) {
    const memberIds = [...(storedSets.get(parent.id) || new Set())].sort((a, b) => a - b);
    if (memberIds.length < CREATE_MIN_MEMBERS) continue;

    const activity = await usageStore.listNodeActivity(ownerId, memberIds);
    const hot = hotSubset(memberIds, activity, likes);
    if (hot.length < CREATE_MIN_MEMBERS) continue;
    result.candidates += 1;

    const tier = tierOf(parent.definition);
    const cap = CREATE_SIZE_CAPS[tier] || CREATE_SIZE_CAPS.mid;
    if (hot.length > cap) {
      result.suppressed += 1;
      continue;
    }

    const parentTheta = Number(parent.definition && parent.definition.theta);
    const definition = splitDefinition({
      parent,
      tier,
      theta: Number.isFinite(parentTheta) ? parentTheta : thresholds[tier],
    });
    const hotSet = new Set(hot);

    let promoted = false;
    for (const storedSet of storedSets.values()) {
      if (jaccardSets(storedSet, hotSet) >= CREATE_JACCARD_MIN) {
        promoted = true;
        break;
      }
    }
    if (promoted) {
      result.promoted += 1;
      continue;
    }

    // Tombstones key on the definition identity, not on provenance: the
    // parent-equivalent definition is what a tombstoned regeneration attempt
    // carries, so `split_of` never shelters a suppressed rule shape.
    const coreDefinition = { ...definition };
    delete coreDefinition.split_of;
    const fingerprint = definitionEngine.fingerprintDefinition(coreDefinition);
    if (await collectionsStore.isTombstoned(ownerId, fingerprint)) {
      result.suppressed += 1;
      continue;
    }

    if (rateDays > 0 && (rateBlocked || createdThisPass)) {
      result.suppressed += 1;
      continue;
    }

    if (tier === 'loose') {
      if (looseEventClassTaken(ownedActive, parent, definition.event_class)) {
        result.suppressed += 1;
        continue;
      }
    } else if (activeTightMid >= CREATE_ACTIVE_LIMIT) {
      result.suppressed += 1;
      continue;
    }

    // A self-centroid definition needs a reference: a hot subset with no
    // pooled vector in the active model space would create an inert collection.
    const vectors = await loadSplitVectors(hot, modelId);
    if (vectors.length === 0) {
      result.suppressed += 1;
      continue;
    }

    try {
      if (!namer) namer = await resolveSystemNamer();
      const created = await createSplitSibling({
        userId: ownerId,
        parent,
        definition,
        memberIds: hot,
        vectors,
        modelId,
        namer,
        fallbackIndex: systemCount + result.created.length + 1,
      });
      result.created.push(created);
      createdThisPass = true;
      storedSets.set(created.id, hotSet);
      if (tier !== 'loose') activeTightMid += 1;
    } catch (error) {
      console.error(`[evolution] split failed for user ${ownerId}:`, error.message);
      result.suppressed += 1;
    }
  }

  return result;
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

/**
 * Review band 0.55–0.7 (§2.8): a Jaccard-only gate — subset geometries
 * (theme + subset, the `sibling` case) must reach the arbiter. The band
 * never writes a row on its own; only a verdict does (card gate stays ≥ 0.7).
 */
function bandGeometry(a, b) {
  if (a.size === 0 || b.size === 0) return null;
  const intersection = countIntersection(a, b);
  const union = a.size + b.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;
  if (jaccard < MERGE_BAND_JACCARD_MIN || jaccard >= MERGE_JACCARD_MIN) return null;
  return { jaccard, intersection };
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
 * The 0.55–0.7 review band (§2.8) NEVER produces a row by set math alone: on
 * the nightly FULL leg only, the `merge-arbiter` adjudicates eligible band
 * pairs and a `merge`/`keep_separate` verdict is what writes the row. A
 * dismissed band row follows the same re-raise cadence as ≥0.7 rows (chat
 * eligibility never gates the lifecycle).
 */
async function runMergeCandidatePass(userId, { arbiterLeg = false } = {}) {
  if (!readFlag('AI_MERGE_SUGGESTIONS_ENABLED', true)) {
    return {
      suggested: 0,
      reopened: 0,
      pairs: 0,
      prefiltered: 0,
      arbiterCalls: 0,
      arbiterSuggested: 0,
    };
  }
  const owned = (await collectionsStore.listForUser(userId, { status: 'active' })).filter(
    (row) => row.ownerId === Number(userId)
  );
  if (owned.length < 2) {
    return {
      suggested: 0,
      reopened: 0,
      pairs: 0,
      prefiltered: 0,
      arbiterCalls: 0,
      arbiterSuggested: 0,
    };
  }

  const memberSets = new Map();
  const memberIdsAsc = new Map();
  for (const collection of owned) {
    const rows = await collectionsStore.listStoredItems(collection.id);
    const ids = rows.map((row) => Number(row.nodeId)).sort((a, b) => a - b);
    memberIdsAsc.set(collection.id, ids);
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
  const bandPairs = [];
  for (let i = 0; i < owned.length; i += 1) {
    for (let j = i + 1; j < owned.length; j += 1) {
      const a = owned[i];
      const b = owned[j];
      if (a.origin !== 'system' && b.origin !== 'system') continue;

      const aSet = memberSets.get(a.id);
      const bSet = memberSets.get(b.id);
      const geometry = mergeGeometry(aSet, bSet);
      if (!geometry) {
        const band = bandGeometry(aSet, bSet);
        if (band) bandPairs.push({ a, b, aSet, bSet, ...band });
        continue;
      }
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

  let arbiterCalls = 0;
  let arbiterSuggested = 0;
  if (bandPairs.length > 0) {
    const existingByPair = await loadSuggestionPairsByState(collectionIds, dismissedByPair);
    const adjudicable = [];
    for (const candidate of bandPairs) {
      const key = pairKey(candidate.a.id, candidate.b.id);
      const existing = existingByPair.get(key);
      if (existing) {
        if (existing.state === 'dismissed' && dismissedDue(existing, now)) {
          const result = await collectionsStore.reopenMergeSuggestion(existing.id, {
            score: Math.round(candidate.jaccard * 1000),
          });
          if (result.changes > 0) reopened += 1;
        }
        continue;
      }
      adjudicable.push(candidate);
    }
    if (arbiterLeg && adjudicable.length > 0) {
      const arbiter = await resolveMergeArbiter();
      if (arbiter) {
        adjudicable.sort(
          (x, y) =>
            y.jaccard - x.jaccard ||
            Math.min(x.a.id, x.b.id) - Math.min(y.a.id, y.b.id) ||
            Math.max(x.a.id, x.b.id) - Math.max(y.a.id, y.b.id)
        );
        const inputs = [];
        for (const candidate of adjudicable.slice(0, MERGE_ARBITER_MAX_PAIRS)) {
          inputs.push(
            await buildArbiterPairInput(candidate, {
              aIds: memberIdsAsc.get(candidate.a.id),
              bIds: memberIdsAsc.get(candidate.b.id),
            })
          );
        }
        const outcome = await arbiter.arbitrate(inputs);
        arbiterCalls += outcome.calls;
        for (const input of inputs) {
          const decision = outcome.verdicts.get(input.pairKey);
          if (!decision || decision.verdict === 'sibling') continue;
          const row = await collectionsStore.upsertMergeSuggestion(
            input.aId,
            input.bId,
            input.score,
            { arbiterVerdict: decision.verdict, arbiterReason: decision.reason }
          );
          if (row && row.state === 'pending' && row.arbiterVerdict === decision.verdict) {
            arbiterSuggested += 1;
          }
        }
      }
    }
  }

  return { suggested, reopened, pairs, prefiltered, arbiterCalls, arbiterSuggested };
}

/**
 * Band pairs are adjudicated ONCE: a row in any state (pending, dismissed,
 * rejected, merged) suppresses re-adjudication. The extra states are read
 * lazily — only when band pairs exist (chat-off passes keep the previous
 * read set).
 */
async function loadSuggestionPairsByState(collectionIds, dismissedByPair) {
  const byPair = new Map(dismissedByPair);
  for (const state of ['pending', 'rejected', 'merged']) {
    const rows = await collectionsStore.listMergeSuggestions(collectionIds, { state });
    for (const row of rows || []) {
      const key = pairKey(row.aId, row.bId);
      if (!byPair.has(key)) byPair.set(key, row);
    }
  }
  return byPair;
}

/**
 * Chat-configured + `AI_MERGE_ARBITER_ENABLED` ⇒ an arbiter bound to the
 * adapter's chat role (budgets/breaker inherited by construction,
 * llmAdapter.md §2.5). Anything else ⇒ null — the band simply writes no rows
 * (the card gate stays the ≥ 0.7 set rule in the LLM-free default).
 */
async function resolveMergeArbiter() {
  if (!readFlag('AI_MERGE_ARBITER_ENABLED', true)) return null;
  let adapter = null;
  try {
    const { getLlmAdapter } = require('../../infrastructure/llmAdapterRuntime');
    adapter = getLlmAdapter();
  } catch {
    return null;
  }
  if (!adapter || typeof adapter.chat !== 'function') return null;
  try {
    if (typeof adapter.roleConfigured === 'function') {
      if (!(await adapter.roleConfigured('chat'))) return null;
    }
  } catch {
    return null;
  }
  return createMergeArbiter({ adapter });
}

/** First ≤5 sampled members carrying an `ai_enrichments` summary (features only). */
async function summariesForSample(nodeIds) {
  if (nodeIds.length === 0) return [];
  let rows = [];
  try {
    rows = await aiEnrichmentsStore.getByNodeIds(nodeIds);
  } catch {
    return [];
  }
  return (rows || [])
    .filter((row) => typeof row.summary === 'string' && row.summary.trim().length > 0)
    .map((row) => ({ node_id: Number(row.nodeId), summary: row.summary.trim() }));
}

/**
 * Prompt input for one band pair — the SYMMETRIC DIFFERENCE is load-bearing:
 * each side carries its unique-member count/ratio AND samples from its OWN
 * unique set, never only the intersection (§2.8/§4.19, E7 measured bias).
 */
async function buildArbiterPairInput(candidate, { aIds, bIds }) {
  const { a, b, aSet, bSet, jaccard, intersection } = candidate;
  const buildSide = async (collection, ids, otherSet) => {
    const uniqueIds = ids.filter((id) => !otherSet.has(id));
    return {
      collectionId: collection.id,
      name: collection.name,
      size: ids.length,
      topTags: await topTagsFor(ids),
      uniqueCount: uniqueIds.length,
      uniqueRatio: ids.length > 0 ? Number((uniqueIds.length / ids.length).toFixed(3)) : 0,
      memberSummaries: await summariesForSample(ids.slice(0, MERGE_ARBITER_SAMPLE_CAP)),
      uniqueSamples: await summariesForSample(uniqueIds.slice(0, MERGE_ARBITER_SAMPLE_CAP)),
    };
  };
  return {
    pairKey: pairKey(a.id, b.id),
    aId: a.id,
    bId: b.id,
    score: Math.round(jaccard * 1000),
    jaccard: Number(jaccard.toFixed(3)),
    intersectionCount: intersection,
    a: await buildSide(a, aIds, bSet),
    b: await buildSide(b, bIds, aSet),
  };
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
// Pass 3 — archive (§2.6) + Pass 4 — purge (§2.7)
// ---------------------------------------------------------------------------

function emptyArchiveResult() {
  return { archived: 0 };
}

function emptyPurgeResult() {
  return { purged: 0 };
}

/**
 * Archive pass (§2.6). Scope: ACTIVE `origin='system'` rows owned by the
 * user. Skipped for pinned rows (either `pinned_by` — auto-pin reconcile ran
 * first in the full leg). Gate (ε=0, event-based):
 * - min-age grace: rows younger than `AI_EVOLUTION_MIN_AGE_DAYS` are never
 *   archived (0 disables the grace);
 * - members ≈ 0 ⇒ archive; otherwise the row survives while ANY member has
 *   positive activity inside the last `AI_EVOLUTION_INACTIVE_DAYS`, read
 *   from the lifetime `node_activity.last_seen_at` accumulator column so raw
 *   `usage_events` retention never corrupts the gate;
 * - uniform across tiers (no tier exemptions).
 * The act is journaled `actor='system'` via `collectionsStore.archiveCollection`;
 * idempotent (the guarded mutator reports `changes: 0` when already archived).
 *
 * @param {number} userId
 * @returns {Promise<{ archived: number }>}
 */
async function runArchivePass(userId) {
  const result = emptyArchiveResult();
  const ownerId = Number(userId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return result;

  const active = (await collectionsStore.listForUser(ownerId, { status: 'active' })).filter(
    (row) => row.ownerId === ownerId && row.origin === 'system' && !row.pinned
  );
  if (active.length === 0) return result;

  const inactiveDays = readPositiveNumber(
    'AI_EVOLUTION_INACTIVE_DAYS',
    ARCHIVE_INACTIVE_DAYS_DEFAULT
  );
  const minAgeDays = readPositiveNumber('AI_EVOLUTION_MIN_AGE_DAYS', ARCHIVE_MIN_AGE_DAYS_DEFAULT);
  const now = Date.now();

  for (const collection of active) {
    const createdAtMs = new Date(collection.createdAt).getTime();
    if (minAgeDays > 0 && Number.isFinite(createdAtMs) && now - createdAtMs < minAgeDays * DAY_MS) {
      continue;
    }

    const memberIds = (await collectionsStore.listStoredItems(collection.id)).map((row) =>
      Number(row.nodeId)
    );
    if (memberIds.length > 0) {
      const activity = await usageStore.listNodeActivity(ownerId, memberIds);
      const cutoffMs = now - inactiveDays * DAY_MS;
      const hasRecentActivity = (activity || []).some(
        (row) => Number(row.lastSeenAtMs) >= cutoffMs
      );
      if (hasRecentActivity) continue;
    }

    const archived = await collectionsStore.archiveCollection(collection.id, {
      actor: 'system',
    });
    if (archived.changes > 0) result.archived += 1;
  }
  return result;
}

/**
 * Purge pass (§2.7). Scope: archived `origin='system'` rows whose
 * `archived_at` is older than `ARCHIVE_RETENTION_DAYS` (0 disables retention
 * — nothing is purged). Permanent delete (FK cascade + tombstone + journal
 * purge in ONE TX) carries the NORMALIZED definition fingerprint so a
 * regenerated same-shape rule is suppressed; `ARCHIVE_RETENTION_DAYS` is the
 * tombstone lifetime (expiry GC lives in the nightly rollup tail, NOT here).
 * No inverse exists — permanent delete-from-archive is unrecoverable.
 *
 * @param {number} userId
 * @returns {Promise<{ purged: number }>}
 */
async function runPurgePass(userId) {
  const result = emptyPurgeResult();
  const ownerId = Number(userId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return result;

  const retentionDays = readPositiveNumber(
    'ARCHIVE_RETENTION_DAYS',
    ARCHIVE_RETENTION_DAYS_DEFAULT
  );
  if (retentionDays <= 0) return result;

  const archived = (await collectionsStore.listArchived(ownerId)).filter(
    (row) => row.ownerId === ownerId && row.origin === 'system'
  );
  if (archived.length === 0) return result;

  const cutoffMs = Date.now() - retentionDays * DAY_MS;
  for (const collection of archived) {
    const archivedAtMs = new Date(collection.archivedAt).getTime();
    if (!Number.isFinite(archivedAtMs) || archivedAtMs >= cutoffMs) continue;
    const defFingerprint =
      collection.definition != null
        ? definitionEngine.fingerprintDefinition(collection.definition)
        : undefined;
    const deleted = await collectionsStore.deleteCollectionPermanent(collection.id, {
      defFingerprint,
    });
    if (deleted.changes > 0) result.purged += 1;
  }
  return result;
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
  runCreatePass,
  runSplitPass,
  runArchivePass,
  runPurgePass,
  __resetEvolutionStateForTests,
};
