'use strict';

/**
 * backendProbe public-API guard.
 *
 * Regression guard: the boot S3 probe (server/index.js) destructures
 * `probeS3` from backendProbe. probeS3 was omitted from module.exports, so
 * boot printed "S3 connection test: FAILED — probeS3 is not a function"
 * without ever testing connectivity. Keeping the export under test prevents
 * that from silently returning.
 */
const backendProbe = require('../backendProbe');

describe('backendProbe exports', () => {
  it('exposes probeS3 so the boot sequence can run a real S3 probe', () => {
    expect(typeof backendProbe.probeS3).toBe('function');
  });

  it('exposes probePostgresql for probe reuse (no future W-5-style landmine)', () => {
    expect(typeof backendProbe.probePostgresql).toBe('function');
  });

  it('exposes runProbe and the classification helpers used by boot/admin-test', () => {
    expect(typeof backendProbe.runProbe).toBe('function');
    expect(typeof backendProbe.classifyToHealthCode).toBe('function');
    expect(typeof backendProbe.classifyS3BucketError).toBe('function');
    expect(typeof backendProbe.classifyPgError).toBe('function');
    expect(typeof backendProbe.deriveReason).toBe('function');
  });
});

describe('probeLlm slot (T0.7b — registration seam; no real network)', () => {
  afterEach(() => {
    // Deregister test handlers so the shared module state never leaks.
    if (typeof backendProbe.unregisterProbeTarget === 'function') {
      backendProbe.unregisterProbeTarget(backendProbe.PROBE_TARGET_LLM);
      backendProbe.unregisterProbeTarget('postgresql');
    }
  });

  it('exposes the registration seam and the reserved llm slot', () => {
    expect(typeof backendProbe.registerProbeTarget).toBe('function');
    expect(backendProbe.PROBE_TARGET_LLM).toBe('llm');
  });

  it('dispatches a registered handler for the llm slot (fake/di handler, no network)', async () => {
    const probeLlm = jest.fn((body) => Promise.resolve({ ok: true, echo: body }));
    backendProbe.registerProbeTarget(backendProbe.PROBE_TARGET_LLM, probeLlm);

    const body = { LLM_CHAT_BASE_URL: 'http://fake.local', LLM_CHAT_MODEL: 'fake-model' };
    const result = await backendProbe.runProbe(backendProbe.PROBE_TARGET_LLM, body);

    expect(probeLlm).toHaveBeenCalledTimes(1);
    expect(probeLlm).toHaveBeenCalledWith(body);
    expect(result).toEqual({ ok: true, echo: body });
  });

  it('propagates a registered handler failure as the probe result', async () => {
    const probeLlm = jest.fn(() => Promise.reject(Object.assign(new Error('probe failed'))));
    backendProbe.registerProbeTarget(backendProbe.PROBE_TARGET_LLM, probeLlm);

    await expect(backendProbe.runProbe(backendProbe.PROBE_TARGET_LLM, {})).rejects.toThrow(
      'probe failed'
    );
  });

  it('keeps the unsupported-target 400 for the reserved slot before T1.1 registers it', async () => {
    await expect(backendProbe.runProbe('llm', {})).rejects.toMatchObject({
      status: 400,
      errorCode: 'serverErrors.setup.testFailed',
    });
  });

  it('keeps unknown targets rejected with the same 400 shape', async () => {
    await expect(backendProbe.runProbe('smtp', {})).rejects.toMatchObject({
      status: 400,
      errorCode: 'serverErrors.setup.testFailed',
    });
  });

  it('refuses a non-function handler', () => {
    expect(() => backendProbe.registerProbeTarget('llm', 'not-a-function')).toThrow(TypeError);
  });

  it('lets a registered handler win over the built-in target of the same name (di seam)', async () => {
    const fakePostgresql = jest.fn(() => Promise.resolve({ ok: true, fake: true }));
    backendProbe.registerProbeTarget('postgresql', fakePostgresql);
    const result = await backendProbe.runProbe('postgresql', {});
    expect(fakePostgresql).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, fake: true });
  });
});
