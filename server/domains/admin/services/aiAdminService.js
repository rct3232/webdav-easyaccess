'use strict';

/**
 * aiAdminService — admin AI governance snapshot + the ONE unified re-embed
 * launcher (docs/spec/server/routes/admin.md §2.2.7).
 *
 * Privacy: aggregates and ids only. Failed-job rows carry node IDs, never
 * names/paths/queries; model/gate views never carry secrets. Coverage is
 * derived on read from live rows; nothing is persisted except launcher
 * generations, queued jobs and the settings-journal audit row.
 */

const { AI_JOB_KIND, JOURNAL_DOMAIN, LLM_ROLE } = require('@webdav-easyaccess/shared/constants');
const actionJournalStore = require('../../../store/actionJournalStore');
const aiJobsStore = require('../../../store/aiJobsStore');
const aiUsageDailyStore = require('../../../store/aiUsageDailyStore');
const adminReportsStore = require('../../../store/adminReportsStore');
const collectionsStore = require('../../../store/collectionsStore');
const embeddingsStore = require('../../../store/embeddingsStore');
const aiEnrichmentsStore = require('../../../store/aiEnrichmentsStore');
const llmModelsStore = require('../../../store/llmModelsStore');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const probeState = require('../../../infrastructure/adapters/llm/probeState');
const { LLM_PRESETS } = require('../../../infrastructure/adapters/llm/presets');
const lockManager = require('../../../infrastructure/lockManager');
const { buildTextBackfillScope, planTextBackfill } = require('../../ai/textBackfillScope');
const { buildMediaBackfillScope, planMediaBackfill } = require('../../ai/media/mediaBackfillScope');
const {
  GENERATION_KINDS,
  getGenerations,
  bumpGenerationsTx,
} = require('../../ai/generationSettings');
const {
  AI_REEMBED_SUBJECT,
  CURATED_AI_KILL_SWITCH_KEYS,
  CURATED_AI_GATE_KEYS,
} = require('./settingsJournalService');

const REEMBED_LOCK = 'ai-reembed-launcher';
const REEMBED_COOLDOWN_MS = 15 * 60 * 1000;
const REEMBED_SAMPLE_SIZE = 20;
const FAILED_JOB_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// Curated gate definitions: metadata only, never a value. Impact metrics are
// computed from the same snapshot; unavailable metrics return count null.
const KILL_SWITCH_DEFS = Object.freeze([
  { key: 'AI_SEMANTIC_SEARCH_ENABLED', metric: 'text_files' },
  { key: 'AI_NL_PARSE_ENABLED', metric: 'text_files' },
  { key: 'AI_EVOLUTION_ENABLED', metric: 'night_eval_users' },
  { key: 'AI_EVOLUTION_NIGHTLY_ENABLED', metric: 'night_eval_users' },
  { key: 'AI_EVOLUTION_CREATE_ENABLED', metric: 'night_eval_collections' },
  { key: 'AI_MERGE_SUGGESTIONS_ENABLED', metric: 'pending_merge_suggestions' },
  { key: 'AI_MERGE_ARBITER_ENABLED', metric: 'pending_merge_suggestions' },
]);

const GATE_DEFS = Object.freeze([
  { key: 'AI_EVOLUTION_INACTIVE_DAYS', metric: 'night_eval_users' },
  { key: 'AI_EVOLUTION_MIN_AGE_DAYS', metric: 'night_eval_collections' },
  { key: 'AI_EVOLUTION_CREATE_RATE_DAYS', metric: 'night_eval_collections' },
  { key: 'AI_ACTIVITY_HALF_LIFE_DAYS', metric: 'night_eval_users' },
  { key: 'AI_USAGE_EVENT_RETENTION_DAYS', metric: 'not_instrumented' },
  { key: 'ARCHIVE_RETENTION_DAYS', metric: 'night_eval_collections' },
  { key: 'AI_SUGGESTION_RETENTION_DAYS', metric: 'not_instrumented' },
]);

const NOT_INSTRUMENTED = Object.freeze([
  'survival_curves',
  'merge_accept_series',
  'per_version_history',
  'per_user_top_n',
]);

function serviceError(code, status, params) {
  const error = new Error(code);
  error.status = status;
  if (params != null) error.params = params;
  return error;
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const ms = instantMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function wireModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    provider: row.provider,
    engine: row.engine,
    base_url_key: row.baseUrlKey,
    model_name: row.modelName,
    precision: row.precision ?? null,
    model_revision: row.modelRevision ?? null,
    max_input_chars: row.maxInputChars ?? null,
    chunk_budget: row.chunkBudget ?? null,
    batch_size: row.batchSize ?? null,
    reasoning: row.reasoning,
    enabled: row.enabled,
    created_at: toIso(row.createdAt),
  };
}

function findProfilePreset(role, model) {
  if (!model) return null;
  return (
    LLM_PRESETS.find(
      (preset) =>
        preset.roles.includes(role) &&
        (model.engine === 'embedded' ? preset.engine === 'embedded' : preset.engine === 'remote')
    ) || null
  );
}

function wireProfile(role, model) {
  const preset = findProfilePreset(role, model);
  if (!preset) return null;
  const profile = preset.profile || {};
  return {
    model_id: model.id,
    role,
    preset_id: preset.id,
    dim: profile.dim ?? null,
    calibrated: profile.calibrated === true,
    pooling: profile.pooling ?? null,
    request_shape: profile.requestShape ?? null,
    dtype: profile.dtype ?? null,
    mrl_dims: profile.mrlDims ?? null,
    text_prefixes: profile.textPrefixes ?? null,
  };
}

function wireTextCoverage(scope) {
  return {
    totals: { ...scope.totals },
    by_source: { ...scope.bySource },
  };
}

function wireMediaCoverage(scope) {
  return {
    totals: { ...scope.totals },
    by_source: { ...scope.bySource },
    by_media_kind: { ...scope.byMediaKind },
    by_capability: { ...scope.byCapability },
    by_corpus: { ...scope.byCorpus },
  };
}

/** SQLite CURRENT_TIMESTAMP is UTC without a zone marker; parse it as UTC. */
function instantMs(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return Date.parse(text);
  return Date.parse(`${text.replace(' ', 'T')}Z`);
}

function cooldownSecondsFrom(row, now = Date.now()) {
  if (!row) return 0;
  const created = instantMs(row.createdAt);
  if (!Number.isFinite(created)) return 0;
  const remaining = REEMBED_COOLDOWN_MS - (now - created);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function launcherJobIds(row) {
  const ids = row && row.payload && row.payload.inverse ? row.payload.inverse.jobIds : null;
  return Array.isArray(ids) ? ids : [];
}

function createAiAdminService(overrides = {}) {
  const deps = {
    actionJournalStore,
    aiJobsStore,
    aiUsageDailyStore,
    adminReportsStore,
    collectionsStore,
    embeddingsStore,
    aiEnrichmentsStore,
    llmModelsStore,
    fileNodesStore: overrides.fileNodesStore || createFileNodesStore(),
    resolver: overrides.resolver || null,
    probeState,
    lockManager,
    generationSettings: {
      GENERATION_KINDS,
      getGenerations,
      bumpGenerationsTx,
    },
    buildTextBackfillScope,
    buildMediaBackfillScope,
    planTextBackfill,
    planMediaBackfill,
    ...overrides,
  };

  function resolver() {
    return deps.resolver || getSharedResolver();
  }

  async function readModels() {
    const roles = [];
    const profiles = [];
    for (const role of LLM_ROLE.ALL) {
      const [active, history] = await Promise.all([
        deps.llmModelsStore.getActiveByRole(role),
        deps.llmModelsStore.listByRole(role),
      ]);
      roles.push({ role, active: wireModel(active), history: (history || []).map(wireModel) });
      if (active) {
        const profile = wireProfile(role, active);
        if (profile) profiles.push(profile);
      }
    }
    const activeEmbed = roles.find((row) => row.role === 'embed')?.active || null;
    return { roles, profiles, activeEmbedId: activeEmbed ? activeEmbed.id : null };
  }

  async function readCoverage(modelId) {
    if (!modelId) {
      return {
        available: false,
        reason: 'model_unavailable',
        model_id: null,
        text: null,
        media: null,
        textScope: null,
        mediaScope: null,
      };
    }
    const [textScope, mediaScope] = await Promise.all([
      deps.buildTextBackfillScope({
        modelId,
        fileNodesStore: deps.fileNodesStore,
        embeddingsStore: deps.embeddingsStore,
        sampleSize: REEMBED_SAMPLE_SIZE,
      }),
      deps.buildMediaBackfillScope({
        modelId,
        fileNodesStore: deps.fileNodesStore,
        embeddingsStore: deps.embeddingsStore,
        aiEnrichmentsStore: deps.aiEnrichmentsStore,
        capabilityEnabled: (capability) => deps.probeState.isCapabilityEnabled(capability),
        sampleSize: REEMBED_SAMPLE_SIZE,
      }),
    ]);
    return {
      available: true,
      reason: null,
      model_id: Number(modelId),
      text: wireTextCoverage(textScope),
      media: wireMediaCoverage(mediaScope),
      textScope,
      mediaScope,
    };
  }

  function readMetrics({ merges, latestNightEval, coverage }) {
    const totals = latestNightEval?.payload?.totals || null;
    return {
      pending_merge_suggestions: merges.length,
      night_eval_users:
        totals && Number.isFinite(Number(totals.users)) ? Number(totals.users) : null,
      night_eval_collections:
        totals && Number.isFinite(Number(totals.collections)) ? Number(totals.collections) : null,
      night_eval_merge_suggested:
        totals && Number.isFinite(Number(totals.merge_suggested))
          ? Number(totals.merge_suggested)
          : null,
      text_files: coverage.available ? coverage.text.totals.files : null,
    };
  }

  function wireGate(definition, effective, metrics) {
    const entry = effective[definition.key] || {};
    const count =
      definition.metric !== 'not_instrumented' &&
      Number.isFinite(Number(metrics[definition.metric]))
        ? Number(metrics[definition.metric])
        : null;
    return {
      key: definition.key,
      value: entry.value === undefined ? null : entry.value,
      source: entry.source || 'default',
      impact: { metric: definition.metric, count },
    };
  }

  async function latestLauncherRow() {
    const rows = await deps.actionJournalStore.listBySubject(
      JOURNAL_DOMAIN.SETTINGS,
      AI_REEMBED_SUBJECT,
      { limit: 1 }
    );
    return rows[0] || null;
  }

  async function launcherStatus({ activeModelId, latestRow, now } = {}) {
    const row = latestRow === undefined ? await latestLauncherRow() : latestRow;
    const cooldown = cooldownSecondsFrom(row, now);
    const ids = launcherJobIds(row);
    const activeJobs = ids.length > 0 ? await deps.aiJobsStore.countActiveByIds(ids) : 0;
    const generations = await deps.generationSettings.getGenerations();
    let available = true;
    let reason = null;
    if (!activeModelId) {
      available = false;
      reason = 'model_unavailable';
    } else if (cooldown > 0) {
      available = false;
      reason = 'cooldown';
    } else if (activeJobs > 0) {
      available = false;
      reason = 'active_run';
    }
    return {
      available,
      reason,
      retry_after_seconds: cooldown,
      cooldown_seconds: Math.floor(REEMBED_COOLDOWN_MS / 1000),
      active_jobs: activeJobs,
      active_model_id: activeModelId ?? null,
      generations,
    };
  }

  async function getSummary() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const since = new Date(now.getTime() - DAY_MS).toISOString();

    const [queue, failedJobs, failed24, finished24, usageRows, reports, merges, models, effective] =
      await Promise.all([
        deps.aiJobsStore.countByStatus(),
        deps.aiJobsStore.listFailed({ limit: FAILED_JOB_LIMIT }),
        deps.aiJobsStore.countFailedSince(since),
        deps.aiJobsStore.countFinishedSince(since),
        deps.aiUsageDailyStore.getByDay(day),
        deps.adminReportsStore.listReports(),
        deps.collectionsStore.listMergeSuggestions(null, { state: 'pending' }),
        readModels(),
        resolver().getEffectiveConfig(),
      ]);

    const latestNightEval = (reports || []).find((row) => row.kind === 'night_eval') || null;
    const nextNightEval = latestNightEval
      ? {
          id: latestNightEval.id,
          status: latestNightEval.status,
          created_at: latestNightEval.createdAt,
          passes: latestNightEval.payload?.passes ?? null,
          totals: latestNightEval.payload?.totals ?? null,
        }
      : null;

    const coverage = await readCoverage(models.activeEmbedId);
    const metrics = readMetrics({
      merges: merges || [],
      latestNightEval,
      coverage,
    });
    const launcher = await launcherStatus({ activeModelId: models.activeEmbedId });

    const total = Object.values(queue).reduce((sum, value) => sum + Number(value || 0), 0);
    const caps = effective.LLM_DAILY_CALL_CAP ? Number(effective.LLM_DAILY_CALL_CAP.value) || 0 : 0;
    const tokenCaps = effective.LLM_DAILY_TOKEN_CAP
      ? Number(effective.LLM_DAILY_TOKEN_CAP.value) || 0
      : 0;

    return {
      generated_at: now.toISOString(),
      pipeline: {
        queue: { ...queue, total },
        failed_24h: failed24,
        finished_24h: finished24,
        failure_rate_24h: finished24 > 0 ? failed24 / finished24 : 0,
        failed_jobs: (failedJobs || []).map((job) => ({
          id: job.id,
          node_id: job.nodeId,
          kind: job.kind,
          generation: job.generation,
          status: job.status,
          attempt: job.attempt,
          last_error: job.lastError,
          created_at: job.createdAt,
          started_at: job.startedAt,
          finished_at: job.finishedAt,
        })),
        failed_jobs_display_only: true,
        capabilities: deps.probeState.getCapabilityEntries(),
        breaker_states: { instrumented: false, reason: 'active_observation_required' },
      },
      cost: {
        day,
        roles: (usageRows || []).map((row) => ({
          role: row.role,
          calls: row.calls,
          input_chars: row.inputChars,
          cached: row.cached,
          degraded: row.degraded,
          failed_429: row.failed429,
        })),
        caps: { call_cap: caps, token_cap: tokenCaps },
        per_user_top_n: { instrumented: false },
      },
      evolution: {
        latest_night_eval: nextNightEval,
        pending_merge_suggestions: (merges || []).length,
        not_instrumented: ['survival_curves', 'merge_accept_series', 'per_version_history'],
      },
      models: {
        roles: models.roles,
        profiles: models.profiles,
      },
      coverage: {
        available: coverage.available,
        reason: coverage.reason,
        model_id: coverage.model_id,
        text: coverage.text,
        media: coverage.media,
      },
      gates: {
        kill_switches: KILL_SWITCH_DEFS.map((definition) =>
          wireGate(definition, effective, metrics)
        ),
        gates: GATE_DEFS.map((definition) => wireGate(definition, effective, metrics)),
      },
      launcher,
      not_instrumented: [...NOT_INSTRUMENTED],
    };
  }

  async function getReembedPreview() {
    const models = await readModels();
    const coverage = await readCoverage(models.activeEmbedId);
    const launcher = await launcherStatus({ activeModelId: models.activeEmbedId });
    const textPlan = coverage.available ? deps.planTextBackfill({ scope: coverage.textScope }) : [];
    const mediaPlan = coverage.available
      ? deps.planMediaBackfill({ scope: coverage.mediaScope })
      : [];
    const union = [...new Set([...textPlan, ...mediaPlan])];
    return {
      generated_at: new Date().toISOString(),
      available: launcher.available && coverage.available,
      reason: launcher.reason || coverage.reason,
      model_id: coverage.model_id,
      generations: launcher.generations,
      retry_after_seconds: launcher.retry_after_seconds,
      coverage: {
        text: coverage.text,
        media: coverage.media,
      },
      plan: {
        text_count: textPlan.length,
        media_count: mediaPlan.length,
        union_count: union.length,
      },
    };
  }

  async function launchReembed({ actor }) {
    const lock = await deps.lockManager.acquireLock(REEMBED_LOCK);
    try {
      const models = await readModels();
      if (!models.activeEmbedId) {
        throw serviceError('modelUnavailable', 409);
      }
      const latestRow = await latestLauncherRow();
      const cooldown = cooldownSecondsFrom(latestRow);
      if (cooldown > 0) {
        throw serviceError('rateLimited', 429, { retry_after_seconds: cooldown });
      }
      const previousJobIds = launcherJobIds(latestRow);
      const activeJobs =
        previousJobIds.length > 0 ? await deps.aiJobsStore.countActiveByIds(previousJobIds) : 0;
      if (activeJobs > 0) {
        throw serviceError('alreadyActive', 409, { active_jobs: activeJobs });
      }

      // Recompute the deterministic plan INSIDE the lock: the preview the
      // operator saw may be stale, but the enqueue always follows current rows.
      const coverage = await readCoverage(models.activeEmbedId);
      const textPlan = deps.planTextBackfill({ scope: coverage.textScope });
      const mediaPlan = deps.planMediaBackfill({ scope: coverage.mediaScope });
      const nodeIds = [...new Set([...textPlan, ...mediaPlan])].sort((a, b) => a - b);

      const { id, result } = await deps.actionJournalStore.commitChange(
        JOURNAL_DOMAIN.SETTINGS,
        AI_REEMBED_SUBJECT,
        { actor: String(actor ?? 'system'), action: 'ai-reembed', subjectLabel: 'ai-reembed' },
        (mutationResult) => ({
          inverse: { op: 'cancel-ai-jobs', jobIds: mutationResult.jobIds },
        }),
        async (tx) => {
          const generations = await deps.generationSettings.bumpGenerationsTx(tx, [
            'embed',
            'features',
            'caption',
            'asr',
          ]);
          const generation = generations.embed;
          const items = nodeIds.map((nodeId) => ({
            nodeId,
            kind: AI_JOB_KIND.EMBED,
            generation,
            contentHash: null,
          }));
          const enqueued = await deps.aiJobsStore.enqueueManyTx(tx, items);
          return {
            generation,
            generations,
            enqueued: enqueued.enqueued,
            jobIds: enqueued.ids,
            modelId: coverage.model_id,
            textCount: textPlan.length,
            mediaCount: mediaPlan.length,
          };
        }
      );

      return {
        job_ids: result.jobIds,
        enqueued: result.enqueued,
        generation: result.generation,
        generations: result.generations,
        model_id: result.modelId,
        text_count: result.textCount,
        media_count: result.mediaCount,
        undo: { action_id: id },
        retry_after_seconds: Math.floor(REEMBED_COOLDOWN_MS / 1000),
      };
    } finally {
      await lock.release();
    }
  }

  return {
    getSummary,
    getReembedPreview,
    launchReembed,
  };
}

module.exports = {
  createAiAdminService,
  REEMBED_LOCK,
  REEMBED_COOLDOWN_MS,
  AI_REEMBED_SUBJECT,
  CURATED_AI_KILL_SWITCH_KEYS,
  CURATED_AI_GATE_KEYS,
  KILL_SWITCH_DEFS,
  GATE_DEFS,
};
