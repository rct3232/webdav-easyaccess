'use strict';

/**
 * textBackfillScope — text-node coverage classification and the deterministic
 * text half of the ONE admin re-embed action
 * (docs/spec/server/services/aiJobService.md §2.4).
 *
 * Mirrors `media/mediaBackfillScope.js`: read-only, store-facade reads only
 * (no SQL), deterministic id ordering, bounded samples. It classifies every
 * live non-media file node in the requested scope against the ACTIVE embed
 * model into `embedded | missing | stale_space`; `planTextBackfill` returns the
 * re-embed node-id list and enqueues nothing.
 *
 * Admin payloads consume counts/ids only — this module never returns names,
 * paths or content.
 */

const {
  classifyMediaNode,
  collectAllRootRows,
  collectOwnRootRows,
  readInBatches,
  DEFAULT_SAMPLE_SIZE,
} = require('./media/mediaBackfillScope');

/** The four canonical text ladder sources (+ defensive `other`). */
const TEXT_SOURCES = Object.freeze(['fulltext', 'chunk_pool', 'head', 'metadata_only']);
const CANONICAL_TEXT_SOURCES = new Set(['fulltext', 'chunk_pool', 'head', 'metadata_only']);

function isTextNode(row) {
  return Boolean(row) && row.type !== 'directory' && classifyMediaNode(row) === null;
}

/**
 * Classify live non-media file nodes against the active embed model.
 *
 * @param {Object} opts
 * @param {number} [opts.userId] requester scope; omitted/null ⇒ every live root
 * @param {number} opts.modelId active embed `llm_models.id`
 * @param {Object} opts.fileNodesStore node enumeration facade
 * @param {Object} opts.embeddingsStore pooled-row facade (`getByNodeIds`)
 * @param {number} [opts.sampleSize=20]
 * @returns {Promise<Object>} scope
 */
async function buildTextBackfillScope({
  userId = null,
  modelId,
  fileNodesStore,
  embeddingsStore,
  sampleSize = DEFAULT_SAMPLE_SIZE,
} = {}) {
  if (!fileNodesStore) throw new TypeError('buildTextBackfillScope requires a fileNodesStore');
  if (!embeddingsStore) throw new TypeError('buildTextBackfillScope requires an embeddingsStore');
  const activeModelId = Number(modelId);
  if (!Number.isFinite(activeModelId)) {
    throw new TypeError('buildTextBackfillScope requires a numeric modelId');
  }
  const size = Number.isFinite(Number(sampleSize))
    ? Math.max(0, Math.floor(Number(sampleSize)))
    : DEFAULT_SAMPLE_SIZE;

  const rows =
    userId === null || userId === undefined
      ? await collectAllRootRows(fileNodesStore)
      : await collectOwnRootRows(fileNodesStore, userId);

  const byNodeId = new Map();
  for (const row of rows || []) {
    const nodeId = Number(row.nodeId);
    if (!Number.isFinite(nodeId)) continue;
    byNodeId.set(nodeId, row);
  }
  const textNodes = [...byNodeId.values()]
    .filter(isTextNode)
    .sort((a, b) => Number(a.nodeId) - Number(b.nodeId));
  const ids = textNodes.map((row) => Number(row.nodeId));
  const pooledRows =
    ids.length === 0
      ? []
      : await readInBatches(ids, (batch) => embeddingsStore.getByNodeIds(batch));
  const pooledById = new Map(pooledRows.map((row) => [Number(row.nodeId), row]));

  const bySource = Object.fromEntries(TEXT_SOURCES.map((source) => [source, 0]));
  const missingIds = [];
  const staleIds = [];
  let embedded = 0;

  for (const node of textNodes) {
    const nodeId = Number(node.nodeId);
    const pooled = pooledById.get(nodeId);
    if (!pooled) {
      missingIds.push(nodeId);
      continue;
    }
    if (Number(pooled.modelId) !== activeModelId) {
      staleIds.push(nodeId);
      continue;
    }
    embedded += 1;
    const bucket = CANONICAL_TEXT_SOURCES.has(pooled.source) ? pooled.source : 'other';
    // The canonical four always exist; an unexpected historical source is
    // surfaced additively instead of silently disappearing.
    bySource[bucket] = (bySource[bucket] || 0) + 1;
  }

  return {
    userId: userId === null || userId === undefined ? null : Number(userId),
    modelId: activeModelId,
    totals: {
      files: textNodes.length,
      embedded,
      missing: missingIds.length,
      stale: staleIds.length,
    },
    bySource,
    missingIds,
    staleIds,
    sampleMissing: missingIds.slice(0, size),
    sampleStale: staleIds.slice(0, size),
  };
}

/**
 * The text half of the admin re-embed plan: missing ∪ stale_space, id-ascending.
 * Enqueues nothing.
 *
 * @param {{ scope: Object, limit?: number|null }} opts
 * @returns {number[]}
 */
function planTextBackfill({ scope, limit } = {}) {
  if (!scope) return [];
  const ids = [...(scope.missingIds || []), ...(scope.staleIds || [])].map(Number);
  const ordered = [...new Set(ids.filter(Number.isFinite))].sort((a, b) => a - b);
  const cap =
    Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : null;
  return cap === null ? ordered : ordered.slice(0, cap);
}

module.exports = {
  TEXT_SOURCES,
  isTextNode,
  buildTextBackfillScope,
  planTextBackfill,
};
