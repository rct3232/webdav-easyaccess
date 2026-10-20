'use strict';

/**
 * T1.0a posture scenarios (llmPresets §2.3 provisioning row / llmAdapter §2.1+
 * §2.8 `provisioning` error class / bootSequence §2 step 8b / TESTING_STRATEGY
 * provisioning-trigger fixtures).
 *
 * The provider decision is the ONLY discriminator (PLAN §22-5):
 *   - setup-mode boot (setup_complete=false) ⇒ NO attempt — zero bytes, zero egress.
 *   - configured boot + built-in active (no enabled remote embed override row) ⇒
 *     weights present ⇒ no-op (zero egress); missing ⇒ BLOCKING attempt with
 *     per-file CLI progress; attempt failure ⇒ boot continues, embed caps OFF +
 *     admin reason (warn-only — runBoot's catch must not fire).
 *   - configured boot + remote override active ⇒ DEFERRED — no attempt, and the
 *     absence of weights is the normal state (never a caps-off signal).
 *   - remote-override clear while the server serves ⇒ IN-PLACE run, restart-free;
 *     the server keeps serving, the role reports `preparing` until the outcome.
 *
 * No test here may fetch model bytes: every scenario drives the provisioner
 * through injected seams (fetcher, logger, health) against fixtures — an
 * accidental real network request fails the suite (TESTING_STRATEGY §AI stub
 * rule).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createBackendHealth } = require('../../../backendHealth');

const LOCK_PATH = path.join(__dirname, '..', 'model.lock.json');
const MODEL_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
/** Build a lock fixture with REAL lock fields but fixture-file hashes. */
function makeLockFixture(dir, { corrupt = false } = {}) {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  // Replace the file set with two small fixture files whose sha256 we control.
  const a = Buffer.from('fixture-alpha-bytes\n');
  const b = Buffer.from('fixture-beta-bytes\n');
  if (corrupt) b.write('X', 0, 'utf8'); // corrupt AFTER hashing: b's recorded hash stays the honest one
  const crypto = require('crypto');
  const entries = [
    { name: 'config.json', buf: a },
    { name: 'onnx/model_q4.onnx_data', buf: b },
  ].map(({ name, buf }) => {
    fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return {
      path: name,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      size: buf.length,
    };
  });
  return { ...lock, revision: MODEL_REVISION, files: entries };
}

/**
 * Harness: fresh isolated tracker + provision deps. `files` seeds the fake
 * origin the fetcher downloads from; `fetchLog` records every requested path so
 * zero-egress assertions can count calls.
 */
function makeHarness({ lockOverride, corruptFile = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wea-provision-'));
  const modelDir = path.join(tmp, 'weights');
  const lock = makeLockFixture(tmp, { corrupt: false });
  const origin = new Map(lock.files.map((f) => [f.path, Buffer.from('')]));
  // Rebuild origin bytes from the hashed fixtures (the fixture dir holds them).
  origin.set('config.json', fs.readFileSync(path.join(tmp, 'config.json')));
  origin.set('onnx/model_q4.onnx_data', fs.readFileSync(path.join(tmp, 'onnx/model_q4.onnx_data')));

  const fetchLog = [];
  const fetcher = {
    async fetchBuffer(repo, revision, filePath) {
      fetchLog.push(filePath);
      if (corruptFile === filePath) {
        const buf = Buffer.from(origin.get(filePath));
        buf[0] = buf[0] ^ 0xff;
        return buf;
      }
      const buf = origin.get(filePath);
      if (!buf) throw new Error(`no fixture for ${filePath}`);
      return buf;
    },
  };

  const health = createBackendHealth();
  const logLines = [];
  const logger = {
    log: (...a) => logLines.push(a.join(' ')),
    warn: (...a) => logLines.push(`WARN ${a.join(' ')}`),
    error: (...a) => logLines.push(`ERR ${a.join(' ')}`),
  };

  const lockJson = lockOverride || lock;

  return {
    logger,
    tmp,
    modelDir,
    lock: lockJson,
    fetcher,
    fetchLog,
    health,
    logLines,
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** A skipped posture must never carry a caps-off reason for absent weights. */
function capsOffReported(logLines) {
  return logLines.some((l) => /caps|OFF|failed/i.test(l));
}

describe('built-in embed provisioning postures (T1.0a)', () => {
  let provision;
  beforeAll(() => {
    provision = require('../provision');
  });

  describe('posture 1 — setup-mode boot never downloads', () => {
    it('makes NO attempt: zero fetch calls, zero egress, no caps-off signal', async () => {
      const h = makeHarness();
      try {
        const result = await provision.runProvision({
          mode: 'boot',
          setupComplete: false,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
        });

        expect(result.status).toBe('skipped-setup');
        expect(h.fetchLog).toEqual([]); // zero network egress
        expect(capsOffReported(h.logLines)).toBe(false);
        // The role slot is untouched — not caps-off, not preparing.
        expect(h.health.getHealth()['ai.embed'].status).toBe('unknown');
        expect(h.health.getHealth()['ai.embed'].preparing).toBeUndefined();
      } finally {
        h.cleanup();
      }
    });
  });

  describe('posture 2 — remote override active defers the trigger', () => {
    it('skips with no attempt and no caps-off: absent weights are the normal state', async () => {
      const h = makeHarness();
      try {
        const result = await provision.runProvision({
          mode: 'boot',
          setupComplete: true,
          remoteOverrideActive: true,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
        });

        expect(result.status).toBe('skipped-remote');
        expect(h.fetchLog).toEqual([]);
        expect(capsOffReported(h.logLines)).toBe(false);
        expect(h.health.getHealth()['ai.embed'].status).toBe('unknown');
      } finally {
        h.cleanup();
      }
    });
  });

  describe('posture 3 — override-clear triggers provisioning in place', () => {
    it('runs server-non-blocking (mode in-place): role reports preparing, then the outcome', async () => {
      const h = makeHarness();
      try {
        const result = await provision.runProvision({
          mode: 'in-place',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
        });

        expect(result.status).toBe('provisioned');
        expect(h.fetchLog.length).toBe(h.lock.files.length);
        // All files installed and checksum-verified.
        for (const f of h.lock.files) {
          expect(fs.existsSync(path.join(h.modelDir, f.path))).toBe(true);
        }
        // The in-place run reported the generic preparing state with the
        // provisioning phase while running, and resolved it at the end.
        expect(h.health.getHealth()['ai.embed'].preparing).toBeUndefined();
      } finally {
        h.cleanup();
      }
    });

    it('reports preparing(phase=provisioning, progress) DURING the run via the health tracker', async () => {
      const h = makeHarness();
      try {
        const seen = [];
        const health = createBackendHealth();
        // Instrument: observe tracker state between file downloads.
        const slowFetcher = {
          async fetchBuffer(repo, revision, filePath) {
            const before = health.getHealth()['ai.embed'];
            seen.push({ file: filePath, state: { ...before } });
            return h.fetcher.fetchBuffer(repo, revision, filePath);
          },
        };
        await provision.runProvision({
          mode: 'in-place',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health,
          fetcher: slowFetcher,
          logger: h.logger,
        });

        expect(seen.length).toBeGreaterThan(0);
        for (const s of seen) {
          expect(s.state.preparing).toBe(true);
          expect(s.state.phase).toBe('provisioning');
          expect(s.state.progress).toMatch(/\d+\/\d+/);
        }
        // Terminal report clears the readiness state.
        const end = health.getHealth()['ai.embed'];
        expect(end.preparing).toBeUndefined();
      } finally {
        h.cleanup();
      }
    });
  });

  describe('posture 4 — WEA_MODEL_DIR pre-seed is idempotent', () => {
    it('pre-seeded weights ⇒ zero download attempts, zero network egress', async () => {
      const h = makeHarness();
      try {
        // Pre-seed: run once to populate, then wipe the fetch log.
        await provision.runProvision({
          mode: 'boot',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
        });
        h.fetchLog.length = 0;

        const second = await provision.runProvision({
          mode: 'boot',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
        });

        expect(second.status).toBe('present');
        expect(h.fetchLog).toEqual([]); // zero download attempts, zero egress
        expect(capsOffReported(h.logLines)).toBe(false);
      } finally {
        h.cleanup();
      }
    });
  });

  describe('posture 5 — checksum failure ⇒ caps OFF with honest reason, boot continues', () => {
    it('failed attempt does not throw: warn-only outcome the boot path survives', async () => {
      const h = makeHarness();
      try {
        const result = await provision.runProvision({
          mode: 'boot',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
          corruptFile: 'onnx/model_q4.onnx_data',
        });

        expect(result.status).toBe('failed');
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
        // Boot-continues contract: the runner NEVER throws on a failed attempt.
        // The admin reason names the checksum failure (probe 'sha256' in the
        // reason or the failure class).
        expect(/sha256|checksum/i.test(result.reason)).toBe(true);
        // The role slot carries the failure WITHOUT a transition-firing ok:false
        // report storm: warn-only handling (the boot catch must not fire —
        // asserted by construction: no throw reaches here).
        const row = h.health.getHealth()['ai.embed'];
        expect(row.preparing).toBeUndefined();
      } finally {
        h.cleanup();
      }
    });

    it('staged partial files are never consumed: the model dir holds no partial on failure', async () => {
      const h = makeHarness();
      try {
        await provision.runProvision({
          mode: 'boot',
          setupComplete: true,
          remoteOverrideActive: false,
          modelDir: h.modelDir,
          lock: h.lock,
          health: h.health,
          fetcher: h.fetcher,
          logger: h.logger,
          corruptFile: 'onnx/model_q4.onnx_data',
        });

        // Atomic staging: no partially-written file may sit in the final tree.
        // The corrupt file failed verification, so nothing of it is installed;
        // the successfully-verified earlier files MAY be present (idempotent
        // resumption), but the corrupt one must be absent.
        expect(fs.existsSync(path.join(h.modelDir, 'onnx/model_q4.onnx_data'))).toBe(false);
      } finally {
        h.cleanup();
      }
    });
  });
});
