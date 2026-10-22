'use strict';

/**
 * AI jobs worker (docs/spec/server/services/aiJobService.md §2.3).
 *
 * Concurrency 1 per process. ONE drain pass runs every landed kind pipeline
 * (`embed`, `caption`, `asr`, `backfill`), each behind its own ROLE gate
 * (llmAdapter `roleConfigured` — includes the built-in embed role while its
 * weights provision): an unconfigured role parks only its pipeline, so its
 * queued jobs stay queued in claim order and drain once the role flips
 * configured — never claim-and-fail, zero attempt inflation. Every pipeline
 * also passes an additive `claimNext({ excludeKinds })` filter naming every
 * OTHER kind (pipelines/*.js), so the drains sharing this pass can never
 * double-claim and kinds without a landed executor (`features`) stay parked.
 * The `backfill` drain additionally requires the installed vectorStore seam
 * (the shadow-rebuild target); absent, its rows park with the embed gate.
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

/** Built-in embed model window in tokens — the media ladder budget input for
 * `engine='embedded'` (llmAdapter §2.5/§2.6; in-process, no server `ub`). */
const EMBEDDED_WINDOW_TOKENS = 8192;

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
  function captionPipeline() {
    return deps.captionPipeline || require('./pipelines/caption');
  }
  function asrPipeline() {
    return deps.asrPipeline || require('./pipelines/asr');
  }
  function backfillPipeline() {
    return deps.backfillPipeline || require('./pipelines/backfill');
  }

  function fileNodes() {
    return deps.fileNodesStore || require('../../store/fileNodesStore').createFileNodesStore();
  }

  function blobStorage() {
    if (deps.blobStorageService) return deps.blobStorageService;
    const { getComposition } = require('../../service/composition');
    return getComposition().blobStorageService;
  }

  function llmModels() {
    return deps.llmModelsStore || require('../../store/llmModelsStore');
  }

  async function activeRoleModelId(role) {
    const row = await llmModels().getActiveByRole(role);
    return row && row.id != null ? Number(row.id) : null;
  }

  /**
   * The media ladder's budget input (llmAdapter §2.6): embedded ⇒ the model
   * window; remote ⇒ the profile budget chain result. Token costs come from
   * the active embed preset profile.
   */
  async function mediaProfileForEmbed() {
    const { getPresetByFamilyRole } = require('../../infrastructure/adapters/llm/presets');
    const row = await llmModels().getActiveByRole('embed');
    const preset = row ? getPresetByFamilyRole(row.provider, 'embed') : null;
    const profile = (preset && preset.profile) || null;
    const budgetTokens =
      Number(row && row.maxInputChars) ||
      Number(preset && preset.budgets && preset.budgets.maxInputCharsDefault) ||
      EMBEDDED_WINDOW_TOKENS;
    return {
      engine: (row && row.engine) || 'embedded',
      windowTokens: EMBEDDED_WINDOW_TOKENS,
      budgetTokens,
      mediaTokenCost: (profile && profile.mediaTokenCost) || {
        image: 280,
        videoFrame: 140,
        audioPerSec: 25,
      },
    };
  }

  function capabilityProbe() {
    return (
      deps.capabilityEnabled ||
      ((capability) =>
        require('../../infrastructure/adapters/llm/probeState').isCapabilityEnabled(capability))
    );
  }

  /** Node bytes → locally extracted document text (§2.4 embed input).
   * Media / non-document mimes resolve to null ⇒ the pipeline's media branch
   * or its `unextractable_text` skip; extractor code errors propagate. */
  async function readNodeText(nodeId) {
    const node = await fileNodes().getNode(nodeId);
    if (!node) return null;
    const buffer = await blobStorage().downloadBlob(nodeId);
    if (!buffer) return null;
    const { extractText } = require('./extractors/documentText');
    try {
      const extracted = await extractText({ buffer, mimeType: node.mimeType });
      return extracted && typeof extracted.text === 'string' ? extracted.text : null;
    } catch (err) {
      if (err && err.code === 'unextractableText') return null;
      throw err;
    }
  }

  /** Node lookup for media classification + the V0 metadata corpus. */
  async function readNodeMeta(nodeId) {
    return fileNodes().getNode(nodeId);
  }

  /** Display path for the V0 metadata string — best-effort and only read on
   * the media metadata_only path (a missing ancestry row never fails a job). */
  async function nodeDisplayPath(node) {
    try {
      const { getComposition } = require('../../service/composition');
      return await getComposition().fileNodeService.getNodePath(node.id);
    } catch {
      return null;
    }
  }

  async function readNodeBlob(nodeId) {
    return blobStorage().downloadBlob(nodeId);
  }

  /**
   * §2.3 step 4 role gate (order matters): unconfigured ⇒ that pipeline
   * parks, its jobs stay QUEUED unconsumed. A gate read failure parks too.
   */
  async function roleGate(adapter, role) {
    try {
      return (await adapter.roleConfigured(role)) === true;
    } catch (err) {
      log.warn(`[aiWorker] ${role} role gate read failed — parking:`, err?.message ?? err);
      return false;
    }
  }

  async function jobTimeout() {
    return deps.jobTimeoutMs ?? (await configNumber('AI_JOB_TIMEOUT_MS', DEFAULT_JOB_TIMEOUT_MS));
  }

  async function drainPass() {
    const adapter = adapterRef();
    if (!adapter || typeof adapter.roleConfigured !== 'function') return; // pre-init ⇒ park

    // §2.3 step 4 role gates, one per pipeline role (order matters).
    const gates = {
      embed: await roleGate(adapter, 'embed'),
      vision: await roleGate(adapter, 'vision'),
      asr: await roleGate(adapter, 'asr'),
    };
    if (!gates.embed && !gates.vision && !gates.asr) return;

    const jobTimeoutMs = await jobTimeout();

    if (gates.embed) {
      const { runPendingEmbedJobs } = embedPipeline();
      // C6 writer wiring: the boot-selected vectorStore exposes the tx-first
      // write hooks (canonical halves + derived shadow in ONE TX). Absent store
      // (no active model / probe not run) ⇒ the pipeline's direct-SQL fallback.
      const vectorStore =
        deps.vectorStore !== undefined
          ? deps.vectorStore
          : require('./vectorStoreRuntime').getVectorStore();
      try {
        await runPendingEmbedJobs({
          adapter,
          readText: deps.readText || readNodeText,
          readNode: deps.readNode || readNodeMeta,
          readBlob: deps.readBlob || readNodeBlob,
          resolvePath: deps.resolvePath || nodeDisplayPath,
          capabilityEnabled: capabilityProbe(),
          mediaProfile: deps.mediaProfile || mediaProfileForEmbed,
          ...(deps.aiEnrichmentsStore ? { aiEnrichmentsStore: deps.aiEnrichmentsStore } : {}),
          ...(deps.sampleFrames ? { sampleFrames: deps.sampleFrames } : {}),
          ...(deps.decodeAudio ? { decodeAudio: deps.decodeAudio } : {}),
          jobTimeoutMs,
          ...(vectorStore && vectorStore.hooks ? { vectorStore: vectorStore.hooks } : {}),
          // §2.3 step 6: the ACTIVE embed model id gates the claim — resolved
          // per pass through the registry facade (boot syncModelRegistry rows
          // it); null ⇒ the pass drains nothing (nothing to score against).
          activeModelId: async () => activeRoleModelId('embed'),
        });
      } catch (err) {
        log.error('[aiWorker] embed drain pass failed:', err?.message ?? err);
      }

      // `backfill` = derived-index rebuild driver (no provider calls). Same
      // embed gate; no installed vectorStore ⇒ the rows park untouched.
      if (vectorStore) {
        const { runPendingBackfillJobs } = backfillPipeline();
        try {
          await runPendingBackfillJobs({
            vectorStore,
            jobTimeoutMs,
            ...(deps.aiJobsStore ? { aiJobsStore: deps.aiJobsStore } : {}),
            ...(deps.log ? { log: deps.log } : {}),
          });
        } catch (err) {
          log.error('[aiWorker] backfill drain pass failed:', err?.message ?? err);
        }
      }
    }

    if (gates.vision) {
      const { runPendingCaptionJobs } = captionPipeline();
      try {
        await runPendingCaptionJobs({
          adapter,
          readNode: deps.readNode || readNodeMeta,
          readBlob: deps.readBlob || readNodeBlob,
          visionModelId: async () => activeRoleModelId('vision'),
          capabilityEnabled: capabilityProbe(),
          ...(deps.aiEnrichmentsStore ? { aiEnrichmentsStore: deps.aiEnrichmentsStore } : {}),
          ...(deps.sampleFrames ? { sampleFrames: deps.sampleFrames } : {}),
          jobTimeoutMs,
        });
      } catch (err) {
        log.error('[aiWorker] caption drain pass failed:', err?.message ?? err);
      }
    }

    if (gates.asr) {
      const { runPendingAsrJobs } = asrPipeline();
      try {
        await runPendingAsrJobs({
          adapter,
          readNode: deps.readNode || readNodeMeta,
          readBlob: deps.readBlob || readNodeBlob,
          asrModelId: async () => activeRoleModelId('asr'),
          capabilityEnabled: capabilityProbe(),
          ...(deps.aiEnrichmentsStore ? { aiEnrichmentsStore: deps.aiEnrichmentsStore } : {}),
          ...(deps.probe ? { probe: deps.probe } : {}),
          jobTimeoutMs,
        });
      } catch (err) {
        log.error('[aiWorker] asr drain pass failed:', err?.message ?? err);
      }
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
