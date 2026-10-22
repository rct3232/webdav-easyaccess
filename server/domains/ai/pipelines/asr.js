'use strict';

/**
 * asr pipeline — the V3 transcription path of the AI worker
 * (docs/spec/server/services/aiJobService.md §2.4 `asr`,
 * AI_FEATURE_PLAN §4.21 V3).
 *
 * One job = one audio node: read the bytes → ffprobe metadata (V0 probe row +
 * `media_kind` detection from container tags) → `asrTranscribe` with the
 * adapter-owned escape prompt (callers cannot omit it) → conditional write:
 * a `none` answer writes NO transcript; otherwise `transcript` + `asr_model_id`
 * + `probe` + `media_kind`. The E13 field freeze holds: there is no
 * audio_desc/genre/mood field anywhere.
 *
 * Vocal music stores its LYRICS in `transcript` while `media_kind='music'`
 * excludes the row from document-content scoring (the embed ladder and the
 * features input apply that filter). Then ONE `embed` job is chained for the
 * same node/generation.
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { drainKind } = require('./pipelineRunner');
const mediaSampling = require('../media/mediaSampling');

const OWN_KIND = AI_JOB_KIND.ASR;
/** Every other kind stays parked during this pipeline's claims (§2.3). */
const PARKED_KINDS = AI_JOB_KIND.ALL.filter((kind) => kind !== OWN_KIND);

/** The adapter owns the fixed escape prompt; the flag is part of its template. */
const ASR_OPTIONS = Object.freeze({ escapePrompt: true });

/** Normalizes the model answer; `none` (any case) means "no audible speech". */
function isNoneTranscript(text) {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.!。]+$/, '');
  return normalized === '' || normalized === 'none';
}

function createAsrPipeline(deps = {}) {
  const log = deps.log || { warn: console.warn.bind(console) };

  function jobsStore() {
    return deps.aiJobsStore || require('../../../store/aiJobsStore');
  }
  function enrichmentsStore() {
    return deps.aiEnrichmentsStore || require('../../../store/aiEnrichmentsStore');
  }

  async function runAsrJob(job, ctx) {
    const nodeId = Number(job.nodeId);
    const generation = Number(job.generation);

    if (!ctx.capabilityEnabled('asr')) {
      await ctx.jobs.markSkipped(job.id, 'capability_absent');
      return 'skipped';
    }

    const node = await ctx.readNode(nodeId);
    if (!node) {
      await ctx.jobs.markSkipped(job.id, 'node_missing');
      return 'skipped';
    }
    const buffer = await ctx.readBlob(nodeId);
    if (!buffer || buffer.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'missing_content');
      return 'skipped';
    }

    // V0 metadata + media_kind: metadata-scoped only, no generated fields.
    const probe = await ctx.probe(buffer, { mimeType: node.mimeType });
    const mediaKind = mediaSampling.detectMediaKind(probe);

    const result = await ctx.adapter.asrTranscribe(buffer, ASR_OPTIONS);
    const transcript = String((result && result.text) || '').trim();

    if (!isNoneTranscript(transcript)) {
      const asrModelId = await ctx.asrModelId();
      await ctx.enrichments.upsert(nodeId, {
        transcript,
        ...(asrModelId != null ? { asrModelId } : {}),
        probe,
        ...(mediaKind ? { mediaKind } : {}),
      });
    }

    // Chain the embed: without a transcript the embed falls back to the V0
    // metadata_only floor. Enqueue failures are logged and dropped (§2.6).
    try {
      await ctx.jobs.enqueue(nodeId, AI_JOB_KIND.EMBED, generation, job.contentHash ?? null);
    } catch (error) {
      log.warn(`[asrPipeline] embed chain failed for node ${nodeId}: ${error}`);
    }

    await ctx.jobs.markDone(job.id);
    return 'done';
  }

  /**
   * Drain entry point. Parks (returns 0 without claiming) while the asr role
   * is unconfigured — queued jobs stay queued, zero attempt inflation.
   */
  async function runPendingAsrJobs(overrides = {}) {
    const merged = { ...deps, ...overrides };
    const jobs = merged.aiJobsStore || jobsStore();
    const adapter = merged.adapter;
    if (!adapter || typeof adapter.asrTranscribe !== 'function') return 0;

    if (typeof adapter.roleConfigured === 'function') {
      let configured = false;
      try {
        configured = await adapter.roleConfigured('asr');
      } catch (error) {
        log.warn(`[asrPipeline] asr role gate read failed: ${error?.message ?? error}`);
        return 0;
      }
      if (!configured) return 0;
    }

    await jobs.recoverStaleRunning(0);

    const ctx = {
      jobs,
      adapter,
      enrichments: merged.aiEnrichmentsStore || enrichmentsStore(),
      readNode: merged.readNode,
      readBlob: merged.readBlob,
      probe: merged.probe || ((buffer, opts) => mediaSampling.ffprobeMedia(buffer, opts)),
      asrModelId: merged.asrModelId || (async () => null),
      capabilityEnabled: merged.capabilityEnabled || (() => true),
    };
    if (typeof ctx.readNode !== 'function' || typeof ctx.readBlob !== 'function') {
      throw new Error('asr pipeline requires readNode/readBlob seams');
    }

    return drainKind({
      jobs,
      kind: OWN_KIND,
      excludeKinds: PARKED_KINDS,
      jobTimeoutMs: Number(merged.jobTimeoutMs) || 0,
      log,
      execute: (job) => runAsrJob(job, ctx),
    });
  }

  return { runAsrJob, runPendingAsrJobs, ASR_OPTIONS };
}

const shared = createAsrPipeline();

module.exports = {
  createAsrPipeline,
  runPendingAsrJobs: shared.runPendingAsrJobs,
  ASR_OPTIONS,
};
