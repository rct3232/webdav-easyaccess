'use strict';

/**
 * T1.0a unit gates: the checked-in model.lock.json artifact (llmPresets §2.2
 * lock schema — repo/revision/dtype/files[] with sha256, NO model bytes in the
 * repo) and the generic `preparing` readiness state on the backendHealth row
 * (backendHealth §2.2/§2.3 — preparing/phase/progress fields; entering/leaving
 * preparing never fires the transition callback; the next ok report clears it).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_PATH = path.join(__dirname, '..', 'model.lock.json');

describe('model.lock.json (checked-in release artifact)', () => {
  let lock;
  beforeAll(() => {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  });

  it('exists in the repo and carries NO model bytes (only the manifest)', () => {
    expect(fs.existsSync(LOCK_PATH)).toBe(true);
    // A few-KB manifest: any lock file over 1 MB would mean model bytes leaked in.
    expect(fs.statSync(LOCK_PATH).size).toBeLessThan(1024 * 1024);
    // Only .onnx_data/.onnx paths are referenced — never bundled weight files
    // inside the repo tree itself.
    for (const f of lock.files) {
      expect(f.path).toMatch(/\.(onnx|onnx_data|json|jinja)$/);
      expect(path.isAbsolute(f.path)).toBe(false);
    }
  });

  it('pins the identity: repo, immutable revision, dtype q4, dim 768, pooling mean', () => {
    expect(lock.repo).toBe('onnx-community/embeddinggemma-2-ONNX');
    expect(lock.revision).toBe('daa72c51243991dfcaf9f9137d2c573d8f7790c0');
    expect(lock.dtype).toBe('q4');
    expect(lock.dim).toBe(768);
    expect(lock.pooling).toBe('mean');
  });

  it('declares the full q4 file set with per-file sha256 + size (≈473 MB total)', () => {
    expect(Array.isArray(lock.files)).toBe(true);
    expect(lock.files.length).toBeGreaterThanOrEqual(10);
    const totalBytes = lock.files.reduce((n, f) => n + f.size, 0);
    expect(totalBytes).toBeGreaterThan(400 * 1024 * 1024); // ≈473 MB full multimodal set
    expect(totalBytes).toBeLessThan(500 * 1024 * 1024);
    for (const f of lock.files) {
      expect(f.path).toEqual(expect.any(String));
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toEqual(expect.any(Number));
      expect(f.size).toBeGreaterThan(0);
    }
    // The three q4 encoder graphs + their external-data shards are present.
    const paths = lock.files.map((f) => f.path);
    expect(paths).toContain('onnx/model_q4.onnx');
    expect(paths).toContain('onnx/model_q4.onnx_data');
    expect(paths).toContain('onnx/vision_encoder_q4.onnx');
    expect(paths).toContain('onnx/vision_encoder_q4.onnx_data');
    expect(paths).toContain('onnx/audio_encoder_q4.onnx');
    expect(paths).toContain('onnx/audio_encoder_q4.onnx_data');
    expect(paths).toContain('tokenizer.json');
    expect(paths).toContain('config.json');
  });
});

describe('backendHealth generic preparing state (§2.3 report contract)', () => {
  const { createBackendHealth } = require('../../../backendHealth');

  function tracker() {
    const t = createBackendHealth();
    const transitions = [];
    t.setOnTransition((backend, change) => transitions.push({ backend, ...change }));
    return { t, transitions };
  }

  it('a preparing:true report sets preparing/phase/progress WITHOUT firing a transition and keeps the underlying status', () => {
    const { t, transitions } = tracker();
    t.report('ai.embed', { ok: false, code: 'unreachable', reason: 'down' });
    t.report('ai.embed', {
      preparing: true,
      phase: 'provisioning',
      progress: '1/12 files',
    });

    const row = t.getHealth()['ai.embed'];
    expect(row.preparing).toBe(true);
    expect(row.phase).toBe('provisioning');
    expect(row.progress).toBe('1/12 files');
    expect(row.status).toBe('fail'); // underlying status preserved, NOT a flip
    expect(transitions).toEqual([]); // entering preparing never fires
  });

  it('progress updates in place without transitions; the terminal ok report clears preparing/phase/progress', () => {
    const { t, transitions } = tracker();
    t.report('ai.embed', { preparing: true, phase: 'provisioning', progress: '1/12 files' });
    t.report('ai.embed', { preparing: true, phase: 'provisioning', progress: '2/12 files' });
    let row = t.getHealth()['ai.embed'];
    expect(row.progress).toBe('2/12 files');
    expect(row.preparing).toBe(true);
    expect(transitions).toEqual([]);

    t.report('ai.embed', { ok: true });
    row = t.getHealth()['ai.embed'];
    expect(row.preparing).toBeUndefined();
    expect(row.phase).toBeUndefined();
    expect(row.progress).toBeUndefined();
    expect(row.status).toBe('ok');
    expect(transitions.length).toBe(0); // fail(underlying)→ok flip DID happen? No — preparing never flipped status to fail via ok:false
  });

  it('a terminal ok:false report after preparing replaces the readiness state with the failure', () => {
    const { t } = tracker();
    t.report('ai.embed', { preparing: true, phase: 'provisioning', progress: '3/12 files' });
    t.report('ai.embed', {
      ok: false,
      code: 'unknown',
      reason: 'sha256 mismatch for onnx/model_q4.onnx_data',
      hint: 'ai.provisionFailed',
    });

    const row = t.getHealth()['ai.embed'];
    expect(row.preparing).toBeUndefined();
    expect(row.status).toBe('fail');
    expect(row.reason).toMatch(/sha256/);
    expect(row.hint).toBe('ai.provisionFailed');
  });

  it('entering preparing on a previously-ok slot keeps status ok and does not fire a transition', () => {
    const { t, transitions } = tracker();
    t.report('ai.embed', { ok: true });
    t.report('ai.embed', { preparing: true, phase: 'provisioning', progress: '0/12 files' });
    expect(t.getHealth()['ai.embed'].status).toBe('ok');
    expect(t.getHealth()['ai.embed'].preparing).toBe(true);
    expect(transitions).toEqual([]);
  });

  it('settings/public derivation reads false while preparing (ok-derived rule unchanged)', () => {
    // The settings route derives ai flags from status==='ok' — a preparing row
    // is not ok, so the public flag stays false. Pin the derivation input here
    // via the tracker shape the route reads.
    const { t } = tracker();
    t.report('ai.embed', { preparing: true, phase: 'provisioning', progress: '1/12 files' });
    const health = t.getHealth();
    expect(health['ai.embed'].status === 'ok').toBe(false);
  });
});

describe('provision lock loading + weight-presence detection (unit seams)', () => {
  let provision;
  beforeAll(() => {
    provision = require('../provision');
  });

  it('loadLock() parses the checked-in artifact with validated shape', () => {
    const lock = provision.loadLock();
    expect(lock.repo).toBe('onnx-community/embeddinggemma-2-ONNX');
    expect(lock.files.length).toBeGreaterThanOrEqual(10);
  });

  it('weightsPresent(dir, lock) verifies every file by size + sha256', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wea-lock-'));
    try {
      const small = [
        { path: 'a.bin', sha256: crypto.createHash('sha256').update('aaa').digest('hex'), size: 3 },
        {
          path: 'sub/b.bin',
          sha256: crypto.createHash('sha256').update('bb').digest('hex'),
          size: 2,
        },
      ];
      expect(provision.weightsPresent(tmp, { files: small })).toBe(false);

      fs.writeFileSync(path.join(tmp, 'a.bin'), 'aaa');
      fs.mkdirSync(path.join(tmp, 'sub'));
      fs.writeFileSync(path.join(tmp, 'sub/b.bin'), 'bb');
      expect(provision.weightsPresent(tmp, { files: small })).toBe(true);

      // Wrong size (truncated download) ⇒ not present.
      fs.writeFileSync(path.join(tmp, 'sub/b.bin'), 'b');
      expect(provision.weightsPresent(tmp, { files: small })).toBe(false);
      // Wrong content (sha mismatch) ⇒ not present.
      fs.writeFileSync(path.join(tmp, 'sub/b.bin'), 'zz');
      expect(provision.weightsPresent(tmp, { files: small })).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
