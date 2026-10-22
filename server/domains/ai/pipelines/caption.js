'use strict';

/**
 * caption pipeline — the V2 media path of the AI worker
 * (docs/spec/server/services/aiJobService.md §2.4 `caption`,
 * AI_FEATURE_PLAN §4.21 V2).
 *
 * One job = one image/video node: locally sample frames (≤4, ffmpeg
 * uniform stride, TRANSIENT — nothing is written to disk beyond the temp
 * workspace removed before the job returns) → VLM captions in Korean →
 * `ai_enrichments.caption` + `caption_model_id` → chain ONE `embed` job for
 * the same node/generation (the caption is the media's text corpus) →
 * markDone.
 *
 * The role gate is `vision` through the adapter (`roleConfigured`); the
 * capability gate is `vision_chat` through the published probe matrix. A job
 * claimed with the capability OFF (the hook should not have enqueued it — the
 * hook's decision table already falls back to plain `embed`) is a typed skip,
 * never a failure.
 *
 * IO is injected (adapter / readNode / readBlob / enrichments / frame
 * sampler) so the drain is hermetically testable.
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { getFileType } = require('@webdav-easyaccess/shared/fileTypes');
const { drainKind } = require('./pipelineRunner');
const mediaSampling = require('../media/mediaSampling');

const OWN_KIND = AI_JOB_KIND.CAPTION;
/** Every other kind stays parked during this pipeline's claims (§2.3). */
const PARKED_KINDS = AI_JOB_KIND.ALL.filter((kind) => kind !== OWN_KIND);

/** Korean VLM instruction — display/adjudication material, not a search label. */
const CAPTION_PROMPT = '이 이미지의 주요 장면과 내용을 한국어로 두 문장 이내로 설명하세요.';
const MAX_CAPTION_FRAMES = 4;

function visualKindOf(node) {
  const fileType = getFileType(String((node && node.name) || ''));
  if (fileType === 'image') return 'image';
  if (fileType === 'video') return 'video';
  const mime = String((node && node.mimeType) || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function createCaptionPipeline(deps = {}) {
  const log = deps.log || { warn: console.warn.bind(console) };

  function jobsStore() {
    return deps.aiJobsStore || require('../../../store/aiJobsStore');
  }
  function enrichmentsStore() {
    return deps.aiEnrichmentsStore || require('../../../store/aiEnrichmentsStore');
  }
  async function runCaptionJob(job, ctx) {
    const nodeId = Number(job.nodeId);
    const generation = Number(job.generation);

    if (!ctx.capabilityEnabled('vision_chat')) {
      await ctx.jobs.markSkipped(job.id, 'capability_absent');
      return 'skipped';
    }

    const node = await ctx.readNode(nodeId);
    if (!node) {
      await ctx.jobs.markSkipped(job.id, 'node_missing');
      return 'skipped';
    }
    const visualKind = visualKindOf(node);
    if (!visualKind) {
      await ctx.jobs.markSkipped(job.id, 'not_visual_media');
      return 'skipped';
    }

    const buffer = await ctx.readBlob(nodeId);
    if (!buffer || buffer.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'missing_content');
      return 'skipped';
    }

    const frames =
      visualKind === 'image'
        ? [buffer]
        : await ctx.sampleFrames(buffer, {
            maxFrames: MAX_CAPTION_FRAMES,
            mimeType: node.mimeType,
          });
    if (!Array.isArray(frames) || frames.length === 0) {
      await ctx.jobs.markSkipped(job.id, 'no_frames');
      return 'skipped';
    }

    const result = await ctx.adapter.visionCaption(frames.slice(0, MAX_CAPTION_FRAMES), {
      prompt: CAPTION_PROMPT,
    });
    const caption = String((result && result.text) || '').trim();
    if (!caption) {
      // Provider flakiness is transient ⇒ retry via the backoff ladder.
      throw new Error('vision role returned an empty caption');
    }

    const captionModelId = await ctx.visionModelId();
    await ctx.enrichments.upsert(nodeId, {
      caption,
      ...(captionModelId != null ? { captionModelId } : {}),
    });

    // Chain the embed: the caption IS the media corpus when direct media
    // embedding is unavailable (§4.21 V2 fallback). Enqueue failures are
    // logged and dropped (§2.6) — the next hook/backfill heals.
    try {
      await ctx.jobs.enqueue(nodeId, AI_JOB_KIND.EMBED, generation, job.contentHash ?? null);
    } catch (error) {
      log.warn(`[captionPipeline] embed chain failed for node ${nodeId}: ${error}`);
    }

    await ctx.jobs.markDone(job.id);
    return 'done';
  }

  /**
   * Drain entry point. Parks (returns 0 without claiming) while the vision
   * role is unconfigured — queued caption jobs stay queued, zero attempt
   * inflation (§2.3 step 4).
   */
  async function runPendingCaptionJobs(overrides = {}) {
    const merged = { ...deps, ...overrides };
    const jobs = merged.aiJobsStore || jobsStore();
    const adapter = merged.adapter;
    if (!adapter || typeof adapter.visionCaption !== 'function') return 0;

    if (typeof adapter.roleConfigured === 'function') {
      let configured = false;
      try {
        configured = await adapter.roleConfigured('vision');
      } catch (error) {
        log.warn(`[captionPipeline] vision role gate read failed: ${error?.message ?? error}`);
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
      sampleFrames:
        merged.sampleFrames || ((buffer, opts) => mediaSampling.sampleVideoFrames(buffer, opts)),
      visionModelId: merged.visionModelId || (async () => null),
      capabilityEnabled: merged.capabilityEnabled || (() => true),
    };
    if (typeof ctx.readNode !== 'function' || typeof ctx.readBlob !== 'function') {
      throw new Error('caption pipeline requires readNode/readBlob seams');
    }

    return drainKind({
      jobs,
      kind: OWN_KIND,
      excludeKinds: PARKED_KINDS,
      jobTimeoutMs: Number(merged.jobTimeoutMs) || 0,
      log,
      execute: (job) => runCaptionJob(job, ctx),
    });
  }

  return { runCaptionJob, runPendingCaptionJobs, CAPTION_PROMPT, MAX_CAPTION_FRAMES };
}

const shared = createCaptionPipeline();

module.exports = {
  createCaptionPipeline,
  runPendingCaptionJobs: shared.runPendingCaptionJobs,
  CAPTION_PROMPT,
  MAX_CAPTION_FRAMES,
};
