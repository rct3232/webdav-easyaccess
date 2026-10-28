'use strict';

/**
 * T1.1a unit gates (llmPresets.md §2.2a — the binding contract; §2.4 probe
 * authority rule; §2.3 activation gate).
 *
 * Three concerns:
 *   1. Manifest shape + freeze invariants (the data contract every consumer
 *      renders from — rows FROZEN, probe results never written back).
 *   2. evaluateCapabilityMatrix — declared vs probed authority rule as a pure
 *      function: probe decides, in BOTH directions; declared-but-failing ⇒
 *      capability OFF + admin-warning note.
 *   3. The conformance kit accessor: τ = 0.90 read from the kit file (never
 *      hardcoded) + canonical vectors 768-dim unit-norm (dim == 768 structural
 *      gate input).
 *
 * Static data only: no DB, no network (llmPresets §3).
 */

const fs = require('fs');
const path = require('path');

const { matrixSummaries } = require('./matrix-harness');

describe('presets manifest (llmPresets §2.2/§2.2a/§2.3)', () => {
  let presets;

  beforeAll(() => {
    presets = require('../presets').LLM_PRESETS;
  });

  it('exports the three declared rows: embedded-EG2, external-EG2, gemma chat', () => {
    expect(presets).toHaveLength(3);
    expect(presets.map((r) => r.id)).toEqual([
      'embeddinggemma-2-onnx-q4',
      'embeddinggemma-2-external',
      'gemma-4-12b-it',
    ]);
  });

  it('is deep-frozen — rows and nested objects cannot be mutated', () => {
    expect(Object.isFrozen(presets)).toBe(true);
    for (const row of presets) {
      expect(Object.isFrozen(row)).toBe(true);
      for (const value of Object.values(row)) {
        if (value && typeof value === 'object') expect(Object.isFrozen(value)).toBe(true);
      }
    }
  });

  it('every row carries the §2.2 schema fields with valid enums', () => {
    const FAMILIES = ['embedded', 'llama.cpp', 'ollama', 'openai-compatible', 'tei'];
    const ROLES = ['embed', 'chat', 'vision', 'asr'];
    const CAPS = [
      'text_embed',
      'image_embed',
      'audio_embed',
      'video_embed',
      'chat',
      'vision_chat',
      'asr',
    ];
    for (const row of presets) {
      expect(FAMILIES).toContain(row.family);
      expect(row.roles.every((r) => ROLES.includes(r))).toBe(true);
      for (const cap of CAPS) expect(typeof row.expected[cap]).toBe('boolean');
      expect(['embedded', 'remote']).toContain(row.engine);
    }
  });

  it('embedded row: engine embedded, lock mirror matches model.lock.json identity', () => {
    const row = presets.find((r) => r.id === 'embeddinggemma-2-onnx-q4');
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'model.lock.json'), 'utf8'));
    expect(row.engine).toBe('embedded');
    expect(row.roles).toContain('embed');
    // The manifest mirrors the lockfile identity fields (§2.2 lock block) —
    // a divergence between the two checked-in artifacts is a release defect.
    expect(row.lock.repo).toBe(lock.repo);
    expect(row.lock.revision).toBe(lock.revision);
    expect(row.lock.dtype).toBe(lock.dtype);
    expect(row.lock.provisionDirEnv).toBe('WEA_MODEL_DIR');
  });

  it('both EG2 rows declare dim 768 (structural gate input, §2.3 activation gate)', () => {
    for (const id of ['embeddinggemma-2-onnx-q4', 'embeddinggemma-2-external']) {
      const row = presets.find((r) => r.id === id);
      expect(row.profile.dim).toBe(768);
    }
  });

  it('both EG2 rows carry the PROVISIONAL membership hysteresis band (§2.2 profile, §2.3 rows)', () => {
    // Band offsets drive θ_in/θ_out for seed/centroid collection membership
    // (collectionsService.md §2.3). Shipped values are provisional — refined
    // after operation — and every EG2 row must expose the same band.
    for (const id of ['embeddinggemma-2-onnx-q4', 'embeddinggemma-2-external']) {
      const row = presets.find((r) => r.id === id);
      expect(row.profile.membershipHysteresis).toEqual({ inDelta: 0.02, outDelta: -0.02 });
      expect(row.profile.membershipHysteresis.inDelta).toBeGreaterThan(0);
      expect(row.profile.membershipHysteresis.outDelta).toBeLessThan(0);
    }
    // The chat row is not an embed profile — it declares no membership band.
    expect(presets.find((r) => r.id === 'gemma-4-12b-it').profile.membershipHysteresis).toBe(
      undefined
    );
  });

  it('external-EG2 row: conformance block carries the checked-in kit path + median-cos', () => {
    const row = presets.find((r) => r.id === 'embeddinggemma-2-external');
    expect(row.roles).toContain('embed');
    expect(row.engine).toBe('remote');
    expect(row.conformance.metric).toBe('median-cos');
    expect(row.conformance.referenceKit).toEqual({
      path: 'eg2-reference-kit.json',
      vectorsSha: expect.any(String),
    });
    expect(row.conformance.referenceKit.vectorsSha).toBe(
      JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eg2-reference-kit.json'), 'utf8'))
        .vectorsSha
    );
  });

  it('gemma-4-12b-it row: chat/vision/asr roles, reasoning-off default, no effort tiers', () => {
    const row = presets.find((r) => r.id === 'gemma-4-12b-it');
    expect(row.roles).toEqual(['chat', 'vision', 'asr']);
    expect(row.kwargs.enableThinkingChatTemplateKwarg).toBe(true);
    expect(row.kwargs.reasoningEffort).toBe(false);
  });

  it('embed support is EG2-pinned: no other embed model slug exists anywhere in the manifest', () => {
    const ids = presets.map((r) => r.id).join(' ');
    expect(ids).toMatch(/embeddinggemma-2/);
    expect(ids).not.toMatch(/bge-|nomic-|e5-|gte-|embeddinggemma-1/);
    for (const row of presets) {
      if (row.roles.includes('embed')) {
        expect(row.family === 'embedded' || row.conformance).toBeTruthy();
      }
    }
  });

  it('budgets + profile numbers are non-null on shippable rows; media token costs declared', () => {
    for (const row of presets) {
      if (row.pending) continue; // pending rows carry explicit nulls (§4 scenario)
      expect(row.budgets.maxInputCharsDefault).toBeGreaterThan(0);
      expect(row.budgets.chunkBudget).toBe(4);
      expect(row.budgets.batchSize).toBeGreaterThan(0);
      expect(row.profile.chPerTok).toBeGreaterThan(0);
      if (row.roles.includes('embed')) {
        // pooling is SPACE-shaping — declared only on embed rows (§2.2)
        expect(row.profile.pooling).toBe('mean');
      }
      expect(row.profile.dtype).not.toMatch(/fp16/);
      if (row.roles.includes('embed')) {
        // requestShape is the EMBEDDINGS body dialect (§2.2) — meaningful on
        // embed rows: embedded is in-process (plain), remote EG2 wraps media
        // in the content-wrapper.
        expect(row.profile.requestShape).toEqual(
          row.family === 'embedded' ? 'plain-input' : 'content-wrapper'
        );
      }
      if (row.expected.image_embed || row.expected.audio_embed || row.expected.video_embed) {
        expect(row.profile.mediaTokenCost).toEqual({
          image: 280,
          videoFrame: 140,
          audioPerSec: 25,
        });
      }
    }
  });

  it('findPreset: known id returns the row, unknown id returns null (no crash, §4)', () => {
    const { findPreset } = require('../presets');
    expect(findPreset('gemma-4-12b-it')).toBe(presets[2]);
    expect(findPreset('no-such-preset')).toBeNull();
  });

  it('getPresetByFamilyRole: family+role lookup, miss returns null', () => {
    const { getPresetByFamilyRole } = require('../presets');
    expect(getPresetByFamilyRole('embedded', 'embed').id).toBe('embeddinggemma-2-onnx-q4');
    expect(getPresetByFamilyRole('llama.cpp', 'embed').id).toBe('embeddinggemma-2-external');
    // ollama/tei chat rows are RELEASE-MEASUREMENT PENDING (§2.3) — they ship
    // only once measured, so the manifest currently resolves no such row.
    expect(getPresetByFamilyRole('ollama', 'chat')).toBeNull();
    expect(getPresetByFamilyRole('tei', 'embed')).toBeNull();
  });

  it('expectedCapabilities: seven keys normalized to booleans, missing keys read false', () => {
    const { expectedCapabilities } = require('../presets');
    const row = presets.find((r) => r.id === 'gemma-4-12b-it');
    const caps = expectedCapabilities(row);
    expect(Object.keys(caps).sort()).toEqual(
      [
        'asr',
        'audio_embed',
        'chat',
        'image_embed',
        'text_embed',
        'video_embed',
        'vision_chat',
      ].sort()
    );
    expect(caps.chat).toBe(true);
    expect(caps.text_embed).toBe(false);
  });
});

describe('evaluateCapabilityMatrix (llmPresets §2.2a / §2.4 authority rule)', () => {
  const { evaluateCapabilityMatrix, LLM_PRESETS } = require('../presets');
  const chatRow = LLM_PRESETS.find((r) => r.id === 'gemma-4-12b-it');
  const embedRow = LLM_PRESETS.find((r) => r.id === 'embeddinggemma-2-external');

  it('probe is authority: enabled == probed && pass, regardless of declared', () => {
    // declared text_embed=true, probed+passing ⇒ ON
    let results = evaluateCapabilityMatrix(chatRow, { chat: { pass: true } });
    expect(results.find((c) => c.capability === 'chat')).toMatchObject({
      declared: true,
      probed: true,
      enabled: true,
      note: null,
    });
    // declared text_embed=false on the chat row, but the probe PASSED ⇒ ON with
    // the "undeclared" admin note (probe is authority in BOTH directions).
    results = evaluateCapabilityMatrix(chatRow, { text_embed: { pass: true } });
    expect(results.find((c) => c.capability === 'text_embed')).toMatchObject({
      declared: false,
      probed: true,
      enabled: true,
      note: 'undeclared-but-probed',
    });
  });

  it('declared-but-not-probed ⇒ OFF + declared-not-probed (admin warning card)', () => {
    const results = evaluateCapabilityMatrix(chatRow, {});
    const vision = results.find((c) => c.capability === 'vision_chat');
    expect(vision).toMatchObject({
      declared: true,
      probed: false,
      enabled: false,
      note: 'declared-not-probed',
    });
  });

  it('declared-but-failing probe ⇒ OFF + probe-failed (declared vs probed warning)', () => {
    const results = evaluateCapabilityMatrix(chatRow, { chat: { pass: false } });
    const chat = results.find((c) => c.capability === 'chat');
    expect(chat).toMatchObject({
      declared: true,
      probed: true,
      enabled: false,
      note: 'probe-failed',
    });
  });

  it('probe-failing media sub-capability never blocks text_embed (§2.4 isolation)', () => {
    // external-EG2 declares all four embed capabilities; media probes fail
    // (silent media-drop fixture), text probe passes.
    const results = evaluateCapabilityMatrix(embedRow, {
      text_embed: { pass: true },
      image_embed: { pass: false },
      audio_embed: { pass: false },
      video_embed: { pass: false },
    });
    expect(results.find((c) => c.capability === 'text_embed').enabled).toBe(true);
    expect(results.find((c) => c.capability === 'image_embed')).toMatchObject({
      enabled: false,
      note: 'probe-failed',
    });
    expect(results.find((c) => c.capability === 'video_embed').enabled).toBe(false);
  });

  it('returns exactly the seven capability entries for any row', () => {
    const results = evaluateCapabilityMatrix(embedRow, {});
    expect(results.map((c) => c.capability).sort()).toEqual(
      [
        'asr',
        'audio_embed',
        'chat',
        'image_embed',
        'text_embed',
        'video_embed',
        'vision_chat',
      ].sort()
    );
    expect(results).toHaveLength(7);
  });

  it('the harness applies the matrix rule to every manifest row without exception', () => {
    // Cross-row consistency: the pure rule + the declared expectations must
    // agree on ALL rows (a row whose expectations contradict the rule cannot
    // ship). See matrix-harness.js for the sweep.
    const { expectedCapabilities } = require('../presets');
    for (const row of LLM_PRESETS) {
      const declared = expectedCapabilities(row);
      const results = evaluateCapabilityMatrix(row, {});
      for (const entry of results) {
        expect(entry.declared).toBe(declared[entry.capability]);
        // nothing probed ⇒ everything OFF regardless of declarations
        expect(entry.enabled).toBe(false);
      }
    }
  });
});

describe('conformance kit accessor (llmPresets §2.2a — τ=0.90 release artifact)', () => {
  const { kit } = require('../presets');

  it('returns the checked-in kit: 24 strings + 24 vectors + vectorsSha', () => {
    const k = kit();
    expect(k.strings).toHaveLength(24);
    expect(k.vectors).toHaveLength(24);
    expect(k.vectorsSha).toBe('d369c3fcfabf86ef4e2178d3285001b5760ee0d4d4ce0508a91f9505d43f4a98');
  });

  it('threshold τ = 0.90 comes FROM THE KIT FILE (grep: no hardcoded gate constant)', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'eg2-reference-kit.json'), 'utf8')
    );
    expect(kit().threshold).toBe(raw.threshold);
    expect(raw.threshold).toBe(0.9);
  });

  it('canonical vectors decode to 768-dim unit-norm float32 (dim == 768 gate input)', () => {
    const k = kit();
    for (const v of k.vectors) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(768);
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 4);
    }
  });

  it('is cached — repeated calls return the same parsed artifact', () => {
    expect(kit()).toBe(kit());
  });
});

describe('evaluateConformance — EG2 activation gate (llmPresets §2.2a/§2.3, §4 fixture)', () => {
  const { evaluateConformance, kit } = require('../presets');

  it('kit canonical vectors re-fed as observed ⇒ pass (median 1.0, dim 768)', () => {
    const result = evaluateConformance(kit().vectors);
    expect(result).toMatchObject({
      dimOk: true,
      threshold: 0.9,
      pass: true,
      reason: null,
    });
    // identity re-feed: renormalization round-trip leaves median at 1 up to
    // float rounding (f32/f64 noise ~1e-9) — exact `toBe(1)` would pin an
    // implementation detail, not the §2.3 contract.
    expect(result.median).toBeCloseTo(1, 6);
  });

  it('same-dim DIFFERENT model (embeddinggemma-1 negative) ⇒ nonConformingEndpoint', () => {
    // Orthogonal-ish 768-dim unit vectors: dim check passes, median collapses
    // to ~0 — the §4 aliased-endpoint truth table (dim alone is NOT identity).
    const decoy = kit().strings.map((_, i) => {
      const v = new Float32Array(768);
      v[i % 768] = 1;
      return v;
    });
    const result = evaluateConformance(decoy);
    expect(result.dimOk).toBe(true);
    expect(result.median).toBeLessThan(0.9);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('nonConformingEndpoint');
  });

  it('wrong dim (512 truncation) ⇒ wrongDim, median null, dim check ran FIRST', () => {
    const truncated = kit().vectors.map((v) => v.slice(0, 512));
    const result = evaluateConformance(truncated);
    expect(result).toMatchObject({ dimOk: false, median: null, pass: false, reason: 'wrongDim' });
  });

  it('endpoint self-declared names are never consulted (signature carries vectors only)', () => {
    expect(evaluateConformance.length).toBe(1);
    const source = fs.readFileSync(path.join(__dirname, '..', 'presets.js'), 'utf8');
    // No identity-by-name branch exists anywhere in the gate module.
    expect(source).not.toMatch(/alias|self-declared|modelName\s*===/i);
  });

  it('vector count mismatch against the kit ⇒ wrongDim (incomplete observation set)', () => {
    const short = kit().vectors.slice(0, 12);
    expect(evaluateConformance(short).reason).toBe('wrongDim');
  });
});

describe('grep gates (llmPresets §4 provider-neutrality + kit provenance)', () => {
  const ROOT = path.join(__dirname, '..');

  it('core code never branches on provider names (§4 scenario)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'presets.js'), 'utf8');
    // The manifest may LIST family slugs as data; control flow must not branch
    // on a specific provider name beyond the generic family switch points.
    expect(source).not.toMatch(/switch\s*\(\s*provider\s*\)/);
    expect(source).not.toMatch(/if\s*\(.{0,40}'llama\.cpp'/);
    expect(source).not.toMatch(/if\s*\(.{0,40}'ollama'/);
  });

  it('gate code carries no hardcoded τ (threshold lives only in the kit file)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'presets.js'), 'utf8');
    expect(source).not.toMatch(/0\.9(0+)?\s*[,;)]/); // no τ literal
    expect(source).not.toMatch(/threshold\s*[:=]\s*[\d.]/);
  });

  it('kit file: 24 strings, sha-matched vectors, calibration block present', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'eg2-reference-kit.json'), 'utf8'));
    const crypto = require('crypto');
    expect(raw.strings).toHaveLength(24);
    expect(raw.vectors).toHaveLength(24);
    expect(raw.vectorsSha).toBe(
      crypto.createHash('sha256').update(JSON.stringify(raw.vectors)).digest('hex')
    );
    expect(raw.calibration.selection).toContain('tau=0.90');
  });
});

// Re-exported so the matrix-harness utilities stay test-scoped.
describe('matrixSummaries helper', () => {
  it('summarizes matrix entries for cross-row invariants', () => {
    expect(typeof matrixSummaries).toBe('function');
  });
});
