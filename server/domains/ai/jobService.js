'use strict';

/**
 * AI jobs worker (docs/spec/server/services/aiJobService.md §2.3).
 *
 * Concurrency 1 per process. The loop gates the drain pass on the embed
 * role (llmAdapter `roleConfigured` — includes the built-in role while its
 * weights provision): an unconfigured role parks the pass so queued jobs
 * drain in claim order once the role flips configured — never
 * claim-and-fail, zero attempt inflation. Kinds without a landed executor
 * stay parked via the pipeline's additive `claimNext({ excludeKinds })`
 * filter (pipelines/embed.js UNEXECUTABLE_KINDS).
 *
 * All knobs are T2 hot (configRegistry: AI_WORKER_POLL_MS, AI_JOB_STALE_MS,
 * AI_JOB_TIMEOUT_MS, AI_WORKER_CONCURRENCY — the shipped defaults are the
 * spec §3 values). Seams are injectable for tests; production wiring is the
 * boot call in server/index.js; `WEA_SKIP_AI_WORKER` truthy makes
 * `startAiWorker` a no-op (§2.3 step 1).
 */

const DEFAULT_POLL_MS = 5000;
const DEFAULT_STALE_MS = 900000;
const DEFAULT_JOB_TIMEOUT_MS = 120000;

/** Numeric T2 knob read through the shared resolver; falls back to the
 * spec default when the resolver is absent (early boot / tests). */
async function configNumber(key, fallback) {
  try {
    const { getSharedResolver } = require('../../infrastructure/configResolver');
    const resolver = getSharedResolver();
    if (!resolver) return fallback;
    const raw = await resolver.getConfig(key);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function createAiJobService(deps = {}) {
  const timers = deps.timers || {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const log = deps.log || {
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };

  function jobsStore() {
    return deps.aiJobsStore || require('../../store/aiJobsStore');
  }

  function adapterRef() {
    if (Object.prototype.hasOwnProperty.call(deps, 'adapter')) return deps.adapter;
    if (deps.getAdapter) return deps.getAdapter();
    // Lazy require: consumers must not couple to boot order.
    const { getLlmAdapter } = require('../../infrastructure/llmAdapterRuntime');
    return getLlmAdapter();
  }

  function embedPipeline() {
    return deps.embedPipeline || require('./pipelines/embed');
  }

  /** Node bytes → locally extracted document text (§2.4 embed input).
   * Media / non-document mimes resolve to null ⇒ the pipeline's
   * `unextractable_text` skip; extractor code errors propagate (§2.3
   * step 5 typed skips / failures). */
  async function readNodeText(nodeId) {
    const fileNodesStore = deps.fileNodesStore || require('../../store/fileNodesStore');
    const { extractText } = require('./extractors/documentText');
    const blobStorageService =
      deps.blobStorageService ||
      (() => {
        const { getComposition } = require('../../service/composition');
        return getComposition().blobStorageService;
      })();
    const node = await fileNodesStore.getNode(nodeId);
    if (!node) return null;
    const buffer = await blobStorageService.downloadBlob(nodeId);
    if (!buffer) return null;
    try {
      const extracted = await extractText({ buffer, mimeType: node.mimeType });
      return extracted && typeof extracted.text === 'string' ? extracted.text : null;
    } catch (err) {
      if (err && err.code === 'unextractableText') return null;
      throw err;
    }
  }

  async function drainPass() {
    const adapter = adapterRef();
    if (!adapter || typeof adapter.roleConfigured !== 'function') return; // pre-init ⇒ park

    // §2.3 step 4 role gate (order matters): unconfigured ⇒ the pass parks,
    // queued jobs stay QUEUED unconsumed.
    let configured = false;
    try {
      configured = await adapter.roleConfigured('embed');
    } catch (err) {
      log.warn('[aiWorker] embed role gate read failed — parking this pass:', err?.message ?? err);
      return;
    }
    if (!configured) return;

    const { runPendingEmbedJobs } = embedPipeline();
    const jobTimeoutMs =
      deps.jobTimeoutMs ?? (await configNumber('AI_JOB_TIMEOUT_MS', DEFAULT_JOB_TIMEOUT_MS));
    try {
      await runPendingEmbedJobs({
        adapter,
        readText: deps.readText || readNodeText,
        jobTimeoutMs,
      });
    } catch (err) {
      log.error('[aiWorker] embed drain pass failed:', err?.message ?? err);
    }
  }

  async function pollIntervalMs() {
    if (deps.pollMs != null) return Number(deps.pollMs);
    return configNumber('AI_WORKER_POLL_MS', DEFAULT_POLL_MS);
  }

  let timer = null;
  let draining = false;
  let stopped = true;

  async function scheduleNext() {
    if (stopped || timer) return;
    const interval = await pollIntervalMs();
    timer = timers.setTimeout(async () => {
      timer = null;
      if (stopped || draining) {
        await scheduleNext();
        return;
      }
      draining = true;
      try {
        await drainPass();
      } finally {
        draining = false;
      }
      await scheduleNext();
    }, interval);
  }

  /**
   * Start the worker loop (idempotent — a second call is a no-op). Startup
   * once: reap claimed-but-unfinished jobs back to pending (§2.3 step 2).
   */
  async function startAiWorker() {
    if (process.env.WEA_SKIP_AI_WORKER) {
      return { started: false, reason: 'WEA_SKIP_AI_WORKER' };
    }
    if (!stopped) return { started: true };
    stopped = false;
    const staleMs = deps.staleMs ?? (await configNumber('AI_JOB_STALE_MS', DEFAULT_STALE_MS));
    try {
      await jobsStore().recoverStaleRunning(staleMs);
    } catch (err) {
      log.error('[aiWorker] stale-claim reap failed:', err?.message ?? err);
    }
    await scheduleNext();
    return { started: true };
  }

  /** Stop the loop; the in-flight drain pass finishes (no job is abandoned). */
  function stopAiWorker() {
    stopped = true;
    if (timer) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  return { startAiWorker, stopAiWorker, drainPass };
}

const shared = createAiJobService();

module.exports = {
  createAiJobService,
  startAiWorker: shared.startAiWorker,
  stopAiWorker: shared.stopAiWorker,
  drainPass: shared.drainPass,
};
