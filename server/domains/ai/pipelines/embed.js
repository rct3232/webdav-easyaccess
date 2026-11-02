'use strict';

/**
 * embed pipeline — the per-job executor of the `embed` kind
 * (docs/spec/server/services/aiJobService.md §2.4, §2.3).
 *
 * Two input families share one output contract (pooled row + segment rows in
 * ONE tx through the vectorStore seam's injected write hooks):
 *
 *   - TEXT documents: content-hash dedupe skip → chunk-pool ladder →
 *     `llmAdapter.embed` → pooled `source='chunk_pool'`.
 *   - MEDIA (image/video/audio), media ladder from llmAdapter §2.6:
 *       capability ON  → `embedMedia` over the sampled segments (image single,
 *                        audio fixed windows, video uniform-stride frames) →
 *                        every segment vector + mean+renormalized pooled row,
 *                        `source='media_direct'`;
 *       capability OFF → the V2 corpus (caption for visual, transcript for
 *                        audio with `media_kind='music'` excluded) through the
 *                        text ladder (`chunk_pool`);
 *       no corpus      → the V0 metadata string (name/mime/path/date) →
 *                        `source='metadata_only'`.
 *     Media never head-truncates; the media ladder only segments.
 *
 * A runtime model/dim ≠ the node's persisted pooled-row identity enqueues ONE
 * deduped backfill shadow-rebuild driver (llmAdapter §2.3 stale-dim rule: the
 * comparison is against the per-row `embeddings.dim`, never `llm_models`).
 *
 * IO is injected (adapter / readText / readNode / readBlob / enrichments /
 * media helpers) so the drain function `runPendingEmbedJobs(deps)` is
 * hermetically testable — zero HTTP, zero blob reads when stubbed. All writes
 * ride ONE transaction per job through `deps.transaction` (vectorStore.md
 * §2.2 division of labor).
 *
 * All pipeline state is DB-backed (the `ai_jobs` queue + canonical
 * embedding rows) — no in-memory AI state anywhere in this domain
 * (CODING_STYLE.md gate).
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { meanPool, serializeVector } = require('../vectorStore/vectorMath');
const { chunkPool } = require('../extractors/textChunking');
const { drainKind } = require('./pipelineRunner');
const mediaSampling = require('../media/mediaSampling');
const {
  MEDIA_CAPABILITY,
  classifyMediaNode,
  mediaFallbackCorpus,
} = require('../media/mediaBackfillScope');

/** Kinds without a landed executor — parked via claimNext (§2.3). */
const UNEXECUTABLE_KINDS = [AI_JOB_KIND.FEATURES];

/** Every kind except the pipeline's own: predicate-level park (§2.3). */
const NON_EMBED_KINDS = AI_JOB_KIND.ALL.filter((kind) => kind !== AI_JOB_KIND.EMBED);

/** Profile fallback when no media profile is injected (EG2 release values). */
const DEFAULT_MEDIA_PROFILE = Object.freeze({
  engine: 'embedded',
  windowTokens: 8192,
  budgetTokens: 8192,
  mediaTokenCost: { image: 280, videoFrame: 140, audioPerSec: 25 },
});

/** V0 floor corpus: name/mime/path/date — same text space, weak hits kept. */
async function metadataText(node, ctx) {
  let path = node.path;
  if (!path && typeof ctx.resolvePath === 'function') {
    try {
      path = await ctx.resolvePath(node);
    } catch {
      path = null;
    }
  }
  return [node.name, node.mimeType, path, node.createdAt]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(String)
    .join(' | ');
}

/**
 * @param {Object} deps
 * @param {Object} [deps.aiJobsStore] queue facade (default: server/store/aiJobsStore)
 * @param {Object} [deps.embeddingsStore] pooled facade (default: server/store/embeddingsStore)
 * @param {Object} [deps.aiEnrichmentsStore] caption/transcript corpus reader
 * @param {(modelId: number) => Promise<number|null>} [deps.activeModelId] the ACTIVE
 *   embed `llm_models.id` (llmModelsStore.getActiveByRole('embed'))
 * @param {Object} [deps.adapter] llmAdapter seam exposing `embed(texts[])` and
 *   `embedMedia(buffers[], { mediaType })`
 * @param {(nodeId: number) => Promise<string|null>} [deps.readText] locally extracted
 *   document text
 * @param {(nodeId: number) => Promise<Object|null>} [deps.readNode] node lookup
 *   (name/mimeType/type/path — media classification + V0 corpus)
 * @param {(nodeId: number) => Promise<Buffer|null>} [deps.readBlob] node bytes
 *   (media sampling; transient)
 * @param {(node: Object) => Promise<string|null>} [deps.resolvePath] display path
 *   for the V0 metadata string (read only on the metadata_only path)
 * @param {(capability: string) => boolean} [deps.capabilityEnabled] published
 *   probe matrix (default: llmAdapter probeState)
 * @param {Function} [deps.mediaProfile] async () => { engine, windowTokens,
 *   budgetTokens, mediaTokenCost } — the media ladder budget input
 * @param {Function} [deps.sampleFrames] video frame sampler seam
 * @param {Function} [deps.decodeAudio] audio→mono 16 kHz seam
 * @param {number} [deps.chunkBudget] sampled-chunk cap (LLM_CHUNK_BUDGET, default 4)
 * @param {number} [deps.maxChunkChars] paragraph/heading ladder window (§4.3)
 * @param {Object} [deps.vectorStore] seam hooks `{ upsertPooled, replaceChunks, transaction }`
 *   (default: the canonical write hooks over the real stores)
 * @param {Function} [deps.log] logger seam
 * @returns {Promise<number>} number of embed jobs driven to a terminal state this pass
 */
function createEmbedPipeline(deps = {}) {
  function jobsStore() {
    return deps.aiJobsStore || require('../../../store/aiJobsStore');
  }

  function pooledStore() {
    return deps.embeddingsStore || require('../../../store/embeddingsStore');
  }

  function enrichmentsStore() {
    return deps.aiEnrichmentsStore || require('../../../store/aiEnrichmentsStore');
  }

  function nodesStore() {
    return deps.fileNodesStore || require('../../../store/fileNodesStore').createFileNodesStore();
  }

  function blobStore() {
    if (deps.blobStorageService) return deps.blobStorageService;
    const { getComposition } = require('../../../service/composition');
    return getComposition().blobStorageService;
  }

  function capabilityProbe() {
    return (
      deps.capabilityEnabled ||
      ((capability) =>
        require('../../../infrastructure/adapters/llm/probeState').isCapabilityEnabled(capability))
    );
  }

  function log() {
    return deps.log || { warn: console.warn.bind(console) };
  }

  /**
   * Canonical write hooks over the REAL stores, tx-bound: the vectorStore
   * seam contract (§2.2) demands ONE transaction around the pooled + chunk
   * halves, and the sqlite/PG executors serialize whole transactions — a
   * nested `executor.transaction` inside the open one deadlocks on the
   * queue. The hooks therefore execute the repositories' own statements on
   * the CURRENT tx handle (statement shapes mirrored bit-for-bit from the
   * A2 twins; the seam factory consumes the identical injection shape).
   */
  function vectorHooks() {
    if (deps.vectorStore) return deps.vectorStore;
    const executor = require('../../../store/storage').getExecutor();
    const isPostgres = executor.dialect === 'postgres';
    const p = isPostgres ? (i) => `$${i + 1}` : () => '?';
    const POOLED_SQL = `INSERT INTO embeddings (node_id, model_id, dim, vector, source, content_hash, updated_at)
         VALUES (${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, CURRENT_TIMESTAMP)
         ON CONFLICT(node_id) DO UPDATE SET
           model_id = excluded.model_id,
           dim = excluded.dim,
           vector = excluded.vector,
           source = excluded.source,
           content_hash = excluded.content_hash,
           updated_at = CURRENT_TIMESTAMP`;
    const CHUNK_DELETE_SQL = isPostgres
      ? 'DELETE FROM embeddings_chunk WHERE node_id = $1 AND model_id = $2'
      : 'DELETE FROM embeddings_chunk WHERE node_id = ? AND model_id = ?';
    const CHUNK_INSERT_SQL = `INSERT INTO embeddings_chunk (node_id, chunk_idx, model_id, vector, updated_at)
         VALUES (${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, CURRENT_TIMESTAMP)
         ON CONFLICT (node_id, chunk_idx) DO UPDATE SET
           vector = excluded.vector,
           model_id = excluded.model_id,
           updated_at = CURRENT_TIMESTAMP`;
    return {
      async upsertPooled(tx, row) {
        await tx.run(POOLED_SQL, [
          Number(row.nodeId),
          Number(row.modelId),
          Number(row.dim),
          row.vector,
          row.source,
          row.contentHash ?? null,
        ]);
      },
      async replaceChunks(tx, nodeId, modelId, vectorTexts) {
        await tx.run(CHUNK_DELETE_SQL, [Number(nodeId), Number(modelId)]);
        for (let chunkIdx = 0; chunkIdx < vectorTexts.length; chunkIdx++) {
          await tx.run(CHUNK_INSERT_SQL, [
            Number(nodeId),
            chunkIdx,
            Number(modelId),
            vectorTexts[chunkIdx],
          ]);
        }
      },
      transaction: (fn) => executor.transaction(fn),
      dialect: executor.dialect,
      isPostgres,
    };
  }

  /** Validate a provider batch against the input count; returns `{vectors, dim}`. */
  function readProviderResult(result, expectedCount) {
    const vectors = Array.isArray(result?.vectors) ? result.vectors : [];
    const dim = Number(result?.dim);
    if (vectors.length !== expectedCount || !Number.isFinite(dim) || dim <= 0) {
      throw new Error('embed adapter returned a malformed vector batch');
    }
    return { vectors, dim };
  }

  /**
   * Stale-space driver (llmAdapter §2.3 + aiJobService §2.4): compare the
   * runtime model+dim against the node's PERSISTED per-row values. Failures
   * are logged and dropped — the next embed re-enqueues.
   */
  async function maybeEnqueueShadowRebuild(job, ctx, dim) {
    if (!ctx.existing) return;
    if (ctx.existing.modelId === ctx.modelId && ctx.existing.dim === dim) return;
    const nodeId = Number(job.nodeId);
    try {
      await ctx.jobs.enqueue(
        nodeId,
        AI_JOB_KIND.BACKFILL,
        Number(job.generation),
        `shadow-rebuild:${nodeId}:${ctx.modelId}`
      );
    } catch (error) {
      log().warn(`[embedPipeline] shadow-rebuild enqueue failed for node ${nodeId}: ${error}`);
    }
  }

  /**
   * The single canonical write: pooled half = mean+renormalize, chunk half =
   * every segment vector, ONE TX (vectorStore.md §2.2).
   */
  async function persistVectors(job, ctx, { vectors, dim, source }) {
    const nodeId = Number(job.nodeId);
    await maybeEnqueueShadowRebuild(job, ctx, dim);
    const pooledVec = meanPool(vectors);
    await ctx.hooks.transaction(async (tx) => {
      await ctx.hooks.upsertPooled(tx, {
        nodeId,
        modelId: ctx.modelId,
        dim,
        vector: serializeVector(pooledVec),
        source,
        contentHash: job.contentHash ?? null,
      });
      await ctx.hooks.replaceChunks(
        tx,
        nodeId,
        ctx.modelId,
        vectors.map((vector) => serializeVector(vector))
      );
    });
    await ctx.jobs.markDone(job.id);
    return 'done';
  }

  /** §2.4 text ladder head: chunk-pool over one corpus string. */
  async function embedTextCorpus(job, ctx, text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const { chunks } = chunkPool(text, {
      maxChunkChars: ctx.maxChunkChars,
      chunkBudget: ctx.chunkBudget,
    });
    if (chunks.length === 0) return null;
    const result = await ctx.adapter.embed(chunks);
    const { vectors, dim } = readProviderResult(result, chunks.length);
    return persistVectors(job, ctx, { vectors, dim, source: 'chunk_pool' });
  }

  /**
   * Media corpus for the capability-OFF fallback (V2 caption / V3 transcript).
   * The selection rule itself is centralized in `mediaFallbackCorpus`
   * (music rows never enter a document-content corpus).
   */
  async function mediaFallbackText(nodeId, mediaKind, ctx) {
    const row = await ctx.enrichments.get(nodeId);
    const corpus = mediaFallbackCorpus(mediaKind, row);
    return corpus ? corpus.text : null;
  }

  /**
   * Media ladder segment set (llmAdapter §2.6): image single, audio fixed
   * windows, video uniform-stride frames. Video frames ride the image media
   * path (the frame set IS the video segment set).
   */
  async function buildMediaSegments(buffer, mediaKind, node, ctx) {
    const profile = { ...DEFAULT_MEDIA_PROFILE, ...(await ctx.mediaProfile()) };
    const mediaTokenCost = profile.mediaTokenCost || DEFAULT_MEDIA_PROFILE.mediaTokenCost;
    const budgetTokens =
      profile.engine === 'embedded'
        ? Number(profile.windowTokens) || DEFAULT_MEDIA_PROFILE.windowTokens
        : Number(profile.budgetTokens) || DEFAULT_MEDIA_PROFILE.budgetTokens;

    if (mediaKind === 'image') {
      return { buffers: [buffer], mediaType: 'image' };
    }
    if (mediaKind === 'audio') {
      const samples = await ctx.decodeAudio(buffer, { mimeType: node.mimeType });
      const windowSec = mediaSampling.audioWindowSec({ budgetTokens, mediaTokenCost });
      const windows = mediaSampling.audioWindows(samples, { windowSec });
      return {
        buffers: windows
          .filter((window) => window.length > 0)
          .map((window) => mediaSampling.encodeWavMono16k(window)),
        mediaType: 'audio',
      };
    }
    const maxFrames = mediaSampling.videoFrameCap({ budgetTokens, mediaTokenCost });
    const frames = await ctx.sampleFrames(buffer, {
      maxFrames,
      mimeType: node.mimeType,
    });
    return { buffers: frames, mediaType: 'image' };
  }

  async function runMediaEmbed(job, ctx, node, mediaKind) {
    const nodeId = Number(job.nodeId);
    const buffer = await ctx.readBlob(nodeId);
    if (!buffer || buffer.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'missing_content');
      return 'skipped';
    }

    if (ctx.capabilityEnabled(MEDIA_CAPABILITY[mediaKind])) {
      const segments = await buildMediaSegments(buffer, mediaKind, node, ctx);
      const buffers = segments.buffers.filter((item) => item && item.length > 0);
      if (buffers.length === 0) {
        await ctx.jobs.markSkipped(job.id, 'no_media_segments');
        return 'skipped';
      }
      const result = await ctx.adapter.embedMedia(buffers, {
        mediaType: segments.mediaType,
      });
      const { vectors, dim } = readProviderResult(result, buffers.length);
      return persistVectors(job, ctx, { vectors, dim, source: 'media_direct' });
    }

    const corpus = await mediaFallbackText(nodeId, mediaKind, ctx);
    if (corpus) {
      const done = await embedTextCorpus(job, ctx, corpus);
      if (done) return done;
    }

    // V0 floor: the metadata string is always available and always searchable
    // in the same text space (weak hits preserved).
    const text = await metadataText(node, ctx);
    const result = await ctx.adapter.embed([text]);
    const { vectors, dim } = readProviderResult(result, 1);
    return persistVectors(job, ctx, { vectors, dim, source: 'metadata_only' });
  }

  /**
   * One embed job, terminal state included. Returns the outcome string for
   * the drain counter: 'done' | 'skipped' | 'failed'.
   */
  async function runEmbedJob(job, ctx) {
    const nodeId = Number(job.nodeId);
    const contentHash = job.contentHash ?? null;

    // §2.2 content_hash skip: same active model + same hash ⇒ no provider
    // call, no write (embeddingsStore §2.4 — determinism within a model).
    const existing = await ctx.pooled.get(nodeId);
    if (
      existing &&
      existing.modelId === ctx.modelId &&
      contentHash &&
      existing.contentHash === contentHash
    ) {
      await ctx.jobs.markSkipped(job.id, 'content_hash_dedupe');
      return 'skipped';
    }

    // §2.3 step 4 (role gate): no live adapter ⇒ park (never claim-and-fail).
    if (!ctx.adapter || typeof ctx.adapter.embed !== 'function') {
      throw new Error('embed role is not configured');
    }

    const jobCtx = { ...ctx, existing };

    const node = ctx.readNode ? await ctx.readNode(nodeId) : null;
    const mediaKind = classifyMediaNode(node);
    if (mediaKind) {
      if (typeof ctx.adapter.embedMedia !== 'function') {
        throw new Error('embed role does not expose media embedding');
      }
      return runMediaEmbed(job, jobCtx, node, mediaKind);
    }

    const text = await ctx.readText(nodeId);
    if (typeof text !== 'string' || text.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'unextractable_text');
      return 'skipped';
    }

    const done = await embedTextCorpus(job, jobCtx, text);
    if (!done) {
      await ctx.jobs.markSkipped(job.id, 'unextractable_text');
      return 'skipped';
    }
    return done;
  }

  /**
   * Drain entry point: reap stale claims once, then park&drain every
   * claimable `embed` job this pass. Returns the terminal count.
   */
  async function runPendingEmbedJobs(overrides = {}) {
    const merged = { ...deps, ...overrides };
    const jobs = merged.aiJobsStore || jobsStore();
    const pooled = merged.embeddingsStore || pooledStore();
    const adapter = merged.adapter;
    const hooks = merged.vectorStore ? { ...vectorHooks(), ...merged.vectorStore } : vectorHooks();

    // §2.3 step 2: startup reap — claimed-but-unfinished jobs re-arm here.
    await jobs.recoverStaleRunning(0);

    const modelId = merged.activeModelId ? await merged.activeModelId() : null;
    if (!modelId) return 0;

    const ctx = {
      jobs,
      pooled,
      adapter,
      hooks,
      modelId,
      existing: null,
      readText: merged.readText,
      readNode: merged.readNode || ((nodeId) => nodesStore().getNode(nodeId)),
      readBlob: merged.readBlob || ((nodeId) => blobStore().downloadBlob(nodeId)),
      resolvePath: merged.resolvePath,
      enrichments: merged.aiEnrichmentsStore || enrichmentsStore(),
      capabilityEnabled: merged.capabilityEnabled || capabilityProbe(),
      mediaProfile: merged.mediaProfile || (async () => DEFAULT_MEDIA_PROFILE),
      sampleFrames:
        merged.sampleFrames || ((buffer, opts) => mediaSampling.sampleVideoFrames(buffer, opts)),
      decodeAudio:
        merged.decodeAudio || ((buffer, opts) => mediaSampling.decodeAudioToMono16k(buffer, opts)),
      chunkBudget: Number.isFinite(Number(merged.chunkBudget)) ? Number(merged.chunkBudget) : 4,
      maxChunkChars: Number.isFinite(Number(merged.maxChunkChars))
        ? Number(merged.maxChunkChars)
        : 2000,
      jobTimeoutMs: Number(merged.jobTimeoutMs) || 0,
    };

    return drainKind({
      jobs,
      kind: AI_JOB_KIND.EMBED,
      excludeKinds: merged.excludeKinds || NON_EMBED_KINDS,
      jobTimeoutMs: ctx.jobTimeoutMs,
      log: log(),
      execute: (job) => runEmbedJob(job, ctx),
    });
  }

  return { runEmbedJob, runPendingEmbedJobs, UNEXECUTABLE_KINDS };
}

const shared = createEmbedPipeline();

module.exports = {
  createEmbedPipeline,
  runPendingEmbedJobs: shared.runPendingEmbedJobs,
  UNEXECUTABLE_KINDS,
};
