'use strict';

/**
 * mediaBackfillScope — media coverage classification and the deterministic
 * re-embed plan behind the ONE admin-launched backfill action
 * (docs/spec/server/services/aiJobService.md §2.4 media branch + backfill
 * ownership).
 *
 * This module is the single source of truth for two media rules shared with
 * the `embed` pipeline:
 *
 *   - `classifyMediaNode(node)` — image/video/audio membership (shared
 *     `fileTypes` extension first, stored mime as the fallback), so the
 *     pipeline and the scope builder never disagree about which nodes are
 *     media;
 *   - `mediaFallbackCorpus(mediaKind, enrichment)` — the capability-OFF corpus
 *     (V2 caption for visual, V3 transcript for audio; rows flagged
 *     `media_kind='music'` NEVER enter a document-content corpus).
 *
 * `buildMediaBackfillScope` is READ-ONLY: it classifies every media node of
 * one scope into the six coverage states and returns counts plus bounded,
 * deterministic samples. `planMediaBackfill` turns a scope into the node-id
 * list an admin action would re-embed — it never enqueues anything (the admin
 * action and its rate limit own the enqueue).
 *
 * All reads ride the store facades (`fileNodesStore`, `embeddingsStore`,
 * `aiEnrichmentsStore`); this module holds no SQL.
 */

const { getFileType } = require('@webdav-easyaccess/shared/fileTypes');

/** Media modalities in deterministic reporting order. */
const MEDIA_KINDS = Object.freeze(['image', 'video', 'audio']);

/** The per-modality direct-embed capability gating the media ladder. */
const MEDIA_CAPABILITY = Object.freeze({
  image: 'image_embed',
  video: 'video_embed',
  audio: 'audio_embed',
});

/** Text-corpus fallback per modality (`chunk_pool` rows on a media node). */
const FALLBACK_SOURCE = Object.freeze({
  image: 'caption_fallback',
  video: 'caption_fallback',
  audio: 'transcript_fallback',
});

/** Coverage states, in reporting order — `bySource` carries all six. */
const COVERAGE_STATES = Object.freeze([
  'media_direct',
  'caption_fallback',
  'transcript_fallback',
  'metadata_only',
  'missing',
  'stale_space',
]);

/** Bounded sample size for the admin preview (deterministic: lowest ids). */
const DEFAULT_SAMPLE_SIZE = 20;

/** Store read batch: `IN (...)` batches stay well under SQLite's limit. */
const ID_BATCH_SIZE = 500;

/** Pooled-row `source` value of the V0 metadata floor. */
const METADATA_SOURCE = 'metadata_only';

/**
 * Media modality of a node, or `null` for anything else (documents, folders).
 * Extension wins (the write-side convention), stored mime is the fallback for
 * extension-less names (aiJobService §2.4 media branch).
 *
 * @param {{ name?: string, mimeType?: string|null, type?: string }|null} node
 * @returns {'image'|'video'|'audio'|null}
 */
function classifyMediaNode(node) {
  if (!node || node.type === 'directory') return null;
  const name = node.name === undefined || node.name === null ? '' : String(node.name);
  if (name) {
    const fileType = getFileType(name);
    if (MEDIA_KINDS.includes(fileType)) return fileType;
  }
  const mime = String(node.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/**
 * The capability-OFF embed corpus for one media node — the V2/V3 fallback.
 * Visual media uses `caption`; audio uses `transcript` UNLESS the row is
 * flagged `media_kind='music'` (vocal music stores lyrics there; those rows
 * never enter a document-content path).
 *
 * @param {'image'|'video'|'audio'} mediaKind
 * @param {{ caption?: string|null, transcript?: string|null, mediaKind?: string|null }|null} enrichment
 * @returns {{ source: 'caption_fallback'|'transcript_fallback', text: string }|null}
 */
function mediaFallbackCorpus(mediaKind, enrichment) {
  if (!enrichment || !mediaKind) return null;
  if (mediaKind === 'audio') {
    if (enrichment.mediaKind === 'music') return null;
    if (typeof enrichment.transcript !== 'string' || enrichment.transcript.length === 0) {
      return null;
    }
    return { source: 'transcript_fallback', text: enrichment.transcript };
  }
  if (typeof enrichment.caption !== 'string' || enrichment.caption.length === 0) return null;
  return { source: 'caption_fallback', text: enrichment.caption };
}

/**
 * Coverage state of a node whose pooled row lives in the CURRENT model space:
 * `media_direct` rows are the direct multimodal embed, `metadata_only` is the
 * V0 floor, and every text-ladder source (`chunk_pool`/`head`/`fulltext`) is
 * the caption/transcript fallback of that node's modality.
 *
 * @param {string} source pooled `embeddings.source`
 * @param {'image'|'video'|'audio'} mediaKind
 * @returns {'media_direct'|'caption_fallback'|'transcript_fallback'|'metadata_only'}
 */
function classifyPooledSource(source, mediaKind) {
  if (source === 'media_direct') return 'media_direct';
  if (source === METADATA_SOURCE) return 'metadata_only';
  return FALLBACK_SOURCE[mediaKind];
}

/** Read in bounded id batches; `read` resolves rows for one batch. */
async function readInBatches(ids, read) {
  const out = [];
  for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
    const batch = ids.slice(start, start + ID_BATCH_SIZE);
    out.push(...(await read(batch)));
  }
  return out;
}

/** Enumerate the requester's own-root subtree rows (one query per root). */
async function collectOwnRootRows(fileNodesStore, userId) {
  const root = await fileNodesStore.getUserRootNode(Number(userId));
  if (!root || root.id === undefined || root.id === null) return [];
  return fileNodesStore.listSubtreeCacheRows(Number(root.id));
}

/** Admin path: every live root subtree (top-level nodes have no parent). */
async function collectAllRootRows(fileNodesStore) {
  const roots = await fileNodesStore.getChildren(null);
  const rows = [];
  for (const root of roots || []) {
    const subtree = await fileNodesStore.listSubtreeCacheRows(Number(root.id));
    rows.push(...subtree);
  }
  return rows;
}

/**
 * Classify every media node in scope into the six coverage states.
 *
 * Reads: the scoped live node rows (`fileNodesStore`), ONE bulk pooled read of
 * the scoped ids (`embeddingsStore.getByNodeIds` — the node PK means a single
 * read observes BOTH the current-space rows and rows left in another space by
 * a model change), and ONE bulk enrichment read (`aiEnrichmentsStore`).
 *
 * @param {Object} opts
 * @param {number} [opts.userId] requester scope; omitted/`null` ⇒ the admin
 *   view over every live root subtree
 * @param {number} opts.modelId the ACTIVE embed `llm_models.id`
 * @param {Object} opts.fileNodesStore node enumeration facade
 * @param {Object} opts.embeddingsStore pooled-row facade (`getByNodeIds`)
 * @param {Object} opts.aiEnrichmentsStore enrichment facade (`getByNodeIds`)
 * @param {(capability: string) => boolean} [opts.capabilityEnabled] published
 *   probe matrix (default: llmAdapter `probeState`)
 * @param {number} [opts.sampleSize=20] bounded sample size per state
 * @returns {Promise<Object>} scope (see the shape in the spec, §2.4)
 */
async function buildMediaBackfillScope({
  userId = null,
  modelId,
  fileNodesStore,
  embeddingsStore,
  aiEnrichmentsStore,
  capabilityEnabled,
  sampleSize = DEFAULT_SAMPLE_SIZE,
} = {}) {
  if (!fileNodesStore) throw new TypeError('buildMediaBackfillScope requires a fileNodesStore');
  if (!embeddingsStore) throw new TypeError('buildMediaBackfillScope requires an embeddingsStore');
  const probe =
    capabilityEnabled ||
    ((capability) =>
      require('../../../infrastructure/adapters/llm/probeState').isCapabilityEnabled(capability));
  const activeModelId = Number(modelId);
  if (!Number.isFinite(activeModelId)) {
    throw new TypeError('buildMediaBackfillScope requires a numeric modelId');
  }
  const size = Number.isFinite(Number(sampleSize))
    ? Math.max(0, Math.floor(Number(sampleSize)))
    : DEFAULT_SAMPLE_SIZE;

  const rows =
    userId === null || userId === undefined
      ? await collectAllRootRows(fileNodesStore)
      : await collectOwnRootRows(fileNodesStore, userId);

  // One row per node id, id-ascending: every count and sample below derives
  // from this ordering, so the scope is deterministic.
  const byNodeId = new Map();
  for (const row of rows || []) {
    const nodeId = Number(row.nodeId);
    if (!Number.isFinite(nodeId)) continue;
    byNodeId.set(nodeId, row);
  }
  const mediaNodes = [...byNodeId.values()]
    .filter((row) => classifyMediaNode(row) !== null)
    .sort((a, b) => Number(a.nodeId) - Number(b.nodeId));

  const mediaIds = mediaNodes.map((row) => Number(row.nodeId));
  const pooledRows =
    mediaIds.length === 0
      ? []
      : await readInBatches(mediaIds, (ids) => embeddingsStore.getByNodeIds(ids));
  const enrichmentRows =
    mediaIds.length === 0 || !aiEnrichmentsStore
      ? []
      : await readInBatches(mediaIds, (ids) => aiEnrichmentsStore.getByNodeIds(ids));

  const pooledById = new Map(pooledRows.map((row) => [Number(row.nodeId), row]));
  const enrichmentById = new Map(enrichmentRows.map((row) => [Number(row.nodeId), row]));

  const bySource = Object.fromEntries(COVERAGE_STATES.map((state) => [state, 0]));
  const byMediaKind = Object.fromEntries(
    MEDIA_KINDS.map((kind) => [kind, { media: 0, embedded: 0, missing: 0, stale: 0 }])
  );
  const byCapability = { enabled: 0, disabled: 0 };
  const byCorpus = { caption: 0, transcript: 0, none: 0 };
  const missingIds = [];
  const staleIds = [];

  for (const node of mediaNodes) {
    const nodeId = Number(node.nodeId);
    const mediaKind = classifyMediaNode(node);
    const capability = MEDIA_CAPABILITY[mediaKind];
    const capabilityOn = probe(capability) === true;
    if (capabilityOn) byCapability.enabled += 1;
    else byCapability.disabled += 1;

    // Fallback-corpus availability of this node right now (V2 caption / V3
    // transcript; music rows never count).
    const corpus = mediaFallbackCorpus(mediaKind, enrichmentById.get(nodeId));
    if (!corpus) byCorpus.none += 1;
    else if (corpus.source === 'caption_fallback') byCorpus.caption += 1;
    else byCorpus.transcript += 1;

    const pooled = pooledById.get(nodeId);
    let state;
    if (!pooled) {
      state = 'missing';
      missingIds.push(nodeId);
    } else if (Number(pooled.modelId) !== activeModelId) {
      // Row left behind by a model change: re-projection candidate (§4.21).
      state = 'stale_space';
      staleIds.push(nodeId);
    } else {
      state = classifyPooledSource(pooled.source, mediaKind);
    }

    bySource[state] += 1;
    const kindBucket = byMediaKind[mediaKind];
    kindBucket.media += 1;
    if (state === 'missing') kindBucket.missing += 1;
    else if (state === 'stale_space') kindBucket.stale += 1;
    else kindBucket.embedded += 1;
  }

  const embedded =
    bySource.media_direct +
    bySource.caption_fallback +
    bySource.transcript_fallback +
    bySource.metadata_only;

  return {
    userId: userId === null || userId === undefined ? null : Number(userId),
    modelId: activeModelId,
    totals: {
      media: mediaNodes.length,
      embedded,
      missing: missingIds.length,
      stale: staleIds.length,
    },
    bySource,
    byMediaKind,
    byCapability,
    byCorpus,
    missingIds,
    staleIds,
    sampleMissing: missingIds.slice(0, size),
    sampleStale: staleIds.slice(0, size),
  };
}

/**
 * The node-id plan for the ONE admin-launched re-embed action: nodes without a
 * current-space row (`missing`, the initial coverage pass) plus nodes still
 * holding another space's row (`stale_space`, the model-change re-projection),
 * id-ascending so repeated calls over the same scope are identical. Enqueues
 * nothing — the admin action owns the enqueue and its rate limit.
 *
 * @param {{ scope: Object, limit?: number|null }} opts
 * @returns {number[]} deterministic node-id list (capped by `limit`)
 */
function planMediaBackfill({ scope, limit } = {}) {
  if (!scope) return [];
  const ids = [...(scope.missingIds || []), ...(scope.staleIds || [])].map(Number);
  const ordered = [...new Set(ids.filter(Number.isFinite))].sort((a, b) => a - b);
  const cap =
    Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : null;
  return cap === null ? ordered : ordered.slice(0, cap);
}

module.exports = {
  MEDIA_KINDS,
  MEDIA_CAPABILITY,
  FALLBACK_SOURCE,
  COVERAGE_STATES,
  DEFAULT_SAMPLE_SIZE,
  classifyMediaNode,
  mediaFallbackCorpus,
  buildMediaBackfillScope,
  planMediaBackfill,
  // Scope enumeration helpers reused by textBackfillScope (same live-root
  // semantics, no duplicated traversal).
  collectAllRootRows,
  collectOwnRootRows,
  readInBatches,
};
