'use strict';

/**
 * Sentinel fixture for the admin AI panel contract
 * (docs/spec/client/components/mypage/content/AiAdminContent.md §2.4).
 *
 * Every rendered scalar carries a distinctive sentinel so a render-matrix
 * test can prove the exact payload field reached the DOM (and that a missing
 * field was not silently replaced by a zero). The same fixture feeds MSW, so
 * client tests and the mock transport can never drift from the contract.
 */

const {
  AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED,
  AI_ADMIN_NOT_INSTRUMENTED,
} = require('../aiAdminContract');

const AI_ADMIN_SENTINELS = Object.freeze({
  generatedAt: '2031-07-08T09:10:11.000Z',
  queuePending: 8101,
  queueRunning: 8102,
  queueDone: 8103,
  queueFailed: 8104,
  queueSkipped: 8105,
  queueCancelled: 8106,
  queueTotal: 8107,
  failed24h: 8108,
  finished24h: 8109,
  failureRate: 0.8123,
  failedJobId: 8110,
  failedJobNodeId: 8111,
  failedJobGeneration: 8112,
  failedJobAttempt: 8113,
  failedJobError: 'sentinel-last-error-8114',
  failedJobCreatedAt: '2031-07-08T09:00:00.000Z',
  failedJobFinishedAt: '2031-07-08T09:05:00.000Z',
  costCalls: 8121,
  costInputChars: 8122,
  costCached: 8123,
  costDegraded: 8124,
  costFailed429: 8125,
  callCap: 8126,
  tokenCap: 8127,
  nightEvalId: 8130,
  nightEvalUsers: 8131,
  nightEvalCollections: 8132,
  nightEvalMergeSuggested: 8133,
  pendingMerges: 8134,
  modelId: 8140,
  historyModelId: 8141,
  textFiles: 8150,
  textEmbedded: 8151,
  textMissing: 8152,
  textStale: 8153,
  textBySource: 8154,
  mediaFiles: 8160,
  mediaEmbedded: 8161,
  mediaMissing: 8162,
  mediaStale: 8163,
  mediaDirect: 8164,
  imageMedia: 8165,
  imageEmbedded: 8166,
  imageMissing: 8167,
  imageStale: 8168,
  capabilityEnabled: 8169,
  capabilityDisabled: 8170,
  corpusCaption: 8171,
  corpusTranscript: 8172,
  corpusNone: 8173,
  killSwitchImpact: 8180,
  gateImpact: 8181,
  activeJobs: 8182,
  generationEmbed: 8183,
  generationFeatures: 8184,
  generationCaption: 8185,
  generationAsr: 8186,
  previewText: 8190,
  previewMedia: 8191,
  previewUnion: 8192,
});

const BASE_MODEL = Object.freeze({
  id: AI_ADMIN_SENTINELS.modelId,
  role: 'embed',
  provider: 'embedded',
  engine: 'embedded',
  base_url_key: '',
  model_name: 'sentinel-embed-model',
  precision: 'q4',
  model_revision: 'sentinel-revision',
  max_input_chars: 8192,
  chunk_budget: 4,
  batch_size: 8,
  reasoning: 'off',
  enabled: true,
  created_at: '2031-07-07T00:00:00.000Z',
});

const HISTORY_MODEL = Object.freeze({
  ...BASE_MODEL,
  id: AI_ADMIN_SENTINELS.historyModelId,
  provider: 'llama.cpp',
  engine: 'remote',
  base_url_key: 'LLM_EMBED_BASE_URL',
  model_name: 'sentinel-history-model',
  precision: 'bf16',
  model_revision: null,
  max_input_chars: null,
  chunk_budget: null,
  batch_size: null,
  created_at: null,
});

const KILL_SWITCH = Object.freeze({
  key: 'AI_EVOLUTION_ENABLED',
  value: 'true',
  source: 'db',
  impact: { metric: 'night_eval_users', count: AI_ADMIN_SENTINELS.killSwitchImpact },
});

const GATE = Object.freeze({
  key: 'AI_EVOLUTION_INACTIVE_DAYS',
  value: '45',
  source: 'db',
  impact: { metric: 'night_eval_collections', count: AI_ADMIN_SENTINELS.gateImpact },
});

const NOT_INSTRUMENTED_GATE = Object.freeze({
  key: 'AI_USAGE_EVENT_RETENTION_DAYS',
  value: '30',
  source: 'default',
  impact: { metric: 'not_instrumented', count: null },
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
}

function merge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return overrides === undefined ? base : overrides;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base?.[key]
        ? merge(base[key], value)
        : clone(value);
  }
  return out;
}

/** A complete summary payload whose scalars are all sentinels. */
function createAiAdminPanelFixture(overrides = {}) {
  const summary = {
    generated_at: AI_ADMIN_SENTINELS.generatedAt,
    pipeline: {
      queue: {
        pending: AI_ADMIN_SENTINELS.queuePending,
        running: AI_ADMIN_SENTINELS.queueRunning,
        done: AI_ADMIN_SENTINELS.queueDone,
        failed: AI_ADMIN_SENTINELS.queueFailed,
        skipped: AI_ADMIN_SENTINELS.queueSkipped,
        cancelled: AI_ADMIN_SENTINELS.queueCancelled,
        total: AI_ADMIN_SENTINELS.queueTotal,
      },
      failed_24h: AI_ADMIN_SENTINELS.failed24h,
      finished_24h: AI_ADMIN_SENTINELS.finished24h,
      failure_rate_24h: AI_ADMIN_SENTINELS.failureRate,
      failed_jobs: [
        {
          id: AI_ADMIN_SENTINELS.failedJobId,
          node_id: AI_ADMIN_SENTINELS.failedJobNodeId,
          kind: 'embed',
          generation: AI_ADMIN_SENTINELS.failedJobGeneration,
          status: 'failed',
          attempt: AI_ADMIN_SENTINELS.failedJobAttempt,
          last_error: AI_ADMIN_SENTINELS.failedJobError,
          created_at: AI_ADMIN_SENTINELS.failedJobCreatedAt,
          started_at: null,
          finished_at: AI_ADMIN_SENTINELS.failedJobFinishedAt,
        },
      ],
      failed_jobs_display_only: true,
      capabilities: [
        {
          capability: 'image_embed',
          declared: true,
          probed: true,
          enabled: true,
          role: 'embed',
          note: null,
          reason: null,
        },
      ],
      breaker_states: { instrumented: false, reason: 'active_observation_required' },
    },
    cost: {
      day: '2031-07-08',
      roles: [
        {
          role: 'embed',
          calls: AI_ADMIN_SENTINELS.costCalls,
          input_chars: AI_ADMIN_SENTINELS.costInputChars,
          cached: AI_ADMIN_SENTINELS.costCached,
          degraded: AI_ADMIN_SENTINELS.costDegraded,
          failed_429: AI_ADMIN_SENTINELS.costFailed429,
        },
      ],
      caps: { call_cap: AI_ADMIN_SENTINELS.callCap, token_cap: AI_ADMIN_SENTINELS.tokenCap },
      per_user_top_n: { instrumented: false },
    },
    evolution: {
      latest_night_eval: {
        id: AI_ADMIN_SENTINELS.nightEvalId,
        status: 'ok',
        created_at: '2031-07-08T03:00:00.000Z',
        passes: 'full',
        totals: {
          users: AI_ADMIN_SENTINELS.nightEvalUsers,
          collections: AI_ADMIN_SENTINELS.nightEvalCollections,
          merge_suggested: AI_ADMIN_SENTINELS.nightEvalMergeSuggested,
        },
      },
      pending_merge_suggestions: AI_ADMIN_SENTINELS.pendingMerges,
      not_instrumented: [...AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED],
    },
    models: {
      roles: [
        {
          role: 'embed',
          active: clone(BASE_MODEL),
          history: [clone(HISTORY_MODEL)],
        },
      ],
      profiles: [
        {
          model_id: AI_ADMIN_SENTINELS.modelId,
          role: 'embed',
          preset_id: 'sentinel-preset',
          dim: 768,
          calibrated: false,
          pooling: 'mean',
          request_shape: 'content-wrapper',
          dtype: 'bf16|fp32',
          mrl_dims: [768, 512, 256],
          text_prefixes: {
            document: 'title: sentinel | text:',
            query: 'task: sentinel | query:',
          },
        },
      ],
    },
    coverage: {
      available: true,
      reason: null,
      model_id: AI_ADMIN_SENTINELS.modelId,
      text: {
        totals: {
          files: AI_ADMIN_SENTINELS.textFiles,
          embedded: AI_ADMIN_SENTINELS.textEmbedded,
          missing: AI_ADMIN_SENTINELS.textMissing,
          stale: AI_ADMIN_SENTINELS.textStale,
        },
        by_source: { fulltext: AI_ADMIN_SENTINELS.textBySource },
      },
      media: {
        totals: {
          media: AI_ADMIN_SENTINELS.mediaFiles,
          embedded: AI_ADMIN_SENTINELS.mediaEmbedded,
          missing: AI_ADMIN_SENTINELS.mediaMissing,
          stale: AI_ADMIN_SENTINELS.mediaStale,
        },
        by_source: { media_direct: AI_ADMIN_SENTINELS.mediaDirect },
        by_media_kind: {
          image: {
            media: AI_ADMIN_SENTINELS.imageMedia,
            embedded: AI_ADMIN_SENTINELS.imageEmbedded,
            missing: AI_ADMIN_SENTINELS.imageMissing,
            stale: AI_ADMIN_SENTINELS.imageStale,
          },
        },
        by_capability: {
          enabled: AI_ADMIN_SENTINELS.capabilityEnabled,
          disabled: AI_ADMIN_SENTINELS.capabilityDisabled,
        },
        by_corpus: {
          caption: AI_ADMIN_SENTINELS.corpusCaption,
          transcript: AI_ADMIN_SENTINELS.corpusTranscript,
          none: AI_ADMIN_SENTINELS.corpusNone,
        },
      },
    },
    gates: {
      kill_switches: [clone(KILL_SWITCH)],
      gates: [clone(GATE), clone(NOT_INSTRUMENTED_GATE)],
    },
    launcher: {
      available: true,
      reason: null,
      retry_after_seconds: 0,
      cooldown_seconds: 900,
      active_jobs: AI_ADMIN_SENTINELS.activeJobs,
      active_model_id: AI_ADMIN_SENTINELS.modelId,
      generations: {
        embed: AI_ADMIN_SENTINELS.generationEmbed,
        features: AI_ADMIN_SENTINELS.generationFeatures,
        caption: AI_ADMIN_SENTINELS.generationCaption,
        asr: AI_ADMIN_SENTINELS.generationAsr,
      },
    },
    not_instrumented: [...AI_ADMIN_NOT_INSTRUMENTED],
  };
  return merge(summary, overrides);
}

/** Read-only launcher preview mirroring the same coverage payload. */
function createAiAdminPreviewFixture(overrides = {}) {
  const summary = createAiAdminPanelFixture();
  const preview = {
    generated_at: AI_ADMIN_SENTINELS.generatedAt,
    available: true,
    reason: null,
    model_id: AI_ADMIN_SENTINELS.modelId,
    generations: clone(summary.launcher.generations),
    retry_after_seconds: 0,
    coverage: { text: clone(summary.coverage.text), media: clone(summary.coverage.media) },
    plan: {
      text_count: AI_ADMIN_SENTINELS.previewText,
      media_count: AI_ADMIN_SENTINELS.previewMedia,
      union_count: AI_ADMIN_SENTINELS.previewUnion,
    },
  };
  return merge(preview, overrides);
}

module.exports = {
  AI_ADMIN_SENTINELS,
  createAiAdminPanelFixture,
  createAiAdminPreviewFixture,
};
