'use strict';

/**
 * collectionsStore facade — facade over the collections platform tables
 * (docs/spec/server/store/collectionsStore.md). No SQL here: journaled
 * mutators go through actionJournalStore.commitChange() with the tx-bound
 * CollectionsRepository inside the mutation; everything else delegates to the
 * repository built over storage.getExecutor() (recentFiles precedent).
 */
const storage = require('./storage');
const lockManager = require('../infrastructure/lockManager');
const createCollectionsRepository = require('./repositories/CollectionsRepository');
const actionJournalStore = require('./actionJournalStore');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createCollectionsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

// Journaled mutators return their §2.2 shape (row / { changes }) plus the
// `actionId` undo pointer the toast contract requires (§4.11).
function withActionId(mutationResult, committed) {
  return { ...mutationResult, actionId: committed.id };
}

// Register (d) — the feed renders subject_label verbatim (never re-resolves),
// so every collection-subject commit captures the display name at commit time
// (docs/spec/server/store/collectionsStore.md §2.1 capture table).
async function labelOf(repo, collectionId) {
  const row = await repo.getCollection(collectionId);
  return row ? row.name : null;
}

// -- reads -------------------------------------------------------------------

async function getCollection(collectionId) {
  return getRepository().getCollection(collectionId);
}

async function listForUser(userId, options = {}) {
  return getRepository().listForUser(userId, options);
}

async function listArchived(ownerId) {
  return getRepository().listArchived(ownerId);
}

async function existsActiveName(ownerId, name) {
  return getRepository().existsActiveName(ownerId, name);
}

// -- collections (§2.2) ------------------------------------------------------

/**
 * JOURNALED (domain=collection, subject resolved inside the TX).
 * origin ∈ system|user|seed|search; publishMode defaults to 'ask'.
 * Seeds the creator's digest cursor (`last_visited_at = created_at`) inside the
 * same mutation TX — self-created collections never carry the sidebar new dot
 * (owner ruling 2026-10-01, §2.2).
 * @param {{ ownerId, name, origin, publishMode?, definition? }} input
 * @param {{ actor, actionId? }} [ctx]
 * @returns {Promise<Object>} created collection row (plus `actionId` for the
 *   toast contract `undo: { action_id }`).
 */
async function createCollection(input, ctx = {}) {
  const committed = await actionJournalStore.commitChange(
    'collection',
    (result) => `collection:${result.id}`,
    { actor: ctx.actor, action: 'create', subjectLabel: input.name },
    (result) => ({ inverse: { op: 'delete-collection', collectionId: result.id } }),
    async (tx) => {
      const repo = getRepository();
      const created = await repo.insertCollection(tx, {
        ownerId: input.ownerId,
        name: input.name,
        origin: input.origin,
        publishMode: input.publishMode,
        definition: input.definition,
      });
      const row = await repo.getCollectionTx(tx, created.id);
      // Seed the creator's digest cursor INSIDE this journaled TX (ruling
      // 2026-10-01): self-created collections must never carry the sidebar
      // new dot (`last_visited_at = created_at`). A post-commit seed would
      // leave a dangling cursor row if the TX rolled back.
      await repo.upsertDigestCursor(tx, input.ownerId, created.id, row.createdAt);
      return row;
    }
  );
  return withActionId(committed.result, committed);
}

/** JOURNALED. Sets `name_locked=true` when `lockName` (user rename, §3.2).
 * The previous row is read BEFORE the TX: commitChange evaluates the inverse
 * synchronously, so async inverse builders would serialize a Promise. */
async function renameCollection(collectionId, name, { lockName } = {}, ctx = {}) {
  const repo = getRepository();
  const previous = await repo.getCollection(collectionId);
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'rename', subjectLabel: name },
    {
      inverse: {
        op: 'rename-collection',
        collectionId,
        previousName: previous ? previous.name : null,
      },
    },
    async (tx) => {
      await repo.renameCollection(tx, collectionId, name, lockName === true);
      return repo.getCollectionTx(tx, collectionId);
    }
  );
  return withActionId(committed.result, committed);
}

/** JOURNALED. User pin/unpin only (writes pinned; pinned_by='user' on pin). */
async function setPinned(collectionId, pinned, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    {
      actor: ctx.actor,
      action: pinned ? 'pin' : 'unpin',
      subjectLabel: await labelOf(repo, collectionId),
    },
    { inverse: { op: 'set-pinned', collectionId, pinned: !pinned } },
    (tx) => repo.updatePin(tx, collectionId, Boolean(pinned), pinned ? 'user' : null)
  );
  return withActionId(committed.result, committed);
}

/**
 * JOURNALED (T0.3): the explicit sharing-mode act (§4.7) —
 * publishMode ∈ ask|off|auto; owner-only enforcement is the service's job.
 * commitChange evaluates the inverse synchronously (no await), so the
 * previous row is read BEFORE the TX and the inverse is a static descriptor.
 */
async function setPublishMode(collectionId, publishMode, ctx = {}) {
  const repo = getRepository();
  const previous = await repo.getCollection(collectionId);
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    {
      actor: ctx.actor,
      action: 'set-publish-mode',
      subjectLabel: previous ? previous.name : null,
    },
    {
      inverse: {
        op: 'set-publish-mode',
        collectionId,
        publishMode: previous ? previous.publishMode : null,
      },
    },
    async (tx) => {
      await repo.updatePublishMode(tx, collectionId, publishMode);
      return repo.getCollectionTx(tx, collectionId);
    }
  );
  return withActionId(committed.result, committed);
}

/**
 * NON-JOURNALED (§4.9b): auto-pin on user touch of a system collection.
 * No-op when already pinned; only origin='system' rows.
 */
async function setAutoPin(collectionId) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.setAutoPin(tx, collectionId));
}

/** JOURNALED. status='archived', archived_at=now(); guarded → changes: 0 when already archived. */
async function archiveCollection(collectionId, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'archive', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'restore-collection', collectionId } },
    (tx) => repo.archiveRow(tx, collectionId)
  );
  return withActionId(committed.result, committed);
}

/** JOURNALED. status='active', clears archived_at; guarded → changes: 0 when not archived. */
async function restoreCollection(collectionId, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'restore', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'archive-collection', collectionId } },
    (tx) => repo.restoreRow(tx, collectionId)
  );
  return withActionId(committed.result, committed);
}

/**
 * NOT journaled (no inverse — trash-parity, §4.11): single TX under the
 * subject lock. Deletes the row (FK CASCADE wipes items/exclusions/grants/
 * visibility/centroids/cursors/merge suggestions), tombstones when a
 * defFingerprint is given (system-origin only, invariant 10), and purges the
 * subject's journal rows in the SAME TX (invariant 10).
 */
async function deleteCollectionPermanent(collectionId, { defFingerprint } = {}) {
  const repo = getRepository();
  const collection = await repo.getCollection(collectionId);
  if (!collection) return { changes: 0 };

  const lock = await lockManager.acquireLock(`journal:collection:collection:${collectionId}`);
  try {
    return await storage.getExecutor().transaction(async (tx) => {
      const removed = await repo.deleteCollectionRow(tx, collectionId);
      if (removed.changes === 0) return { changes: 0 };
      if (defFingerprint && collection.origin === 'system') {
        await repo.insertTombstone(tx, collection.ownerId, defFingerprint);
      }
      await actionJournalStore.purgeSubjectTx(tx, 'collection', `collection:${collectionId}`);
      return { changes: removed.changes };
    });
  } finally {
    await lock.release();
  }
}

async function touchMemberChange(collectionId) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.touchMemberChange(tx, collectionId));
}

/**
 * JOURNALED merge command (T0.3, §2.9 collectionsService.md): ONE command row
 * (action='merge', subject `collection:<survivorId>`). Runs under the
 * SURVIVOR subject lock (via commitChange) with the LOSER subject lock held
 * across the pre-read/move window (deadlock-free: no other writer locks two
 * subjects). Stored members and exclusions move to the survivor — PK
 * conflicts drop the loser duplicates and the inverse records them as
 * `dropped`; the loser row is deleted (FK cascade wipes its grants/visibility/
 * centroids/cursors/remaining rows); a matching pending suggestion flips to
 * 'merged' opportunistically; the survivor keeps name/name_locked and is
 * touched. The caller (service) owns owner/active guards.
 */
async function mergeCollections(survivorId, loserId, ctx = {}) {
  const repo = getRepository();
  const loser = await repo.getCollection(loserId);
  if (!loser || loser.status !== 'active') {
    const error = new Error('notFound');
    error.status = 404;
    throw error;
  }
  const loserLock = await lockManager.acquireLock(`journal:collection:collection:${loserId}`);
  try {
    const loserItems = await repo.listStoredItems(loserId);
    const loserExclusions = await repo.listExclusions(loserId);
    const suggestions = await repo.listMergeSuggestions([survivorId, loserId]);
    const low = Math.min(Number(survivorId), Number(loserId));
    const high = Math.max(Number(survivorId), Number(loserId));
    const suggestion = suggestions.find((row) => row.aId === low && row.bId === high) || null;

    const committed = await actionJournalStore.commitChange(
      'collection',
      `collection:${survivorId}`,
      { actor: ctx.actor, action: 'merge', subjectLabel: loser.name },
      (result) => ({
        inverse: {
          op: 'merge-collections',
          survivorId: Number(survivorId),
          loserId: Number(loserId),
          loser: {
            name: loser.name,
            origin: loser.origin,
            publishMode: loser.publishMode,
            definition: loser.definition,
            pinned: loser.pinned,
            pinnedBy: loser.pinnedBy,
            items: loserItems.map((item) => ({
              nodeId: item.nodeId,
              addedBy: item.addedBy,
              published: item.published,
            })),
            exclusions: loserExclusions,
          },
        },
        dropped: result.dropped,
      }),
      async (tx) => {
        const droppedItems = [];
        for (const item of loserItems) {
          const insert = await repo.insertItem(tx, survivorId, item.nodeId, item.addedBy, {
            published: item.published,
          });
          if (insert.changes === 0) droppedItems.push(item.nodeId);
          await repo.deleteItem(tx, loserId, item.nodeId);
        }
        const droppedExclusions = [];
        for (const nodeId of loserExclusions) {
          const insert = await repo.insertExclusion(tx, survivorId, nodeId);
          if (insert.changes === 0) droppedExclusions.push(nodeId);
          await repo.deleteExclusion(tx, loserId, nodeId);
        }
        if (suggestion) {
          await repo.setSuggestionState(tx, suggestion.id, 'merged');
        }
        await repo.touchMemberChange(tx, survivorId);
        await repo.deleteCollectionRow(tx, loserId);
        const survivorRow = await repo.getCollectionTx(tx, survivorId);
        return {
          survivor: survivorRow,
          dropped: { items: droppedItems, exclusions: droppedExclusions },
        };
      }
    );
    return { ...committed.result, actionId: committed.id };
  } finally {
    await loserLock.release();
  }
}

// -- membership (items ∪ derived − exclusions) (§2.3) ------------------------

async function listStoredItems(collectionId, options = {}) {
  return getRepository().listStoredItems(collectionId, options);
}

async function getStoredItem(collectionId, nodeId) {
  return getRepository().getStoredItem(collectionId, nodeId);
}

/**
 * JOURNALED. Idempotent on the PK pair (the duplicate command still records
 * its own journal row with a no-op inverse). Default `published=true` for
 * owner-added rows.
 */
async function addItem(collectionId, nodeId, addedBy, { published } = {}, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'add-item', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'remove-item', collectionId, nodeId } },
    (tx) => repo.insertItem(tx, collectionId, nodeId, addedBy, { published: published ?? true })
  );
  return withActionId(committed.result, committed);
}

/** JOURNALED. Membership removal only — never trashes the node (§3.2). */
async function removeItem(collectionId, nodeId, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'remove-item', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'add-item', collectionId, nodeId, addedBy: ctx.actor } },
    (tx) => repo.deleteItem(tx, collectionId, nodeId)
  );
  return withActionId(committed.result, committed);
}

/**
 * JOURNALED batch add (T0.3): ONE command row whose payload carries the
 * item-level inverse list (§4.11). Idempotent on the PK pair — duplicates are
 * reported in `alreadyMembers` (pre-read) and never re-inserted;
 * `touchMemberChange` runs inside the same TX.
 */
async function addItems(collectionId, nodeIds, addedBy, { published } = {}, ctx = {}) {
  const repo = getRepository();
  const alreadyMembers = [];
  const toInsert = [];
  for (const rawNodeId of nodeIds) {
    const nodeId = Number(rawNodeId);
    const existing = await repo.getStoredItem(collectionId, nodeId);
    if (existing) {
      alreadyMembers.push(nodeId);
    } else {
      toInsert.push(nodeId);
    }
  }
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'add-items', subjectLabel: await labelOf(repo, collectionId) },
    {
      inverse: { op: 'remove-items', collectionId },
      items: toInsert.map((nodeId) => ({
        nodeId,
        inverse: { op: 'remove-item', collectionId, nodeId },
      })),
    },
    async (tx) => {
      const added = [];
      for (const nodeId of toInsert) {
        const result = await repo.insertItem(tx, collectionId, nodeId, addedBy, {
          published: published ?? true,
        });
        if (result.changes > 0) added.push(nodeId);
      }
      await repo.touchMemberChange(tx, collectionId);
      return { added };
    }
  );
  return { ...committed.result, alreadyMembers, actionId: committed.id };
}

/**
 * JOURNALED batch remove (T0.3): deletes the stored rows and inserts the
 * exclusions in ONE command row (per-item inverses in the payload). The
 * service classifies stored vs derived; on `origin='system'` collections the
 * auto-pin rides inside the same TX (§4.9b). Membership only — the node is
 * never trashed (§3.2).
 */
async function removeItems(
  collectionId,
  { storedNodeIds = [], excludeNodeIds = [] } = {},
  ctx = {}
) {
  const repo = getRepository();
  const collection = await repo.getCollection(collectionId);
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    {
      actor: ctx.actor,
      action: 'remove-items',
      subjectLabel: collection ? collection.name : null,
    },
    {
      inverse: { op: 'remove-items', collectionId },
      items: [
        ...storedNodeIds.map((nodeId) => ({
          nodeId: Number(nodeId),
          kind: 'stored',
          inverse: { op: 'add-item', collectionId, nodeId: Number(nodeId), addedBy: ctx.actor },
        })),
        ...excludeNodeIds.map((nodeId) => ({
          nodeId: Number(nodeId),
          kind: 'exclusion',
          inverse: { op: 'remove-exclusion', collectionId, nodeId: Number(nodeId) },
        })),
      ],
    },
    async (tx) => {
      const removed = [];
      const excluded = [];
      for (const rawNodeId of storedNodeIds) {
        const result = await repo.deleteItem(tx, collectionId, Number(rawNodeId));
        if (result.changes > 0) removed.push(Number(rawNodeId));
      }
      for (const rawNodeId of excludeNodeIds) {
        const result = await repo.insertExclusion(tx, collectionId, Number(rawNodeId));
        if (result.changes > 0) excluded.push(Number(rawNodeId));
      }
      if (collection && collection.origin === 'system') {
        await repo.setAutoPin(tx, collectionId);
      }
      await repo.touchMemberChange(tx, collectionId);
      return { removed, excluded };
    }
  );
  return { ...committed.result, actionId: committed.id };
}

async function listExclusions(collectionId) {
  return getRepository().listExclusions(collectionId);
}

async function isExcluded(collectionId, nodeId) {
  return getRepository().isExcluded(collectionId, nodeId);
}

/**
 * JOURNALED. Applies to derived members only ("block for this definition");
 * on origin='system' collections it also auto-pins INSIDE the same TX
 * (exclusion = touch, §4.9b).
 */
async function addExclusion(collectionId, nodeId, ctx = {}) {
  const repo = getRepository();
  const collection = await repo.getCollection(collectionId);
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'exclude', subjectLabel: collection ? collection.name : null },
    { inverse: { op: 'remove-exclusion', collectionId, nodeId } },
    async (tx) => {
      const result = await repo.insertExclusion(tx, collectionId, nodeId);
      if (collection && collection.origin === 'system') {
        await repo.setAutoPin(tx, collectionId);
      }
      return result;
    }
  );
  return withActionId(committed.result, committed);
}

async function removeExclusion(collectionId, nodeId, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'unexclude', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'add-exclusion', collectionId, nodeId } },
    (tx) => repo.deleteExclusion(tx, collectionId, nodeId)
  );
  return withActionId(committed.result, committed);
}

async function setItemPublished(collectionId, nodeIds, published, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    {
      actor: ctx.actor,
      action: 'set-items-published',
      subjectLabel: await labelOf(repo, collectionId),
    },
    { inverse: { op: 'set-items-published', collectionId, nodeIds, published: !published } },
    (tx) => repo.setItemPublished(tx, collectionId, nodeIds, Boolean(published))
  );
  return withActionId(committed.result, committed);
}

async function listForNodes(userId, nodeIds) {
  return getRepository().listForNodes(userId, nodeIds);
}

// -- sharing, visibility, cursors, centroids, tombstones, suggestions (§2.4) -

async function listGrants(collectionId) {
  return getRepository().listGrants(collectionId);
}

async function getGrant(collectionId, granteeId) {
  return getRepository().getGrant(collectionId, granteeId);
}

/** JOURNALED. UPSERT on PK (collection, grantee) — role change replaces in place. */
async function grantAccess(collectionId, granteeId, role, grantedBy, ctx = {}) {
  const repo = getRepository();
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'grant', subjectLabel: await labelOf(repo, collectionId) },
    { inverse: { op: 'revoke-access', collectionId, granteeId } },
    (tx) => repo.upsertGrant(tx, collectionId, granteeId, role, grantedBy)
  );
  return withActionId(committed.result, committed);
}

/**
 * JOURNALED. Instant (§4.7); the payload notes restore-future-only semantics.
 * RULING B (owner, 2026-10-02): the same journaled TX also deletes the
 * grantee's digest cursor — a re-grant after revoke RE-DOTS the sidebar.
 * UNDO BOUNDARY (owner-accepted): the `grant-access` inverse restores the
 * GRANT ONLY; the deleted cursor is NOT restored, so undo-revoke re-dots too.
 * Covers BOTH revoke paths — owner-side revokeCollectionAccess and the
 * grantee self-revoke revokeOwnGrant ride this store function.
 */
async function revokeAccess(collectionId, granteeId, ctx = {}) {
  const repo = getRepository();
  const existing = await repo.getGrant(collectionId, granteeId);
  const committed = await actionJournalStore.commitChange(
    'collection',
    `collection:${collectionId}`,
    { actor: ctx.actor, action: 'revoke', subjectLabel: await labelOf(repo, collectionId) },
    {
      inverse: {
        op: 'grant-access',
        collectionId,
        granteeId,
        role: existing ? existing.role : null,
      },
    },
    async (tx) => {
      const removed = await repo.deleteGrant(tx, collectionId, granteeId);
      await repo.deleteDigestCursor(tx, granteeId, collectionId);
      return removed;
    }
  );
  return withActionId(committed.result, committed);
}

async function setVisible(userId, collectionId, hidden) {
  const repo = getRepository();
  return storage
    .getExecutor()
    .transaction((tx) => repo.setVisible(tx, userId, collectionId, Boolean(hidden)));
}

async function isHiddenFor(userId, collectionId) {
  return getRepository().isHiddenFor(userId, collectionId);
}

async function getDigestCursor(userId, collectionId) {
  return getRepository().getDigestCursor(userId, collectionId);
}

async function listDigestCursorMap(userId) {
  return getRepository().listDigestCursorMap(userId);
}

async function upsertDigestCursor(userId, collectionId, lastVisitedAt) {
  const repo = getRepository();
  return storage
    .getExecutor()
    .transaction((tx) => repo.upsertDigestCursor(tx, userId, collectionId, lastVisitedAt));
}

async function recomputeActivityScores(collectionIds) {
  return getRepository().recomputeActivityScores(collectionIds);
}

async function getCentroids(collectionIds, modelId) {
  return getRepository().getCentroids(collectionIds, modelId);
}

async function upsertCentroid(collectionId, modelId, centroid, memberCount) {
  const repo = getRepository();
  return storage
    .getExecutor()
    .transaction((tx) => repo.upsertCentroid(tx, collectionId, modelId, centroid, memberCount));
}

async function deleteCentroids(collectionId) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.deleteCentroids(tx, collectionId));
}

async function isTombstoned(ownerId, defFingerprint) {
  return getRepository().isTombstoned(ownerId, defFingerprint);
}

async function listTombstones(ownerId) {
  return getRepository().listTombstones(ownerId);
}

async function purgeExpiredTombstones(cutoff) {
  return getRepository().purgeExpiredTombstones(cutoff);
}

/**
 * Written inside the permanent-delete TX normally; exposed standalone for
 * direct tombstone management (non-journaled, §4.9 pass 4).
 */
async function addTombstone(ownerId, defFingerprint) {
  const repo = getRepository();
  return storage
    .getExecutor()
    .transaction((tx) => repo.insertTombstone(tx, ownerId, defFingerprint));
}

async function upsertMergeSuggestion(aId, bId, score) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.upsertMergeSuggestion(tx, aId, bId, score));
}

async function listMergeSuggestions(collectionIds) {
  return getRepository().listMergeSuggestions(collectionIds);
}

async function setSuggestionState(suggestionId, state) {
  const repo = getRepository();
  return storage
    .getExecutor()
    .transaction((tx) => repo.setSuggestionState(tx, suggestionId, state));
}

module.exports = {
  getCollection,
  listForUser,
  listArchived,
  existsActiveName,
  createCollection,
  renameCollection,
  setPinned,
  setPublishMode,
  setAutoPin,
  archiveCollection,
  restoreCollection,
  deleteCollectionPermanent,
  mergeCollections,
  touchMemberChange,
  listStoredItems,
  getStoredItem,
  addItem,
  removeItem,
  addItems,
  removeItems,
  listExclusions,
  isExcluded,
  addExclusion,
  removeExclusion,
  setItemPublished,
  listForNodes,
  listGrants,
  getGrant,
  grantAccess,
  revokeAccess,
  setVisible,
  isHiddenFor,
  getDigestCursor,
  listDigestCursorMap,
  upsertDigestCursor,
  recomputeActivityScores,
  getCentroids,
  upsertCentroid,
  deleteCentroids,
  isTombstoned,
  listTombstones,
  purgeExpiredTombstones,
  addTombstone,
  upsertMergeSuggestion,
  listMergeSuggestions,
  setSuggestionState,
};
