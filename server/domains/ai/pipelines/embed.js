'use strict';

/**
 * embed pipeline — the B5 (T1.3b) per-job executor of the AI worker
 * (docs/spec/server/services/aiJobService.md §2.4, §2.3).
 *
 * Scope within B5: the TEXT file path of the `embed` kind — content-hash
 * dedupe skip → chunk-pool ladder → llmAdapter.embed → canonical
 * pooled/chunk writes through the vectorStore seam's injected write hooks →
 * markDone; a runtime dim ≠ the node's persisted pooled-row dim enqueues ONE
 * deduped backfill shadow-rebuild driver (llmAdapter §2.3 stale-dim rule:
 * the comparison is against the per-row `embeddings.dim`, never
 * `llm_models`). The overlength ladder tail (truncate-head → metadata_only
 * → skip), media/segment paths, and the full worker loop belong to later
 * units; the ladder head here is the merged A5 `chunkPool`.
 *
 * IO is injected (adapter / readText / store hooks) so the drain function
 * `runPendingEmbedJobs(deps)` is hermetically testable — zero HTTP, zero
 * blob reads. All writes ride ONE transaction per job through
 * `deps.transaction` (vectorStore.md §2.2 division of labor: pooled half,
 * chunk half and shadow sync share the TX; the hook pair mirrors the
 * repository twins' statements so a degraded JsFallback engine stays a
 * legal sink).
 *
 * All pipeline state is DB-backed (the `ai_jobs` queue + canonical
 * embedding rows) — no in-memory AI state anywhere in this domain
 * (CODING_STYLE.md gate).
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { meanPool, serializeVector } = require('../vectorStore/vectorMath');
const { chunkPool } = require('../extractors/textChunking');

/** Kinds without a landed executor yet — parked via claimNext (§2.3). */
const UNEXECUTABLE_KINDS = [
  AI_JOB_KIND.FEATURES,
  AI_JOB_KIND.CAPTION,
  AI_JOB_KIND.ASR,
  AI_JOB_KIND.BACKFILL,
];

/**
 * @param {Object} deps
 * @param {Object} [deps.aiJobsStore] queue facade (default: server/store/aiJobsStore)
 * @param {Object} [deps.embeddingsStore] pooled facade (default: server/store/embeddingsStore)
 * @param {Object} [deps.embeddingsChunkStore] chunk facade (default: server/store/embeddingsChunkStore)
 * @param {(modelId: number) => Promise<number|null>} [deps.activeModelId] the ACTIVE
 *   embed `llm_models.id` (llmModelsStore.getActiveByRole('embed'))
 * @param {Object} [deps.adapter] llmAdapter seam exposing `embed(texts[])` →
 *   `{ vectors[][], dim, modelId, degraded? }`
 * @param {(nodeId: number) => Promise<string|null>} [deps.readText] locally extracted
 *   document text (blobStorageService.downloadBlob + documentText.extractText at wiring)
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
  function chunkStore() {
    return deps.embeddingsChunkStore || require('../../../store/embeddingsChunkStore');
  }
  void chunkStore; // wired by the vectorStore factory at boot; kept for the seam contract

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

  /**
   * One embed job, terminal state included. Returns the outcome string for
   * the drain counter: 'done' | 'skipped' | 'failed'.
   */
  async function runEmbedJob(job, ctx) {
    const { modelId, adapter, readText, hooks } = ctx;
    const nodeId = Number(job.nodeId);
    const generation = Number(job.generation);
    const contentHash = job.contentHash ?? null;

    // §2.2 content_hash skip: same active model + same hash ⇒ no provider
    // call, no write (embeddingsStore §2.4 — determinism within a model).
    const existing = await ctx.pooled.get(nodeId);
    if (
      existing &&
      existing.modelId === modelId &&
      contentHash &&
      existing.contentHash === contentHash
    ) {
      await ctx.jobs.markSkipped(job.id, 'content_hash_dedupe');
      return 'skipped';
    }

    // §2.3 step 4 (role gate): no live adapter ⇒ park (never claim-and-fail).
    if (!adapter || typeof adapter.embed !== 'function') {
      throw new Error('embed role is not configured');
    }

    const text = await readText(nodeId);
    if (typeof text !== 'string' || text.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'unextractable_text');
      return 'skipped';
    }

    // §2.4 ladder head: chunk-pool (budget VALUES caller-supplied, A5).
    const { chunks } = chunkPool(text, {
      maxChunkChars: ctx.maxChunkChars,
      chunkBudget: ctx.chunkBudget,
    });
    if (chunks.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'unextractable_text');
      return 'skipped';
    }

    // §2.3 step 7: config resolves per claim — the adapter call IS the claim's
    // resolution; a transport failure here is a retryable job failure.
    const result = await adapter.embed(chunks);
    const vectors = Array.isArray(result?.vectors) ? result.vectors : [];
    const dim = Number(result?.dim);
    if (vectors.length !== chunks.length || !Number.isFinite(dim) || dim <= 0) {
      throw new Error('embed adapter returned a malformed vector batch');
    }

    // llmAdapter §2.3 stale-dim rule: compare the RUNTIME dim against the
    // node's PERSISTED per-row dim — never llm_models (no dim column).
    // Mismatch ⇒ ONE deduped backfill shadow-rebuild driver; the enqueue
    // failure is logged and dropped (the next embed re-enqueues).
    if (existing && existing.modelId === modelId && existing.dim !== dim) {
      try {
        await ctx.jobs.enqueue(
          nodeId,
          AI_JOB_KIND.BACKFILL,
          generation,
          `shadow-rebuild:${nodeId}:${modelId}`
        );
      } catch (error) {
        log().warn(`[embedPipeline] shadow-rebuild enqueue failed for node ${nodeId}: ${error}`);
      }
    }

    // Vector-space writes: pooled half = mean+renormalize, chunk half = the
    // sampled set, ONE TX (vectorStore.md §2.2 division of labor). The hooks
    // run the repositories' statements on the tx handle (nested
    // executor.transaction deadlocks on the serialized sqlite queue).
    const pooledVec = meanPool(vectors);
    await hooks.transaction(async (tx) => {
      await hooks.upsertPooled(tx, {
        nodeId,
        modelId,
        dim,
        vector: serializeVector(pooledVec),
        source: 'chunk_pool',
        contentHash,
      });
      await hooks.replaceChunks(
        tx,
        nodeId,
        modelId,
        vectors.map((v) => serializeVector(v))
      );
    });

    await ctx.jobs.markDone(job.id);
    return 'done';
  }

  /**
   * §2.3 step 5 per-job wall clock (AI_JOB_TIMEOUT_MS, default 120000).
   * On timeout the rejection hits the drain loop's catch ⇒ markFailed ⇒
   * backoff; the underlying execution continues and its late markDone is a
   * {changes:0} no-op (§2.3 step 6 — never resurrects).
   */
  async function runEmbedJobGuarded(job, ctx) {
    const timeoutMs = Number(ctx.jobTimeoutMs) > 0 ? Number(ctx.jobTimeoutMs) : 0;
    if (!timeoutMs) return runEmbedJob(job, ctx);
    let timer = null;
    try {
      return await Promise.race([
        runEmbedJob(job, ctx),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`embed job ${job.id} timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
      readText: merged.readText,
      modelId,
      chunkBudget: Number.isFinite(Number(merged.chunkBudget)) ? Number(merged.chunkBudget) : 4,
      maxChunkChars: Number.isFinite(Number(merged.maxChunkChars))
        ? Number(merged.maxChunkChars)
        : 2000,
      jobTimeoutMs: Number(merged.jobTimeoutMs) || 0,
    };

    let terminal = 0;
    for (;;) {
      const job = await jobs.claimNext({ excludeKinds: UNEXECUTABLE_KINDS });
      if (!job) break;
      if (job.kind !== AI_JOB_KIND.EMBED) continue; // filter-parity guard, never execute
      try {
        const outcome = await runEmbedJobGuarded(job, ctx);
        if (outcome !== 'failed') terminal += 1;
      } catch (error) {
        // §2.3 step 5: any throw ⇒ markFailed ⇒ backoff ladder; a reap race
        // surfaces as { changes: 0 } (late-writer logs+drops, never resurrects).
        const flipped = await jobs.markFailed(job.id, error?.message ?? String(error));
        if (flipped.changes === 0) {
          log().warn(
            `[embedPipeline] late write on job ${job.id} dropped (${error?.message ?? error})`
          );
        }
      }
    }
    return terminal;
  }

  return { runEmbedJob, runPendingEmbedJobs, UNEXECUTABLE_KINDS };
}

const shared = createEmbedPipeline();

module.exports = {
  createEmbedPipeline,
  runPendingEmbedJobs: shared.runPendingEmbedJobs,
  UNEXECUTABLE_KINDS,
};
