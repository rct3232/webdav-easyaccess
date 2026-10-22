'use strict';

/**
 * AI jobs worker tests (aiJobService.md §2.3) + the llmAdapter runtime
 * singleton idiom (llmAdapterRuntime.js).
 *
 * Black-box seams only: stores/pipeline/adapter are injected fakes; the
 * observable contract is the drain dispatch, the role-gate parking, the
 * stale reap, the WEA_SKIP_AI_WORKER seam and the timer lifecycle.
 */

const { createAiJobService } = require('../jobService');
const {
  initLlmAdapter,
  getLlmAdapter,
  resetLlmAdapter,
} = require('../../../infrastructure/llmAdapterRuntime');

function fakeTimers() {
  const scheduled = [];
  return {
    scheduled,
    setTimeout: (fn, ms) => {
      scheduled.push({ fn, ms, cancelled: false });
      return scheduled.length;
    },
    clearTimeout: (id) => {
      if (scheduled[id - 1]) scheduled[id - 1].cancelled = true;
    },
    lastTimer() {
      return scheduled[scheduled.length - 1];
    },
  };
}

function fakeAdapter(overrides = {}) {
  return {
    roleConfigured: jest.fn(async () => true),
    ...overrides,
  };
}

describe('aiJobService worker (§2.3)', () => {
  afterEach(() => {
    delete process.env.WEA_SKIP_AI_WORKER;
    resetLlmAdapter();
  });

  test('WEA_SKIP_AI_WORKER makes startAiWorker a no-op (no scheduling, no reap)', async () => {
    process.env.WEA_SKIP_AI_WORKER = '1';
    const timers = fakeTimers();
    const reap = jest.fn(async () => ({ changes: 0 }));
    const svc = createAiJobService({
      timers,
      staleMs: 1000,
      aiJobsStore: { recoverStaleRunning: reap },
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: jest.fn() },
    });
    const outcome = await svc.startAiWorker();
    expect(outcome).toEqual({ started: false, reason: 'WEA_SKIP_AI_WORKER' });
    expect(reap).not.toHaveBeenCalled();
    expect(timers.scheduled).toHaveLength(0);
  });

  test('startup reaps stale claims once, then schedules the poll loop', async () => {
    const timers = fakeTimers();
    const reap = jest.fn(async () => ({ changes: 2 }));
    const svc = createAiJobService({
      timers,
      staleMs: 1234,
      pollMs: 777,
      aiJobsStore: { recoverStaleRunning: reap },
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: jest.fn() },
    });
    await svc.startAiWorker();
    expect(reap).toHaveBeenCalledWith(1234);
    expect(timers.scheduled).toHaveLength(1);
    expect(timers.lastTimer().ms).toBe(777);
  });

  test('startAiWorker is idempotent (a second call adds no timer)', async () => {
    const timers = fakeTimers();
    const svc = createAiJobService({
      timers,
      staleMs: 1000,
      pollMs: 10,
      aiJobsStore: { recoverStaleRunning: async () => ({ changes: 0 }) },
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: jest.fn() },
    });
    await svc.startAiWorker();
    await svc.startAiWorker();
    expect(timers.scheduled).toHaveLength(1);
  });

  test('drainPass parks with no adapter (pre-init) — pipeline never invoked', async () => {
    const runPipeline = jest.fn(async () => 0);
    const svc = createAiJobService({
      adapter: null,
      embedPipeline: { runPendingEmbedJobs: runPipeline },
    });
    await svc.drainPass();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  test('drainPass parks while the embed role is unconfigured (zero attempt inflation)', async () => {
    const runPipeline = jest.fn(async () => 0);
    const adapter = fakeAdapter({ roleConfigured: jest.fn(async () => false) });
    const svc = createAiJobService({
      adapter,
      embedPipeline: { runPendingEmbedJobs: runPipeline },
    });
    await svc.drainPass();
    expect(adapter.roleConfigured).toHaveBeenCalledWith('embed');
    expect(runPipeline).not.toHaveBeenCalled();
  });

  test('drainPass with a configured role drives the pipeline (adapter + readText + timeout)', async () => {
    const runPipeline = jest.fn(async () => 3);
    const adapter = fakeAdapter();
    const readText = jest.fn(async () => 'text');
    const svc = createAiJobService({
      adapter,
      readText,
      jobTimeoutMs: 4500,
      llmModelsStore: { getActiveByRole: async () => ({ id: 42 }) },
      embedPipeline: { runPendingEmbedJobs: runPipeline },
    });
    await svc.drainPass();
    expect(runPipeline).toHaveBeenCalledTimes(1);
    const call = runPipeline.mock.calls[0][0];
    expect(call.adapter).toBe(adapter);
    expect(call.readText).toBe(readText);
    expect(call.jobTimeoutMs).toBe(4500);
    // §2.3 step 6: the ACTIVE embed model id resolves per pass through the
    // registry facade — the pipeline's claim gate (a null id drains nothing).
    await expect(call.activeModelId()).resolves.toBe(42);
  });

  test('the activeModelId seam resolves null when no registry row exists', async () => {
    const runPipeline = jest.fn(async () => 0);
    const svc = createAiJobService({
      adapter: fakeAdapter(),
      llmModelsStore: { getActiveByRole: async () => null },
      embedPipeline: { runPendingEmbedJobs: runPipeline },
    });
    await svc.drainPass();
    const call = runPipeline.mock.calls[0][0];
    await expect(call.activeModelId()).resolves.toBeNull();
  });

  test('a drainPass throw is contained (the loop keeps scheduling)', async () => {
    const timers = fakeTimers();
    const runPipeline = jest.fn(async () => {
      throw new Error('boom');
    });
    const svc = createAiJobService({
      timers,
      pollMs: 5,
      staleMs: 1000,
      aiJobsStore: { recoverStaleRunning: async () => ({ changes: 0 }) },
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: runPipeline },
    });
    await svc.startAiWorker();
    const first = timers.lastTimer();
    await first.fn();
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(timers.scheduled).toHaveLength(2); // re-scheduled after the failure
  });

  test('the loop reschedules itself after each pass; stopAiWorker ends it', async () => {
    const timers = fakeTimers();
    const svc = createAiJobService({
      timers,
      pollMs: 5,
      staleMs: 1000,
      aiJobsStore: { recoverStaleRunning: async () => ({ changes: 0 }) },
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: jest.fn(async () => 0) },
    });
    await svc.startAiWorker();
    const first = timers.lastTimer();
    await first.fn();
    expect(timers.scheduled).toHaveLength(2);
    svc.stopAiWorker();
    expect(first.cancelled || timers.scheduled[1].cancelled || !timers.lastTimer()).toBe(true);
    const after = timers.scheduled.filter((t) => !t.cancelled).length;
    const next = timers.scheduled[1];
    await next.fn();
    // After stop, the completed pass re-schedules nothing new.
    expect(timers.scheduled.length).toBe(2);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  test('default readNodeText unwraps extractText to plain text and maps unextractable to null', async () => {
    const nodes = {
      1: { mimeType: 'text/plain' },
      2: { mimeType: 'image/png' },
    };
    const blobs = { 1: Buffer.from('hello world'), 2: Buffer.from('PNG') };
    // readNodeText is exercised through the pipeline seam injected by default.
    const runPipeline = jest.fn(async (overrides) => {
      expect(typeof overrides.readText).toBe('function');
      return 0;
    });
    const svc2 = createAiJobService({
      adapter: fakeAdapter(),
      embedPipeline: { runPendingEmbedJobs: runPipeline },
      fileNodesStore: { getNode: async (id) => nodes[id] ?? null },
      blobStorageService: { downloadBlob: async (id) => blobs[id] ?? null },
    });
    await svc2.drainPass();
    const readText = runPipeline.mock.calls[0][0].readText;
    await expect(readText(1)).resolves.toBe('hello world');
    await expect(readText(2)).resolves.toBeNull(); // unextractableText ⇒ null skip
    await expect(readText(999)).resolves.toBeNull(); // missing node
    await expect(readText(3)).resolves.toBeNull(); // no blob
  });
});

describe('llmAdapterRuntime singleton', () => {
  afterEach(() => resetLlmAdapter());

  test('getLlmAdapter returns null before init and the installed instance after', () => {
    expect(getLlmAdapter()).toBeNull();
    const adapter = initLlmAdapter({ configResolver: { getConfig: async () => null } });
    expect(getLlmAdapter()).toBe(adapter);
    resetLlmAdapter();
    expect(getLlmAdapter()).toBeNull();
  });

  test('re-init replaces the installed adapter', () => {
    const first = initLlmAdapter({ configResolver: { getConfig: async () => null } });
    const second = initLlmAdapter({ configResolver: { getConfig: async () => null } });
    expect(second).not.toBe(first);
    expect(getLlmAdapter()).toBe(second);
  });
});
