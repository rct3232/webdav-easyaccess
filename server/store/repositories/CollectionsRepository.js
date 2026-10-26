'use strict';

/**
 * CollectionsRepository — domain interface over the `collection*` table
 * cluster (docs/spec/server/store/collectionsStore.md §2.2–2.4;
 * repository-contract rule 1: one interface per domain, the conformance suite
 * groups cases per table).
 *
 * Rows are domain-shaped (ids as numbers, timestamps ISO strings, booleans as
 * booleans; `definition` parses on both dialects). Write methods take `tx` —
 * they run INSIDE a caller-owned transaction (the facade's commitChange TX for
 * journaled mutators, the permanent-delete TX, or the facade's own
 * single-statement transaction wrappers); read methods execute directly.
 *
 * @typedef {Object} CollectionsRepository
 * @property {'sqlite'|'postgres'} dialect
 *
 * // collections
 * @property {(collectionId) => Promise<Object|null>} getCollection
 * @property {(tx, collectionId) => Promise<Object|null>} getCollectionTx
 * @property {(userId, { sort?, status? }) => Promise<Array>} listForUser
 *   Own + granted rows; `status` defaults to 'active' ('all' opts into every
 *   status) — the store-contract filter (collectionsStore.md §2.1).
 *   sort ∈ activity|name|created|updated (SQL); status defaults to 'active'.
 * @property {(ownerId) => Promise<Array>} listArchived
 * @property {(ownerId, name) => Promise<boolean>} existsActiveName
 * @property {(tx, input) => Promise<{ id: number }>} insertCollection
 * @property {(tx, collectionId, name, lockName?) => Promise<{ changes }>} renameCollection
 * @property {(tx, collectionId, pinned, pinnedBy) => Promise<{ changes }>} updatePin
 * @property {(tx, collectionId) => Promise<{ changes }>} setAutoPin
 * @property {(tx, collectionId, publishMode) => Promise<{ changes }>} updatePublishMode
 * @property {(tx, collectionId) => Promise<{ changes }>} archiveRow
 * @property {(tx, collectionId) => Promise<{ changes }>} restoreRow
 * @property {(tx, collectionId) => Promise<{ changes }>} deleteCollectionRow
 *
 * // membership (items ∪ derived − exclusions)
 * @property {(collectionId, { since? }) => Promise<Array>} listStoredItems
 * @property {(collectionId, nodeId) => Promise<Object|null>} getStoredItem
 * @property {(tx, collectionId, nodeId, addedBy, { published?, source?, reason? }) => Promise<{ changes }>} insertItem
 * @property {(tx, collectionId, nodeId) => Promise<{ changes }>} deleteItem
 * @property {(tx, collectionId, nodeIds, published) => Promise<{ changes }>} setItemPublished
 * @property {(collectionId) => Promise<number[]>} listExclusions
 * @property {(collectionId, nodeId) => Promise<boolean>} isExcluded
 * @property {(tx, collectionId, nodeId) => Promise<{ changes }>} insertExclusion
 * @property {(tx, collectionId, nodeId) => Promise<{ changes }>} deleteExclusion
 * @property {(userId, nodeIds) => Promise<Array>} listForNodes
 * @property {(tx, collectionId) => Promise<{ changes }>} touchMemberChange
 *
 * // sharing, visibility, cursors, centroids, tombstones, suggestions
 * @property {(collectionId) => Promise<Array>} listGrants
 * @property {(collectionId, granteeId) => Promise<Object|null>} getGrant
 * @property {(tx, collectionId, granteeId, role, grantedBy) => Promise<{ changes }>} upsertGrant
 * @property {(tx, collectionId, granteeId) => Promise<{ changes }>} deleteGrant
 * @property {(tx, userId, collectionId, hidden) => Promise<{ changes }>} setVisible
 * @property {(userId, collectionId) => Promise<boolean>} isHiddenFor
 * @property {(userId, collectionId) => Promise<string|null>} getDigestCursor
 * @property {(userId) => Promise<Object>} listDigestCursorMap
 *   Batched `{ [collection_id]: isoString }` — collections WITHOUT a cursor row
 *   are absent keys (never-opened; client new-dot rule, ruling 2026-10-01).
 * @property {(tx, userId, collectionId, lastVisitedAt) => Promise<{ changes }>} upsertDigestCursor
 * @property {(tx, userId, collectionId) => Promise<{ changes }>} deleteDigestCursor
 *   Revoke companion (ruling B, 2026-10-02): deletes ONLY the (user, collection)
 *   row; absent row = `{ changes: 0 }`, never throws.
 * @property {(collectionIds?) => Promise<{ changes }>} recomputeActivityScores
 * @property {(collectionIds, modelId) => Promise<Array>} getCentroids
 * @property {(tx, collectionId, modelId, centroid, memberCount) => Promise<{ changes }>} upsertCentroid
 * @property {(tx, collectionId) => Promise<{ changes }>} deleteCentroids
 * @property {(ownerId, defFingerprint) => Promise<boolean>} isTombstoned
 * @property {(ownerId) => Promise<Array>} listTombstones
 * @property {(cutoff) => Promise<{ changes }>} purgeExpiredTombstones
 * @property {(tx, ownerId, defFingerprint) => Promise<{ changes }>} insertTombstone
 * @property {(tx, aId, bId, score) => Promise<Object|null>} upsertMergeSuggestion
 * @property {(collectionIds?) => Promise<Array>} listMergeSuggestions
 * @property {(tx, suggestionId, state) => Promise<{ changes }>} setSuggestionState
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {CollectionsRepository}
 */
module.exports = function createCollectionsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createCollectionsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/CollectionsRepository.sqlite')
      : require('./postgres/CollectionsRepository.postgres');
  return impl(executor);
};
