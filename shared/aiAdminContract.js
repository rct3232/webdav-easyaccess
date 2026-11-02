'use strict';

/**
 * Admin AI contract manifest (docs/spec/server/routes/admin.md §2.2.7,
 * docs/spec/client/components/mypage/content/AiAdminContent.md §2.4).
 *
 * The manifest is the single field inventory shared by the server shape
 * tests, the client sentinel render matrix, and the MSW fixture. Paths are
 * additive: a new summary field must be declared here and rendered (or
 * explicitly documented as API-only) in the same change.
 */

const arrayOf = (item) => ({ type: 'array', item });

const MODEL_SCHEMA = {
  id: 'number',
  role: 'string',
  provider: 'string',
  engine: 'string',
  base_url_key: 'string',
  model_name: 'string',
  precision: 'string|null',
  model_revision: 'string|null',
  max_input_chars: 'number|null',
  chunk_budget: 'number|null',
  batch_size: 'number|null',
  reasoning: 'string',
  enabled: 'boolean',
  created_at: 'string|null',
};

const AI_ADMIN_SUMMARY_MANIFEST = Object.freeze({
  generated_at: 'string',
  pipeline: {
    queue: {
      pending: 'number',
      running: 'number',
      done: 'number',
      failed: 'number',
      skipped: 'number',
      cancelled: 'number',
      total: 'number',
    },
    failed_24h: 'number',
    finished_24h: 'number',
    failure_rate_24h: 'number',
    failed_jobs: arrayOf({
      id: 'number',
      node_id: 'number|null',
      kind: 'string',
      generation: 'number',
      status: 'string',
      attempt: 'number',
      last_error: 'string|null',
      created_at: 'string|null',
      started_at: 'string|null',
      finished_at: 'string|null',
    }),
    failed_jobs_display_only: 'boolean',
    capabilities: arrayOf({
      capability: 'string',
      declared: 'boolean',
      probed: 'boolean',
      enabled: 'boolean',
      role: 'string|null',
      note: 'string|null',
      reason: 'string|null',
    }),
    breaker_states: { instrumented: 'boolean', reason: 'string|null' },
  },
  cost: {
    day: 'string',
    roles: arrayOf({
      role: 'string',
      calls: 'number',
      input_chars: 'number',
      cached: 'number',
      degraded: 'number',
      failed_429: 'number',
    }),
    caps: { call_cap: 'number|null', token_cap: 'number|null' },
    per_user_top_n: { instrumented: 'boolean' },
  },
  evolution: {
    latest_night_eval: 'object|null',
    pending_merge_suggestions: 'number',
    not_instrumented: arrayOf('string'),
  },
  models: {
    roles: arrayOf({
      role: 'string',
      active: 'object|null',
      history: arrayOf(MODEL_SCHEMA),
    }),
    profiles: arrayOf({
      model_id: 'number',
      role: 'string',
      preset_id: 'string',
      dim: 'number|null',
      calibrated: 'boolean',
      pooling: 'string|null',
      request_shape: 'string|null',
      dtype: 'string|null',
      mrl_dims: { type: 'array', item: 'number', nullable: true },
      text_prefixes: 'object|null',
    }),
  },
  coverage: {
    available: 'boolean',
    reason: 'string|null',
    model_id: 'number|null',
    text: 'object|null',
    media: 'object|null',
  },
  gates: {
    kill_switches: arrayOf({
      key: 'string',
      value: 'string|number|boolean|null',
      source: 'string',
      impact: { metric: 'string', count: 'number|null' },
    }),
    gates: arrayOf({
      key: 'string',
      value: 'string|number|boolean|null',
      source: 'string',
      impact: { metric: 'string', count: 'number|null' },
    }),
  },
  launcher: {
    available: 'boolean',
    reason: 'string|null',
    active_jobs: 'number',
    active_model_id: 'number|null',
    generations: {
      embed: 'number',
      features: 'number',
      caption: 'number',
      asr: 'number',
    },
  },
  not_instrumented: arrayOf('string'),
});

const AI_ADMIN_PREVIEW_MANIFEST = Object.freeze({
  generated_at: 'string',
  available: 'boolean',
  reason: 'string|null',
  model_id: 'number|null',
  generations: {
    embed: 'number',
    features: 'number',
    caption: 'number',
    asr: 'number',
  },
  coverage: { text: 'object|null', media: 'object|null' },
  plan: { text_count: 'number', media_count: 'number', union_count: 'number' },
});

/** v1 series that the panel must label instead of fabricating values. */
const AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED = Object.freeze([
  'survival_curves',
  'merge_accept_series',
  'per_version_history',
]);

const AI_ADMIN_NOT_INSTRUMENTED = Object.freeze([
  ...AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED,
  'per_user_top_n',
]);

/** Failed-job table row cap (server-side LIMIT). */
const AI_ADMIN_FAILED_JOB_LIMIT = 20;

/** Reasons shared by `/summary.coverage`, `/summary.launcher`, and preview. */
const AI_ADMIN_REASONS = Object.freeze({
  MODEL_UNAVAILABLE: 'model_unavailable',
  ACTIVE_RUN: 'active_run',
});

/** Gate impact metrics that map to a live server-derived count. */
const AI_ADMIN_IMPACT_METRICS = Object.freeze([
  'night_eval_users',
  'night_eval_collections',
  'night_eval_merge_suggested',
  'pending_merge_suggestions',
  'text_files',
]);

function matchesType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

function validateNode(value, schema, path, errors) {
  if (typeof schema === 'string') {
    const types = schema.split('|');
    if (value === null && types.includes('null')) return;
    if (!types.some((type) => type !== 'null' && matchesType(value, type))) {
      errors.push(`${path}: expected ${schema}`);
    }
    return;
  }
  if (schema && schema.type === 'array') {
    if (value === null && schema.nullable) return;
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    value.forEach((item, index) => validateNode(item, schema.item, `${path}[${index}]`, errors));
    return;
  }
  if (!matchesType(value, 'object')) {
    errors.push(`${path}: expected object`);
    return;
  }
  for (const [key, child] of Object.entries(schema)) {
    validateNode(value[key], child, path ? `${path}.${key}` : key, errors);
  }
}

/** Returns a list of contract violations (`[]` means the payload is valid). */
function validateContract(payload, manifest) {
  const errors = [];
  validateNode(payload, manifest, '', errors);
  return errors;
}

function validateAiAdminSummary(payload) {
  return validateContract(payload, AI_ADMIN_SUMMARY_MANIFEST);
}

function validateAiAdminPreview(payload) {
  return validateContract(payload, AI_ADMIN_PREVIEW_MANIFEST);
}

module.exports = {
  AI_ADMIN_SUMMARY_MANIFEST,
  AI_ADMIN_PREVIEW_MANIFEST,
  AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED,
  AI_ADMIN_NOT_INSTRUMENTED,
  AI_ADMIN_FAILED_JOB_LIMIT,
  AI_ADMIN_REASONS,
  AI_ADMIN_IMPACT_METRICS,
  validateAiAdminSummary,
  validateAiAdminPreview,
  validateContract,
};
