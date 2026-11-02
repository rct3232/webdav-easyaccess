'use strict';

/**
 * dupFinderService — exact-duplicate finder, HASH-FIRST
 * (docs/spec/server/services/dupFinderService.md; AI_FEATURE_PLAN §4.17 +
 * PoC E2 ruling: cosine-1.0 detection is redundant, so there is zero vector
 * /LLM involvement here). Scope: the requester's OWN live subtree files
 * (§4.16 hygiene is self-storage). HARD RULE (PLAN T0.1 / register (b)):
 * `content_hash IS NULL` rows NEVER form a group — before the backfill lands
 * such rows are simply uncovered, and inventing a "NULL group" would claim
 * duplicates from unrelated content.
 *
 * Pure read/compute over `fileNodesStore.listSubtreeCacheRows` — proposals
 * persist on `storage_suggestions` only with the T3.3 store/route specs; the
 * §4.16 Storage surface consumes this through the storage domain.
 */

const { createFileNodesStore } = require('../../store/fileNodesStore');

function buildDisplayPath(node, byId) {
  const segments = [];
  const seen = new Set();
  let current = node;
  while (current && !seen.has(Number(current.nodeId))) {
    seen.add(Number(current.nodeId));
    segments.unshift(String(current.name));
    current = byId.get(Number(current.parentId));
  }
  return `/${segments.join('/')}`;
}

function emptySummary() {
  return { groupCount: 0, duplicateCount: 0, reclaimableBytes: 0 };
}

/**
 * Exact-dup groups of the requester's own subtree, hash-first.
 * @param {number|string} userId
 * @returns {Promise<{ groups: Array<{ contentHash: string, sizeBytes: number, nodeIds: number[], filePaths: string[] }>, groupCount: number, duplicateCount: number, reclaimableBytes: number }>}
 */
async function findExactDuplicateGroups(userId) {
  const store = createFileNodesStore();
  const root = await store.getUserRootNode(userId);
  if (!root) return { groups: [], ...emptySummary() };

  const rows = await store.listSubtreeCacheRows(root.id);
  const byId = new Map(rows.map((row) => [Number(row.nodeId), row]));

  const byHash = new Map();
  for (const row of rows) {
    if (row.type !== 'file') continue;
    const hash = row.contentHash;
    if (hash === null || hash === undefined || hash === '') continue; // register (b)
    const key = String(hash);
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push(row);
  }

  const groups = [];
  for (const [contentHash, members] of byHash) {
    if (members.length < 2) continue;
    const nodeIds = members.map((row) => Number(row.nodeId)).sort((a, b) => a - b);
    const sizeBytes = Number(members[0].size) || 0;
    groups.push({
      contentHash,
      sizeBytes,
      nodeIds,
      filePaths: nodeIds.map((nodeId) => buildDisplayPath(byId.get(nodeId), byId)),
    });
  }
  groups.sort((a, b) => a.nodeIds[0] - b.nodeIds[0]);

  const duplicateCount = groups.reduce((total, group) => total + group.nodeIds.length, 0);
  const reclaimableBytes = groups.reduce(
    (total, group) => total + group.sizeBytes * (group.nodeIds.length - 1),
    0
  );
  return {
    groups,
    groupCount: groups.length,
    duplicateCount,
    reclaimableBytes,
  };
}

/** §4.16 hygiene-card projection: counts + reclaimable bytes, no detail. */
async function summarizeExactDuplicates(userId) {
  const { groupCount, duplicateCount, reclaimableBytes } = await findExactDuplicateGroups(userId);
  return { groupCount, duplicateCount, reclaimableBytes };
}

module.exports = { findExactDuplicateGroups, summarizeExactDuplicates };
