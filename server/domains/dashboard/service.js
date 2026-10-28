'use strict';

/**
 * dashboard domain service — Storage-dashboard composition for the §4.16/§4.17
 * blocks (docs/spec/server/services/dashboardService.md). Thin CONSUMER:
 * exact dups come from dupFinderService (hash-first, LLM-free), the vector
 * near-dup leg from nearDupFinderService (profile θ_dup, hash-first
 * exclusion), the persisted suggestion rows from fileSuggestionsStore
 * (materialized during the read), the trash card from
 * FileNodeRepository.summarizeTrashedSubtree, the accept action from the
 * files-domain trash core JOURNALED as one `file`-domain command via
 * actionJournalStore (docs/spec/server/store/fileSuggestionsStore.md). No
 * raw SQL here, no LLM.
 */
const { createFileNodesStore } = require('../../store/fileNodesStore');
const fileSuggestionsStore = require('../../store/fileSuggestionsStore');
const actionJournalStore = require('../../store/actionJournalStore');
const aiEnrichmentsStore = require('../../store/aiEnrichmentsStore');
const usageStore = require('../../store/usageStore');
const lockManager = require('../../infrastructure/lockManager');
const dupFinderService = require('../ai/dupFinderService');
const { createNearDupFinderService } = require('../ai/nearDupFinderService');
const { getVectorStoreOrFallback } = require('../ai/vectorStoreRuntime');
const ownerNodeResolver = require('../permissions/policy/ownerNodeResolver');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const { getComposition } = require('../../service/composition');
const storage = require('../../store/storage');
const { classifyCleanup, isShortDocument, KIND_RANK } = require('./suggestionsRules');
const { computeGroupKeeper } = require('./keeperScore');
const { FILE_SUGGESTION_STATE } = require('@webdav-easyaccess/shared/constants');
// Module-load side effect: registers the `file`-domain undo executor for the
// accept command rows committed below (dashboardService.md §2.6).
require('./suggestionUndoService');

// Same resolution contract as gcService Tier 3 (`0` = retention off).
const DEFAULT_TRASH_RETENTION_DAYS = 30;
// file_suggestions expiry horizon (§2.2, `0` = never expire) — same idiom.
const DEFAULT_SUGGESTION_RETENTION_DAYS = 30;
const MAX_ACCEPT_BATCH = 200;
const DAY_MS = 86400000;
const GENERATE_LOCK_TTL_MS = 30 * 60 * 1000;

function serviceError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

/**
 * TRASH_RETENTION_DAYS: config resolver → finite ≥0 wins, else the default.
 * @returns {Promise<number>}
 */
async function resolveTrashRetentionDays() {
  const configured = await getSharedResolver().getConfig('TRASH_RETENTION_DAYS');
  const days = Number(configured);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_TRASH_RETENTION_DAYS;
}

/**
 * AI_SUGGESTION_RETENTION_DAYS: config resolver → finite ≥0 wins, else 30.
 * `0` = rows never expire (expires_at NULL, retention pass is `retention_off`).
 * @returns {Promise<number>}
 */
async function resolveSuggestionRetentionDays() {
  const configured = await getSharedResolver().getConfig('AI_SUGGESTION_RETENTION_DAYS');
  const days = Number(configured);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_SUGGESTION_RETENTION_DAYS;
}

/** Build a display path by walking the parentId chain of subtree rows. */
function buildDisplayPath(row, byId) {
  const segments = [];
  const seen = new Set();
  let current = row;
  while (current && !seen.has(Number(current.nodeId))) {
    seen.add(Number(current.nodeId));
    segments.unshift(String(current.name));
    current = byId.get(Number(current.parentId));
  }
  return `/${segments.join('/')}`;
}

/**
 * The shared hygiene compute: ONE exact-dup pass + (when available) the
 * vector near-dup pass + the live subtree read. Feeds both the persisted
 * generator and the summary blocks (routes/dashboard.md §2.4.2 "one pass").
 */
async function computeHygienePass(userId) {
  const store = createFileNodesStore();
  const root = await store.getUserRootNode(Number(userId));
  const dups = await dupFinderService.findExactDuplicateGroups(userId);

  // §4.17 vector variant — nearDupFinderService owns hash-first precedence,
  // θ_dup (profile) and the group cap; absence is `available: false` and the
  // whole block is omitted (never an error — §4.12).
  const near = await createNearDupFinderService({
    // C6: near-dup scoring reads the boot-selected vectorStore engine
    // (native when available, JsFallback otherwise — vectorStore.md §2.3).
    engineFactory: (modelId, loadRows) => getVectorStoreOrFallback(modelId, loadRows),
  }).findNearDuplicateGroups(userId);

  const liveRows = root ? await store.listSubtreeCacheRows(root.id) : [];
  return { root, dups, near, liveRows };
}

/** Stable key-order JSON for reason comparison (PG jsonb key reordering safe). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Reason-only refresh decision (§2.5.1): a pending near-dup row changes when
 * the keeper or the group score changed, or when its existing keep block no
 * longer matches the fresh one. A LEGACY row (no keep block) is never
 * backfilled while keeper/score stay unchanged.
 */
function shouldRefreshNearReason(stored, nextReason) {
  if (!stored || stored.kind !== 'near_dup') return false;
  const prev = stored.reason || {};
  if (Number(prev.keep_node_id) !== Number(nextReason.keep_node_id)) return true;
  if (Number(prev.score) !== Number(nextReason.score)) return true;
  if (!prev.keep) return false;
  return canonicalJson(prev.keep) !== canonicalJson(nextReason.keep);
}

/**
 * Near-dup candidates with the keeper composite (§2.5.1). ONE activity read +
 * ONE enrichment read cover every group (no N+1); name/size/MIME come from the
 * live subtree rows. Keeper peers list as rows; the short-document exception
 * still gates the listing side only.
 */
async function buildNearCandidates(userId, near, byId, keepers) {
  if (!near.available || near.groups.length === 0) return [];

  const allIds = [
    ...new Set(near.groups.flatMap((group) => group.nodeIds.map((nodeId) => Number(nodeId)))),
  ];
  const activityByNode = new Map();
  const probeByNode = new Map();
  const summaryByNode = new Map();
  if (allIds.length > 0) {
    const activityRows = await usageStore.listNodeActivity(Number(userId), allIds);
    for (const row of activityRows) activityByNode.set(Number(row.nodeId), row);
    const enrichments = await aiEnrichmentsStore.getByNodeIds(allIds);
    for (const row of enrichments || []) {
      const nodeId = Number(row.nodeId);
      probeByNode.set(nodeId, row.probe ?? null);
      summaryByNode.set(nodeId, row.summary ?? null);
    }
  }

  const nowMs = Date.now();
  const candidates = [];
  for (const group of near.groups) {
    const memberIds = group.nodeIds.map((nodeId) => Number(nodeId));
    if (memberIds.length < 2) continue;
    const members = memberIds.map((nodeId) => {
      const row = byId.get(nodeId);
      return {
        nodeId,
        name: row?.name ?? '',
        sizeBytes: Number(row?.size) || 0,
        mimeType: row?.mimeType ?? null,
      };
    });
    const { keeperNodeId, keep } = computeGroupKeeper({
      members,
      activityByNode,
      probeByNode,
      pairScores: group.pairScores || [],
      nowMs,
    });
    keepers.add(keeperNodeId);
    for (const nodeId of memberIds) {
      if (nodeId === keeperNodeId) continue;
      if (isShortDocument(summaryByNode.get(nodeId) ?? null)) continue;
      candidates.push({
        nodeId,
        kind: 'near_dup',
        reason: {
          kind: 'near_dup',
          keep_node_id: keeperNodeId,
          score: Math.round(Number(group.score) * 1000) / 1000,
          keep,
        },
      });
    }
  }
  return candidates;
}

/**
 * Candidate set for the generator pass (dashboardService.md §2.5): exact
 * dup members, near-dup members (keeper composite + short-doc excluded),
 * rule-pattern rows. Keepers never list for ANY kind; one candidate per node
 * by kind priority (exact > near > temp > screenshot > installer).
 */
async function buildCandidates(userId, pass) {
  const { dups, near, liveRows } = pass;
  const nowMs = Date.now();
  const byId = new Map(liveRows.map((row) => [Number(row.nodeId), row]));

  const keepers = new Set();
  const ordered = [];

  for (const group of dups.groups) {
    const keepNodeId = Number(group.nodeIds[0]);
    keepers.add(keepNodeId);
    group.nodeIds.slice(1).forEach((nodeId) => {
      ordered.push({
        nodeId: Number(nodeId),
        kind: 'exact_dup',
        reason: { kind: 'exact_dup', keep_node_id: keepNodeId },
      });
    });
  }

  ordered.push(...(await buildNearCandidates(userId, near, byId, keepers)));

  for (const row of liveRows) {
    if (row.type !== 'file') continue;
    const nodeId = Number(row.nodeId);
    if (keepers.has(nodeId)) continue;
    const verdict = classifyCleanup({ name: row.name, createdAt: row.createdAt }, { now: nowMs });
    if (!verdict) continue;
    ordered.push({ nodeId, kind: verdict.kind, reason: verdict.reason });
  }

  // Per-node priority dedupe (insertion already rank-ordered, keep first).
  const seenNode = new Set();
  const candidates = [];
  for (const candidate of ordered) {
    if (keepers.has(candidate.nodeId)) continue;
    if (seenNode.has(candidate.nodeId)) continue;
    seenNode.add(candidate.nodeId);
    candidates.push(candidate);
  }
  return { candidates, byId };
}

/**
 * Persist the candidate set as pending rows and reconcile stale ones
 * (dashboardService.md §2.5). Idempotent; the per-user generate lock makes
 * concurrent reads skip instead of double-insert (no unique index on the
 * table — store spec §2.4 rule 2). Returns { inserted, expired }.
 */
async function materializeFromPass(userId, pass) {
  if (!pass.root) return { inserted: 0, expired: 0 };
  const lockName = `file-suggestions-generate:${userId}`;
  let lock;
  try {
    lock = await lockManager.acquireLock(lockName, { ttlMs: GENERATE_LOCK_TTL_MS, waitMs: 0 });
  } catch (error) {
    if (error && error.code === 'LOCK_TIMEOUT') return { inserted: 0, expired: 0 };
    throw error;
  }
  try {
    const { candidates, byId } = await buildCandidates(userId, pass);
    const retentionDays = await resolveSuggestionRetentionDays();
    const expiresAt =
      retentionDays > 0 ? new Date(Date.now() + retentionDays * DAY_MS).toISOString() : null;

    // Dedupe: an existing pending/dismissed row of the same (node, kind) is
    // never re-inserted (dismissed = user intent, pending = already listed;
    // `expired` history and the accepted family do not block — accepted rows
    // whose node is a LIVE candidate again re-pend below).
    const history = await fileSuggestionsStore.listKeys(userId);
    const blocked = new Set(
      history
        .filter(
          (key) =>
            key.state === FILE_SUGGESTION_STATE.PENDING ||
            key.state === FILE_SUGGESTION_STATE.DISMISSED
        )
        .map((key) => `${key.nodeId}:${key.kind}`)
    );

    // Accepted-again live (trash-UI restore without journal undo): the node
    // is a live candidate again, so its accepted rows re-pend and the
    // suggestion resurfaces with its original id.
    const liveCandidateKeys = new Set(
      candidates
        .filter((candidate) => byId.has(candidate.nodeId))
        .map((candidate) => `${candidate.nodeId}:${candidate.kind}`)
    );
    const rePendIds = [];
    if (candidates.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const accepted = await fileSuggestionsStore.listIdsByNodesTx(
        storage.getExecutor(),
        Number(userId),
        [...new Set(candidates.map((candidate) => candidate.nodeId))],
        FILE_SUGGESTION_STATE.ACCEPTED
      );
      for (const row of accepted) {
        const key = `${row.nodeId}:${row.kind}`;
        if (liveCandidateKeys.has(key)) {
          rePendIds.push(row.id);
          blocked.add(key);
        }
      }
    }
    if (rePendIds.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await fileSuggestionsStore.flipStatesTx(storage.getExecutor(), {
        ids: rePendIds,
        fromState: FILE_SUGGESTION_STATE.ACCEPTED,
        toState: FILE_SUGGESTION_STATE.PENDING,
      });
    }

    let inserted = 0;
    const candidateKeys = new Set();
    const pendingBefore = await fileSuggestionsStore.listPending(userId);
    const pendingByKey = new Map(
      pendingBefore.map((row) => [`${Number(row.nodeId)}:${row.kind}`, row])
    );
    for (const candidate of candidates) {
      const key = `${candidate.nodeId}:${candidate.kind}`;
      candidateKeys.add(key);
      if (blocked.has(key)) {
        // Reason-only refresh (§2.5.1): an existing pending near-dup row keeps
        // its id/created_at/expires_at/state; legacy rows stay un-backfilled
        // while keeper/score are unchanged.
        const stored = pendingByKey.get(key);
        if (stored && shouldRefreshNearReason(stored, candidate.reason)) {
          // eslint-disable-next-line no-await-in-loop
          await fileSuggestionsStore.updateReason(Number(userId), stored.id, candidate.reason);
        }
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await fileSuggestionsStore.insert({
        userId: Number(userId),
        nodeId: candidate.nodeId,
        kind: candidate.kind,
        reason: candidate.reason,
        expiresAt,
      });
      inserted += 1;
    }

    // Reconcile: pending rows outside the current candidate set (candidate
    // vanished, keeper flipped, node left the live set) expire.
    const staleIds = pendingBefore
      .filter((row) => !candidateKeys.has(`${Number(row.nodeId)}:${row.kind}`))
      .map((row) => row.id);
    let expired = 0;
    if (staleIds.length > 0) {
      const flip = await fileSuggestionsStore.flipStatesTx(storage.getExecutor(), {
        ids: staleIds,
        fromState: FILE_SUGGESTION_STATE.PENDING,
        toState: FILE_SUGGESTION_STATE.EXPIRED,
      });
      expired = flip.changes;
    }
    return { inserted, expired };
  } finally {
    await lock.release();
  }
}

/** Public generator entry (tests + reuse). */
async function materializeSuggestions(userId) {
  const pass = await computeHygienePass(userId);
  return materializeFromPass(userId, pass);
}

/**
 * One-shot dashboard read: dup summaries + PERSISTED pending suggestion
 * rows (materialized first) + trash summary (camelCase domain object — the
 * ROUTE serializes snake_case).
 * @param {number|string} userId
 */
async function getDashboardSummary(userId) {
  const pass = await computeHygienePass(userId);
  await materializeFromPass(userId, pass);
  const { dups, near, liveRows, root } = pass;

  const store = createFileNodesStore();
  const pending = await fileSuggestionsStore.listPending(userId);
  const now = Date.now();
  const byId = new Map(liveRows.map((row) => [Number(row.nodeId), row]));
  const suggestions = pending
    .filter((row) => row.expiresAt == null || Date.parse(row.expiresAt) > now)
    .map((row) => {
      const nodeRow = byId.get(Number(row.nodeId));
      return {
        id: row.id,
        nodeId: row.nodeId,
        kind: row.kind,
        path: nodeRow ? buildDisplayPath(nodeRow, byId) : null,
        sizeBytes: Number(nodeRow?.size) || 0,
        reason: row.reason,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    });
  suggestions.sort((a, b) => {
    const rankA = KIND_RANK[a.kind] ?? 99;
    const rankB = KIND_RANK[b.kind] ?? 99;
    return rankA - rankB || a.id - b.id;
  });

  const trash = root
    ? await store.summarizeTrashedSubtree(root.id)
    : { itemCount: 0, totalBytes: 0, oldestDeletedAt: null };

  return {
    duplicates: {
      groupCount: dups.groupCount,
      duplicateCount: dups.duplicateCount,
      reclaimableBytes: dups.reclaimableBytes,
    },
    ...(near.available
      ? {
          nearDuplicates: {
            groupCount: near.groupCount,
            duplicateCount: near.duplicateCount,
          },
        }
      : {}),
    suggestions,
    trash: { ...trash, retentionDays: await resolveTrashRetentionDays() },
  };
}

/**
 * Accept checked suggestion rows → trash, journaled as ONE `file`-domain
 * command row (dashboardService.md §2.2/§2.6; routes/dashboard.md §2.4).
 * Rows flip `pending → accepted` inside the command TX; the response carries
 * `actionId` for the undo toast (`undo: { action_id }` at the route).
 * @param {number|string} userId
 * @param {Object} user — req.user.full (the trash core's ACL subject)
 * @param {Array<number|string>} nodeIds
 */
async function acceptSuggestions(userId, user, nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0 || nodeIds.length > MAX_ACCEPT_BATCH) {
    throw serviceError('emptyNodeIds');
  }

  const { fileService } = getComposition();
  const fileNodesStore = createFileNodesStore();
  const trashed = [];
  const rejectedNotOwned = [];
  const skipped = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const rawNodeId of nodeIds) {
    const nodeId = Number(rawNodeId);
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      rejectedNotOwned.push(Number.isNaN(nodeId) ? rawNodeId : nodeId);
      // eslint-disable-next-line no-await-in-loop
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const owned = await ownerNodeResolver.isOwnerNode(Number(userId), nodeId);
      if (!owned) {
        rejectedNotOwned.push(nodeId);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await fileService.deleteNode(nodeId, Number(userId), user);
        trashed.push(nodeId);
      }
    } catch (error) {
      // a trashed/foreign node surfaces 404 from the trash core — the same
      // classification the owner gate produces; anything else is a backend
      // failure for THIS node only (the loop never aborts).
      if (error && error.status === 404) {
        rejectedNotOwned.push(nodeId);
      } else {
        skipped.push(nodeId);
      }
    }
  }

  if (trashed.length === 0) {
    // Nothing happened — an empty selection NEVER commits a command row.
    return { trashed, rejectedNotOwned, skipped, actionId: null };
  }

  // Per-trashed-node item: the post-trash deleted_at (the undo fingerprint)
  // + the pending row ids listed before the flip.
  const items = [];
  for (const nodeId of trashed) {
    // eslint-disable-next-line no-await-in-loop
    const nodeRow = await fileNodesStore.getNodeIncludingTrashed(nodeId);
    // eslint-disable-next-line no-await-in-loop
    const rows = await fileSuggestionsStore.listIdsByNodesTx(
      storage.getExecutor(),
      Number(userId),
      [nodeId],
      FILE_SUGGESTION_STATE.PENDING
    );
    items.push({
      nodeId,
      deletedAt: nodeRow ? nodeRow.deletedAt : null,
      suggestionIds: rows.map((row) => row.id),
    });
  }

  const subject = `file:suggestion-accept:${Number(userId)}:${Date.now()}`;
  const committed = await actionJournalStore.commitChange(
    'file',
    subject,
    { actor: String(userId), action: 'cleanup-accept', subjectLabel: null },
    { inverse: { op: 'restore-from-trash' }, items },
    async (tx) => {
      let flipped = 0;
      // eslint-disable-next-line no-restricted-syntax
      for (const item of items) {
        if (item.suggestionIds.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const flip = await fileSuggestionsStore.flipStatesTx(tx, {
          ids: item.suggestionIds,
          fromState: FILE_SUGGESTION_STATE.PENDING,
          toState: FILE_SUGGESTION_STATE.ACCEPTED,
        });
        flipped += flip.changes;
      }
      return { trashed, flipped };
    }
  );

  return { trashed, rejectedNotOwned, skipped, actionId: committed.id };
}

/**
 * Dismiss one persisted suggestion row (`pending → dismissed`).
 * @param {number|string} userId
 * @param {number|string} suggestionId
 */
async function dismissSuggestion(userId, suggestionId) {
  const id = Number(suggestionId);
  if (!Number.isInteger(id) || id <= 0) {
    throw serviceError('invalidSuggestionId');
  }
  const { changes } = await fileSuggestionsStore.dismiss(Number(userId), id);
  if (changes === 0) {
    // single 404 shape — unknown, foreign and non-pending never diverge
    throw serviceError('suggestionNotFound', 404);
  }
  return { id, state: FILE_SUGGESTION_STATE.DISMISSED };
}

module.exports = {
  DEFAULT_TRASH_RETENTION_DAYS,
  DEFAULT_SUGGESTION_RETENTION_DAYS,
  MAX_ACCEPT_BATCH,
  resolveTrashRetentionDays,
  resolveSuggestionRetentionDays,
  getDashboardSummary,
  materializeSuggestions,
  acceptSuggestions,
  dismissSuggestion,
};
