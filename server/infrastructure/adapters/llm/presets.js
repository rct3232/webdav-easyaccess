'use strict';

/**
 * Preset manifest (T1.1a — llmPresets.md §2.2/§2.2a/§2.3).
 *
 * Static data + pure lookup/evaluation helpers: no DB, no network, no provider
 * calls (llmPresets §3). Rows are FROZEN — the admin UI renders from the
 * manifest; probe results persist to `llm_models` + `backendHealth`, never back
 * into the manifest. Adding a provider = adding a row; core code never branches
 * on provider names (§4 grep scenario).
 *
 * Authority split (§1/§2.4): presets declare EXPECTED capabilities; llmAdapter
 * §2.4 probes decide ACTUAL. `evaluateCapabilityMatrix` is that rule as a pure
 * function: `enabled = probed && pass` — declared-but-failing ⇒ capability OFF
 * + admin warning card (declared vs probed); undeclared-but-passing ⇒ ON with
 * an "undeclared" admin note (expected set is advisory, probe is authority).
 */

const fs = require('fs');
const path = require('path');

const KIT_PATH = path.join(__dirname, 'eg2-reference-kit.json');

/**
 * Per-model profile constants (release artifacts — llmPresets §1 provenance
 * rule / §2.3 rows). Every number is project-measured on the dev reference set;
 * never computed at runtime from user data.
 */
const EG2_PROFILE = {
  dim: 768,
  chPerTok: 1.5,
  thetaDup: 0.955,
  deltaBase: 0.08,
  edgeCos: { tight: 0.86, mid: 0.8, loose: 0.72 },
  // PROVISIONAL membership band around each collection definition's θ
  // (collectionsService.md §2.3): θ_in = θ + inDelta, θ_out = θ + outDelta,
  // clamped to [0,1]. Refined after operation — not a calibrated release
  // measurement. Consumers fall back to θ_in = θ_out = θ when absent.
  membershipHysteresis: { inDelta: 0.02, outDelta: -0.02 },
  throughputDocsMin: null,
  calibrated: false,
  requestShape: 'plain-input',
  textPrefixes: { query: 'task: search result | query:', document: 'title: none | text:' },
  pooling: 'mean',
  mrlDims: [768, 512, 256],
  dtype: 'bf16|fp32',
  mediaTokenCost: { image: 280, videoFrame: 140, audioPerSec: 25 },
};

const ALL_EMBED_EXPECTED = {
  text_embed: true,
  image_embed: true,
  audio_embed: true,
  video_embed: true,
  chat: false,
  vision_chat: false,
  asr: false,
};

const CHAT_EXPECTED = {
  text_embed: false,
  image_embed: false,
  audio_embed: false,
  video_embed: false,
  chat: true,
  vision_chat: true,
  asr: true,
};

/** Deep-freeze helper so the manifest invariant holds transitively. */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

const LLM_PRESETS = deepFreeze([
  {
    id: 'embeddinggemma-2-onnx-q4',
    family: 'embedded',
    roles: ['embed'],
    engine: 'embedded',
    expected: { ...ALL_EMBED_EXPECTED },
    lock: {
      repo: 'onnx-community/embeddinggemma-2-ONNX',
      revision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
      dtype: 'q4',
      files: null, // identity mirror only — the checked-in model.lock.json is the file-list source
      provisionDirEnv: 'WEA_MODEL_DIR',
    },
    budgets: { maxInputCharsDefault: 8192, chunkBudget: 4, batchSize: 8 },
    profile: { ...EG2_PROFILE },
    kwargs: { enableThinkingChatTemplateKwarg: false, reasoningEffort: false },
  },
  {
    id: 'embeddinggemma-2-external',
    family: 'llama.cpp',
    roles: ['embed'],
    engine: 'remote',
    expected: { ...ALL_EMBED_EXPECTED },
    conformance: {
      referenceKit: {
        path: 'eg2-reference-kit.json',
        vectorsSha: 'd369c3fcfabf86ef4e2178d3285001b5760ee0d4d4ce0508a91f9505d43f4a98',
      },
      metric: 'median-cos',
      threshold: 'kit', // τ read from the kit file (release artifact) — never hardcoded
    },
    endpoints: { models: '/v1/models', props: '/props' },
    budgets: { maxInputCharsDefault: 8192, chunkBudget: 4, batchSize: 8 },
    profile: {
      ...EG2_PROFILE,
      requestShape: 'content-wrapper',
      textPrefixes: { ...EG2_PROFILE.textPrefixes },
    },
    kwargs: { enableThinkingChatTemplateKwarg: false, reasoningEffort: false },
  },
  {
    id: 'gemma-4-12b-it',
    family: 'llama.cpp',
    roles: ['chat', 'vision', 'asr'],
    engine: 'remote',
    expected: { ...CHAT_EXPECTED },
    endpoints: { models: '/v1/models', props: '/props' },
    budgets: { maxInputCharsDefault: 8192, chunkBudget: 4, batchSize: 1 },
    profile: {
      dim: null,
      chPerTok: 1.7,
      thetaDup: null,
      edgeCos: { tight: null, mid: null, loose: null },
      throughputDocsMin: null,
      calibrated: false,
      requestShape: 'plain-input',
      textPrefixes: null,
      pooling: null,
      mrlDims: null,
      dtype: 'bf16|fp32',
      mediaTokenCost: null,
    },
    kwargs: { enableThinkingChatTemplateKwarg: true, reasoningEffort: false },
  },
]);

/** Row lookup by stable slug; unknown id ⇒ null (picker shows nothing, no crash). */
function findPreset(id) {
  return LLM_PRESETS.find((row) => row.id === id) || null;
}

/** First row of `family` serving `role`; no match ⇒ null. */
function getPresetByFamilyRole(family, role) {
  return LLM_PRESETS.find((row) => row.family === family && row.roles.includes(role)) || null;
}

const CAPABILITY_KEYS = [
  'text_embed',
  'image_embed',
  'audio_embed',
  'video_embed',
  'chat',
  'vision_chat',
  'asr',
];

/**
 * Normalizes a row's `expected` block to the seven capability keys with
 * boolean values; missing keys read as false (advisory declaration only).
 */
function expectedCapabilities(preset) {
  const out = {};
  for (const key of CAPABILITY_KEYS) {
    out[key] = Boolean(preset && preset.expected && preset.expected[key]);
  }
  return out;
}

/**
 * The §2.4 authority rule as a pure function. `probeResults` maps capability
 * keys → { pass: boolean }; an absent key means "not probed" (failing).
 * Returns one entry per capability key:
 *   { capability, declared, probed, enabled, note }
 * with note ∈ null | 'declared-not-probed' | 'undeclared-but-probed' | 'probe-failed'.
 */
function evaluateCapabilityMatrix(preset, probeResults) {
  const declared = expectedCapabilities(preset);
  const results = probeResults || {};
  return CAPABILITY_KEYS.map((capability) => {
    const wasProbed = Object.prototype.hasOwnProperty.call(results, capability);
    const passed = wasProbed && Boolean(results[capability] && results[capability].pass);
    let note = null;
    if (wasProbed && passed && !declared[capability]) note = 'undeclared-but-probed';
    else if (!wasProbed && declared[capability]) note = 'declared-not-probed';
    else if (wasProbed && !passed && declared[capability]) note = 'probe-failed';
    return {
      capability,
      declared: declared[capability],
      probed: wasProbed,
      enabled: passed,
      note,
    };
  });
}

let kitCache = null;

/**
 * The checked-in conformance reference kit (§2.2): 24 fixed inputs + canonical
 * embedded-q4 float32 vectors (base64) + sha + the calibrated threshold.
 * τ is read from the kit file — the calibration artifact is the single source
 * of the threshold (kit-file PR to change it, never a code change).
 */
function kit() {
  if (!kitCache) {
    const raw = JSON.parse(fs.readFileSync(KIT_PATH, 'utf8'));
    kitCache = {
      strings: raw.strings,
      vectorsSha: raw.vectorsSha,
      threshold: raw.threshold,
      vectors: raw.vectors.map((b64) => {
        const buf = Buffer.from(b64, 'base64');
        return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      }),
    };
  }
  return kitCache;
}

/**
 * The §2.3 EG2 activation gate as a pure function over the kit
 * (llmPresets §2.2a): structural (dim == 768) + behavioral (median cos to the
 * canonical vectors ≥ kit threshold). `observedVectors` is the endpoint's
 * vector set for kit().strings in the same order — endpoint-declared NAMES are
 * never an input (identity is what the vectors DO, §4.23.2).
 *
 * The dim check runs BEFORE the median-cos comparison: a wrong-dim vector set
 * can never produce a passing median (median is null on dim failure).
 * Inputs are defensively renormalized before dotting (unit-norm contract).
 */
function evaluateConformance(observedVectors) {
  const canonical = kit();
  const observed = Array.isArray(observedVectors) ? observedVectors : [];

  const dimOk =
    observed.length === canonical.vectors.length &&
    observed.every((v) => v instanceof Float32Array && v.length === 768);

  if (!dimOk) {
    return {
      dimOk: false,
      median: null,
      threshold: canonical.threshold,
      pass: false,
      reason: 'wrongDim',
    };
  }

  const renorm = (v) => {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
    return out;
  };

  const cos = canonical.vectors.map((c, i) => {
    const a = renorm(observed[i]);
    const b = renorm(c);
    let d = 0;
    for (let j = 0; j < b.length; j++) d += a[j] * b[j];
    return d;
  });
  const sorted = cos.slice().sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];

  const pass = median >= canonical.threshold;
  return {
    dimOk: true,
    median,
    threshold: canonical.threshold,
    pass,
    reason: pass ? null : 'nonConformingEndpoint',
  };
}

module.exports = {
  LLM_PRESETS,
  findPreset,
  getPresetByFamilyRole,
  expectedCapabilities,
  evaluateCapabilityMatrix,
  kit,
  evaluateConformance,
};
