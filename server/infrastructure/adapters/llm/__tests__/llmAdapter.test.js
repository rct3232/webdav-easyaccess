'use strict';

/**
 * llmAdapter core test (docs/spec/server/infrastructure/llmAdapter.md §2.2,
 * §2.3, §2.5, §2.9 — B2 / T1.1b).
 *
 * RED-first targets (PLAN §27 wave B): hot re-probe restart-free (a config
 * change is reflected by the adapter WITHOUT a restart) and the circuit
 * breaker (5 consecutive transport failures ⇒ OPEN 300s, half-open probe on
 * expiry).
 *
 * No test here may talk real HTTP: the client factory, probe, provisioner and
 * stores are injected seams (TESTING_STRATEGY §AI stub rule). The embedded
 * engine's real client/provisioner belong to T1.0a (A3); the preset manifest
 * seam belongs to T1.1a (B1) — this suite injects fixtures for both.
 */

const { createLlmAdapter } = require('../index');
const { resolveBudget, createLimiter } = require('../budget');
const { kit } = require('../presets');
const probeState = require('../probeState');
const vectorRuntime = require('../../../../domains/ai/vectorStoreRuntime');

// ── test seams ───────────────────────────────────────────────────────────────

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Manually-pumped timer queue driven by the injectable clock. */
function makeTimers(clock) {
  const pending = new Map();
  let nextId = 0;
  return {
    pending,
    setTimeout(fn, ms) {
      const id = ++nextId;
      pending.set(id, { fn, at: clock.now() + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    fireDue() {
      for (const [id, timer] of [...pending.entries()]) {
        if (timer.at <= clock.now()) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/**
 * In-memory stand-in for configResolver over the DB settings rows: T2 dbOnly
 * semantics — values come from the store only (env is never consulted).
 */
function makeResolver(initial = {}) {
  const store = new Map(Object.entries(initial));
  const listeners = [];
  return {
    store,
    onChange(fn) {
      listeners.push(fn);
    },
    async set(key, value) {
      if (value === undefined || value === '') store.delete(key);
      else store.set(key, String(value));
      for (const fn of listeners) fn([key]);
    },
    configResolver: {
      async getConfig(key) {
        const v = store.get(key);
        return v === undefined ? undefined : v;
      },
    },
  };
}

/** Client factory seam: one fake client per signature, scripted outcomes. */
const CLIENT_METHODS = ['embed', 'embedQuery', 'chat', 'visionCaption', 'asrTranscribe'];

function makeClientFactory() {
  const created = [];
  return {
    created,
    createClient(spec) {
      const client = {
        spec,
        calls: [],
        script: [],
        queue(outcome) {
          this.script.push(outcome);
        },
        async __call(method, args) {
          this.calls.push({ method, args });
          const next = this.script.length ? this.script.shift() : { type: 'ok', value: [] };
          if (next.type === 'ok') return next.value;
          throw next.error;
        },
      };
      for (const method of CLIENT_METHODS) {
        client[method] = (...args) => client.__call(method, args);
      }
      created.push(client);
      return client;
    },
  };
}

function makeUsageStore() {
  const rows = new Map(); // `${day}|${role}` → row
  return {
    rows,
    async recordUsage(delta) {
      const key = `${delta.day}|${delta.role}`;
      const row = rows.get(key) || {
        day: delta.day,
        role: delta.role,
        calls: 0,
        inputChars: 0,
        cached: 0,
        degraded: 0,
        failed429: 0,
      };
      for (const k of ['calls', 'inputChars', 'cached', 'degraded', 'failed429']) {
        row[k] += delta[k] || 0;
      }
      rows.set(key, row);
      return { changes: 1 };
    },
    async getByDay(day) {
      return [...rows.values()]
        .filter((r) => r.day === day)
        .sort((a, b) => (a.role < b.role ? -1 : 1));
    },
    async summarizeRange() {
      return [];
    },
  };
}

/** Minimal identity-keyed stand-in for llmModelsStore (llmModelsStore §2.3). */
function makeModelsStore() {
  const rows = new Map();
  let nextId = 1;
  const keyOf = (s) =>
    [s.role, s.provider, s.engine, s.baseUrlKey, s.modelName, s.modelRevision ?? null].join('|');
  return {
    rows,
    specs: [],
    async upsertModel(spec) {
      this.specs.push(spec);
      const key = keyOf(spec);
      const existing = rows.get(key);
      if (existing) {
        Object.assign(existing, {
          precision: spec.precision ?? existing.precision,
          maxInputChars: spec.maxInputChars ?? existing.maxInputChars,
          chunkBudget: spec.chunkBudget ?? existing.chunkBudget,
          batchSize: spec.batchSize ?? existing.batchSize,
          reasoning: spec.reasoning ?? existing.reasoning,
          enabled: spec.enabled ?? existing.enabled,
        });
        return { id: existing.id };
      }
      const id = nextId++;
      rows.set(key, { id, ...spec });
      return { id };
    },
    async getModel(id) {
      return [...rows.values()].find((r) => r.id === id) || null;
    },
    async getActiveByRole(role) {
      const enabled = [...rows.values()].filter((r) => r.role === role && r.enabled);
      return enabled.length ? enabled[enabled.length - 1] : null;
    },
    async listByRole(role) {
      return [...rows.values()].filter((r) => r.role === role);
    },
    async setReasoning() {
      return { changes: 1 };
    },
  };
}

function transportError(msg = 'connection reset') {
  const err = new Error(msg);
  err.code = 'ECONNRESET';
  return err;
}

/**
 * Fake remote endpoint for the EG2 conformance probe (the adapter's HTTP
 * transport seam). `mode`:
 *   - 'conforming' — echoes the kit's canonical vectors ⇒ median cos 1.0;
 *   - 'foreign'    — same 768 dim, negated canonical vectors ⇒ median cos −1
 *                    (a same-dim DIFFERENT space — the gate must reject it);
 *   - 'wrongDim'   — 512-dim vectors ⇒ structural failure before the cosine.
 */
function makeConformanceEndpoint(initialMode = 'conforming') {
  const canonical = kit().vectors;
  const calls = [];
  let mode = initialMode;

  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    let vectors;
    if (mode === 'foreign') {
      vectors = canonical.map((v) => Array.from(v, (x) => -x));
    } else if (mode === 'wrongDim') {
      vectors = canonical.map(() => new Array(512).fill(0.1));
    } else {
      vectors = canonical.map((v) => Array.from(v));
    }
    return {
      ok: true,
      status: 200,
      async json() {
        // Deliberately reversed: the probe must restore the kit input order
        // through the response `index`, never rely on arrival order.
        return {
          data: vectors.map((embedding, index) => ({ index, embedding })).reverse(),
        };
      },
    };
  };

  return {
    fetchImpl,
    calls,
    setMode(next) {
      mode = next;
    },
  };
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const REMOTE_EMBED = {
  LLM_EMBED_BASE_URL: 'http://llama.local:8080',
  LLM_EMBED_MODEL: 'embeddinggemma-2',
  LLM_EMBED_API_KEY: 'sk-test',
};

const REMOTE_CHAT = {
  LLM_CHAT_BASE_URL: 'http://chat.local:8080',
  LLM_CHAT_MODEL: 'gemma-4-12b-it',
  LLM_CHAT_API_KEY: 'sk-chat',
};

/** A unit basis vector — distinct indexes are guaranteed non-degenerate. */
function unitVectorAt(index, dim = 768) {
  const vector = new Array(dim).fill(0);
  vector[index] = 1;
  return vector;
}

/** External-EG2 profile fixture: dim + the declared pooling shape. */
const EMBED_PRESET = {
  id: 'embeddinggemma-2-external',
  family: 'llama.cpp',
  expected: { text_embed: true, image_embed: true, audio_embed: true, video_embed: true },
  profile: { dim: 768, pooling: 'mean' },
  budgets: { maxInputCharsDefault: 8192, chunkBudget: 4, batchSize: 8 },
};

const LOCK = {
  repo: 'onnx-community/embeddinggemma-2-ONNX',
  revision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  dtype: 'q4',
  dim: 768,
};

function buildAdapter(overrides = {}) {
  const clock = overrides.clock || makeClock();
  const timers = overrides.timers || makeTimers(clock);
  const clients = overrides.clients || makeClientFactory();
  const usage = overrides.usage || makeUsageStore();
  const models = overrides.models || makeModelsStore();
  const probeCalls = [];
  const provisionCalls = [];
  const healthReports = [];

  const deps = {
    configResolver: (overrides.resolver || makeResolver()).configResolver,
    createClient: (spec) => clients.createClient(spec),
    probeRole: async (info) => {
      probeCalls.push(info);
      return { ok: true };
    },
    provisioner: {
      runProvision: async (params) => {
        provisionCalls.push(params);
        return { status: 'provisioned' };
      },
      weightsPresent: async () => true,
      loadLock: () => LOCK,
      resolveModelDir: () => '/fixtures/model-dir',
    },
    llmModelsStore: models,
    aiUsageDailyStore: usage,
    health: { report: (key, patch) => healthReports.push({ key, patch }) },
    presetFor: () => null,
    // Hermetic built-in positive control: the real ONNX kit pass belongs to
    // the embedded smoke suite; adapter tests assert the probe wiring only.
    embeddedPositiveControl: async () => ({ median: 1, min: 1, dim: 768 }),
    clock,
    timers,
    // Hermetic default transport: a CONFORMING endpoint, so a remote embed
    // fixture activates without real HTTP. Conformance-specific tests inject
    // their own `makeConformanceEndpoint` mode.
    fetchImpl: makeConformanceEndpoint('conforming').fetchImpl,
    ...overrides.deps,
  };
  const adapter = createLlmAdapter(deps);
  return {
    adapter,
    clock,
    timers,
    clients,
    usage,
    models,
    probeCalls,
    provisionCalls,
    healthReports,
  };
}

// ── per-call resolution + hot re-probe (restart-free) ────────────────────────

describe('per-call config resolution + signature-keyed client cache', () => {
  it('unconfigured role ⇒ roleConfigured false and getRoleClient null', async () => {
    const { adapter } = buildAdapter();
    await expect(adapter.roleConfigured('chat')).resolves.toBe(false);
    await expect(adapter.getRoleReadiness('chat')).resolves.toEqual({
      configured: false,
      reason: 'not_configured',
    });
    await expect(adapter.getRoleClient('chat')).resolves.toBeNull();
  });

  it('a settings change flips roleConfigured and swaps the client WITHOUT a restart; debounced re-probe fires', async () => {
    const r = makeResolver();
    const { adapter, clients, timers, clock, probeCalls } = buildAdapter({ resolver: r });

    await expect(adapter.roleConfigured('chat')).resolves.toBe(false);

    // Hot config change: DB row written + resolver cache invalidated — the
    // same process, no restart.
    await r.set('LLM_CHAT_BASE_URL', 'http://chat.local:8080');
    await r.set('LLM_CHAT_MODEL', 'gemma-4-12b-it');

    await expect(adapter.roleConfigured('chat')).resolves.toBe(true);
    const clientA = await adapter.getRoleClient('chat');
    expect(clientA).not.toBeNull();

    await adapter.chat([{ role: 'user', content: 'hello' }]);
    expect(clients.created).toHaveLength(1);
    expect(clients.created[0].calls[0].method).toBe('chat');

    // Re-probe is debounced (default 60s): not yet fired, fires after the
    // debounce window.
    timers.fireDue();
    expect(probeCalls).toHaveLength(0);
    clock.advance(60_000);
    timers.fireDue();
    await flushAsync();
    expect(probeCalls).toEqual([{ role: 'chat' }]);
  });

  it('repeated signature changes within the debounce window collapse to ONE re-probe', async () => {
    const r = makeResolver({ ...REMOTE_CHAT });
    const { adapter, timers, clock, probeCalls } = buildAdapter({ resolver: r });

    await adapter.getRoleClient('chat'); // prime the signature
    await r.set('LLM_CHAT_MODEL', 'gemma-4-12b-it-v2');
    await adapter.getRoleClient('chat');
    clock.advance(30_000);
    await r.set('LLM_CHAT_MODEL', 'gemma-4-12b-it-v3');
    await adapter.getRoleClient('chat');

    clock.advance(60_000);
    timers.fireDue();
    await flushAsync();
    expect(probeCalls).toHaveLength(1);
  });

  it('clearing the remote embed override returns to the built-in WITHOUT a restart; absent weights trigger the in-place provisioning run', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const provisioner = {
      runProvision: async (params) => {
        provisioner.params.push(params);
        return { status: 'provisioned' };
      },
      params: [],
      weightsPresent: async () => false,
      loadLock: () => LOCK,
      resolveModelDir: () => '/fixtures/model-dir',
    };
    const { adapter, healthReports } = buildAdapter({ resolver: r, deps: { provisioner } });

    // Remote override active: role configured, remote client.
    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);
    await expect(adapter.getRoleReadiness('embed')).resolves.toEqual({
      configured: true,
      reason: null,
    });
    const remoteClient = await adapter.getRoleClient('embed');
    expect(remoteClient.spec.engine).toBe('remote');

    // Override cleared (DB rows deleted) — restart-free return to built-in.
    await r.set('LLM_EMBED_BASE_URL', undefined);
    await r.set('LLM_EMBED_MODEL', undefined);

    // Weights absent ⇒ in-place provisioning run, role reports preparing and
    // is NOT configured while it runs (consumers park — never claim-and-fail).
    await expect(adapter.roleConfigured('embed')).resolves.toBe(false);
    // The fake in-place run resolves immediately; the post-run readiness is
    // the honest failure reason (the transient `preparing` window is covered
    // by searchService's readiness-reason test).
    await expect(adapter.getRoleReadiness('embed')).resolves.toEqual({
      configured: false,
      reason: 'provisioning_failed',
    });
    expect(provisioner.params).toHaveLength(1);
    expect(provisioner.params[0]).toMatchObject({ mode: 'in-place', remoteOverrideActive: false });
    expect(healthReports.some((h) => h.key === 'ai.embed' && h.patch.preparing)).toBe(true);

    // The in-place run is server-non-blocking: resolveModelDir was used, the
    // call returned without waiting on weights appearing in a boot path.
    expect(provisioner.params[0].modelDir).toBe('/fixtures/model-dir');
  });

  it('embedded role with weights present is configured without any remote triple', async () => {
    const { adapter } = buildAdapter();
    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);
    await expect(adapter.getRoleReadiness('embed')).resolves.toEqual({
      configured: true,
      reason: null,
    });
    const client = await adapter.getRoleClient('embed');
    expect(client.spec.engine).toBe('embedded');
  });
});

// ── circuit breaker (§2.5 transport class) ───────────────────────────────────

describe('circuit breaker — 5 consecutive transport failures ⇒ OPEN 300s', () => {
  function breakerFixture() {
    const r = makeResolver({ ...REMOTE_CHAT });
    const clients = makeClientFactory();
    const { adapter, clock } = buildAdapter({ resolver: r, clients });
    return { adapter, clock, clients, r };
  }

  it('5 consecutive transport failures ⇒ OPEN; further calls short-circuit without touching the client', async () => {
    const { adapter } = breakerFixture();
    const client = await adapter.getRoleClient('chat');
    for (let i = 0; i < 5; i++) client.queue({ type: 'err', error: transportError() });

    for (let i = 0; i < 5; i++) {
      await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
        class: 'transport',
      });
    }
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({
      status: 'breaker_open',
      cooldownLeftS: 300,
    });

    // The 6th call fails fast: OPEN breaker, client NOT invoked.
    await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      class: 'transport',
    });
    expect(client.calls).toHaveLength(5);
  });

  it('cooldown expiry ⇒ half-open: ONE probe call; failure re-opens with a fresh cooldown, success closes', async () => {
    const { adapter, clock } = breakerFixture();
    const client = await adapter.getRoleClient('chat');
    for (let i = 0; i < 5; i++) client.queue({ type: 'err', error: transportError() });
    for (let i = 0; i < 5; i++) {
      await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toBeTruthy();
    }

    clock.advance(299_000);
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({
      status: 'breaker_open',
      cooldownLeftS: 1,
    });

    clock.advance(1_000);
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'half_open' });

    // The half-open probe call reaches the client; it fails ⇒ re-open, fresh 300s.
    client.queue({ type: 'err', error: transportError() });
    await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toBeTruthy();
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({
      status: 'breaker_open',
      cooldownLeftS: 300,
    });

    // Fresh cooldown expiry ⇒ half-open probe SUCCEEDS ⇒ closed again.
    clock.advance(300_000);
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'half_open' });
    client.queue({ type: 'ok', value: { text: 'ok' } });
    await expect(adapter.chat([{ role: 'user', content: 'x' }])).resolves.toBeTruthy();
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'ok' });
  });

  it('a success resets the consecutive-failure count (4 fails + 1 success + 1 fail ≠ OPEN)', async () => {
    const { adapter } = breakerFixture();
    const client = await adapter.getRoleClient('chat');
    for (let i = 0; i < 4; i++) client.queue({ type: 'err', error: transportError() });
    for (let i = 0; i < 4; i++) {
      await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toBeTruthy();
    }
    client.queue({ type: 'ok', value: { text: 'ok' } });
    await expect(adapter.chat([{ role: 'user', content: 'x' }])).resolves.toBeTruthy();

    client.queue({ type: 'err', error: transportError() });
    await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toBeTruthy();
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'ok' });
  });

  it('a config change (signature change) resets the breaker', async () => {
    const r = makeResolver({ ...REMOTE_CHAT });
    const { adapter } = buildAdapter({ resolver: r });
    const client = await adapter.getRoleClient('chat');
    for (let i = 0; i < 5; i++) client.queue({ type: 'err', error: transportError() });
    for (let i = 0; i < 5; i++) {
      await expect(adapter.chat([{ role: 'user', content: 'x' }])).rejects.toBeTruthy();
    }
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'breaker_open' });

    await r.set('LLM_CHAT_MODEL', 'gemma-4-12b-it-v2');
    await expect(adapter.breakerState('chat')).resolves.toMatchObject({ status: 'ok' });
  });
});

// ── budget chain + passive limiter (§2.5) ────────────────────────────────────

describe('budget chain (4 steps) + passive downward-only limiter', () => {
  it('order: admin cap beats published metadata beats preset default', () => {
    expect(resolveBudget({ adminCap: 1000, publishedMetadata: 2000, presetDefault: 3000 })).toEqual(
      {
        maxInputChars: 1000,
        source: 'admin',
      }
    );
    expect(resolveBudget({ adminCap: null, publishedMetadata: 2000, presetDefault: 3000 })).toEqual(
      {
        maxInputChars: 2000,
        source: 'metadata',
      }
    );
    expect(resolveBudget({ adminCap: null, publishedMetadata: null, presetDefault: 3000 })).toEqual(
      {
        maxInputChars: 3000,
        source: 'preset',
      }
    );
    expect(resolveBudget({ adminCap: null, publishedMetadata: null, presetDefault: null })).toEqual(
      {
        maxInputChars: null,
        source: 'limiter',
      }
    );
    // Non-positive / non-numeric admin values never win.
    expect(
      resolveBudget({ adminCap: 0, publishedMetadata: 2000, presetDefault: 3000 }).source
    ).toBe('metadata');
  });

  it('the limiter halves on a length-class failure and NEVER raises on success', () => {
    const limiter = createLimiter();
    expect(limiter.getBudget('embed')).toBeNull();
    expect(limiter.noteLengthFailure('embed', 12_000)).toBe(6000);
    expect(limiter.getBudget('embed')).toBe(6000);
    expect(limiter.noteLengthFailure('embed', 6000)).toBe(3000);
    limiter.noteSuccess('embed'); // must not raise
    expect(limiter.getBudget('embed')).toBe(3000);
  });

  it('a length-class embed failure halves the role budget from then on (downward-only)', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter } = buildAdapter({ resolver: r });
    const client = await adapter.getRoleClient('embed');
    const tooLong = new Error('input too long: 4096 tokens maximum');
    tooLong.status = 400;
    client.queue({ type: 'err', error: tooLong });

    await expect(adapter.embed(['a'.repeat(8000)])).rejects.toMatchObject({ class: 'length' });
    await expect(adapter.getBudget('embed')).resolves.toEqual({
      maxInputChars: 4000,
      source: 'limiter',
    });
  });
});

// ── usage accounting (§2.9 / aiUsageDailyStore) ──────────────────────────────

describe('usage accounting — counters move only on their events', () => {
  it('a successful embed round-trip increments calls + inputChars only', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, usage, clock } = buildAdapter({ resolver: r });
    const client = await adapter.getRoleClient('embed');
    client.queue({ type: 'ok', value: { vectors: [[1, 2]], dim: 2 } });

    await adapter.embed(['hello', 'world']);
    const day = new Date(clock.now()).toLocaleDateString('sv-SE');
    expect(usage.rows.get(`${day}|embed`)).toMatchObject({ calls: 1, inputChars: 10 });
  });

  it('a 429 bumps failed_429 (+calls); a transport failure bumps calls only', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, usage, clock } = buildAdapter({ resolver: r });
    const client = await adapter.getRoleClient('embed');
    const e429 = new Error('rate limited');
    e429.status = 429;
    client.queue({ type: 'err', error: e429 });
    await expect(adapter.embed(['x'])).rejects.toMatchObject({ class: 'rate' });

    const client2 = await adapter.getRoleClient('embed');
    client2.queue({ type: 'err', error: transportError() });
    await expect(adapter.embed(['x'])).rejects.toMatchObject({ class: 'transport' });

    const day = new Date(clock.now()).toLocaleDateString('sv-SE');
    expect(usage.rows.get(`${day}|embed`)).toMatchObject({ calls: 2, failed429: 1 });
    expect(usage.rows.get(`${day}|embed`).degraded).toBe(0);
  });
});

// ── daily caps (§2.5) ────────────────────────────────────────────────────────

describe('daily caps ⇒ budget_paused', () => {
  it('call cap reached ⇒ role paused, provider not invoked, no extra usage row', async () => {
    const r = makeResolver({ ...REMOTE_EMBED, LLM_DAILY_CALL_CAP: '2' });
    const { adapter, usage, clock } = buildAdapter({ resolver: r });
    const client = await adapter.getRoleClient('embed');
    client.queue({ type: 'ok', value: { vectors: [[1]], dim: 1 } });
    client.queue({ type: 'ok', value: { vectors: [[2]], dim: 1 } });

    await adapter.embed(['a']);
    await adapter.embed(['b']);
    const day = new Date(clock.now()).toLocaleDateString('sv-SE');
    expect(usage.rows.get(`${day}|embed`).calls).toBe(2);

    await expect(adapter.breakerState('embed')).resolves.toMatchObject({ status: 'budget_paused' });
    await expect(adapter.embed(['c'])).rejects.toMatchObject({ class: 'budget' });
    expect(client.calls).toHaveLength(2); // provider NOT invoked for the 3rd
    expect(usage.rows.get(`${day}|embed`).calls).toBe(2); // no round-trip happened
  });

  it('token cap is enforced against the input_chars-derived token estimate', async () => {
    // LLM_DAILY_TOKEN_CAP=100 tokens; charsPerToken 1.7 ⇒ ~170 chars budget.
    const r = makeResolver({ ...REMOTE_EMBED, LLM_DAILY_TOKEN_CAP: '100' });
    const { adapter } = buildAdapter({ resolver: r, deps: { charsPerToken: 1.7 } });
    const client = await adapter.getRoleClient('embed');
    client.queue({ type: 'ok', value: { vectors: [[1]], dim: 1 } });

    await adapter.embed(['a'.repeat(300)]); // ≈176 estimated tokens > 100 ⇒ pauses AFTER this trip

    await expect(adapter.breakerState('embed')).resolves.toMatchObject({ status: 'budget_paused' });
    client.queue({ type: 'ok', value: { vectors: [[2]], dim: 1 } });
    await expect(adapter.embed(['b'])).rejects.toMatchObject({ class: 'budget' });
    expect(client.calls).toHaveLength(1);
  });
});

// ── syncModelRegistry (§2.3 — NO dim column) ─────────────────────────────────

describe('syncModelRegistry', () => {
  it('upserts the active remote embed row; repeat calls map to the SAME id; never writes a dim', async () => {
    const r = makeResolver({ ...REMOTE_EMBED, LLM_MAX_INPUT_CHARS: '8000' });
    const { adapter, models } = buildAdapter({ resolver: r });

    const first = await adapter.syncModelRegistry();
    expect(first.rows).toBe(1);
    const row = await models.getActiveByRole('embed');
    expect(row).toMatchObject({
      role: 'embed',
      engine: 'remote',
      baseUrlKey: 'LLM_EMBED_BASE_URL',
      modelName: 'embeddinggemma-2',
      maxInputChars: 8000,
      chunkBudget: 4,
      enabled: true,
    });

    const second = await adapter.syncModelRegistry();
    const row2 = await models.getActiveByRole('embed');
    expect(row2.id).toBe(row.id);
    expect(second.rows).toBe(0); // idempotent — no new row

    for (const spec of models.specs) expect('dim' in spec).toBe(false);
  });

  it('the built-in embed provider lands as engine=embedded with the lock revision, baseUrlKey empty', async () => {
    const { adapter, models } = buildAdapter();
    await adapter.syncModelRegistry();
    const row = await models.getActiveByRole('embed');
    expect(row).toMatchObject({
      role: 'embed',
      engine: 'embedded',
      provider: 'embedded',
      baseUrlKey: '',
      modelName: 'embeddinggemma-2-ONNX',
      modelRevision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
      precision: 'q4',
      enabled: true,
    });
  });
});

// ── embed result shape (runtime dim, never llm_models) ───────────────────────

describe('embed result shape', () => {
  it('embed returns { vectors, dim, modelId } with the RUNTIME dim from the profile', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const preset = {
      family: 'llama.cpp',
      budgets: { maxInputCharsDefault: 12288, chunkBudget: 4, batchSize: 8 },
      profile: { dim: 768, chPerTok: 1.5 },
    };
    const { adapter, models } = buildAdapter({
      resolver: r,
      deps: { presetFor: () => preset },
    });

    // modelId comes from the registry sync (llm_models.id), not from dim math —
    // sync first, then embed.
    await adapter.syncModelRegistry();
    const active = await models.getActiveByRole('embed');

    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [new Array(768).fill(0.1), new Array(768).fill(0.2)], dim: 768 },
    });

    const out = await adapter.embed(['a', 'b']);
    expect(out.dim).toBe(768);
    expect(out.vectors).toHaveLength(2);
    expect(out.degraded).toBeUndefined();
    expect(out.modelId).toBe(active.id);
  });
});

// ── pure pieces sanity ───────────────────────────────────────────────────────

describe('error classification (§2.8)', () => {
  const { classifyLlmError } = require('../budget');

  it('classifies transport / rate / length / config / schema', () => {
    const t = transportError();
    expect(classifyLlmError(t).class).toBe('transport');
    expect(classifyLlmError({ status: 429, message: 'too many requests' }).class).toBe('rate');
    expect(
      classifyLlmError({ status: 400, message: "tried to process 'x' with 9000 tokens" }).class
    ).toBe('length');
    expect(classifyLlmError({ status: 401, message: 'unauthorized' }).class).toBe('config');
    expect(classifyLlmError(new SyntaxError('Unexpected token < in JSON')).class).toBe('schema');
    // Pre-classified errors are honored (adapter-thrown).
    const pre = new Error('breaker open');
    pre.class = 'transport';
    expect(classifyLlmError(pre).class).toBe('transport');
  });

  it('unclassified unknown errors default to transport (breaker-relevant, conservative)', () => {
    expect(classifyLlmError(new Error('weird')).class).toBe('transport');
    expect(classifyLlmError({ status: 500, message: 'boom' }).class).toBe('transport');
  });
});

// ── EG2 conformance activation gate + effective capabilities (§2.2/§2.4) ─────

describe('remote-embed EG2 conformance activation gate', () => {
  beforeEach(() => probeState.reset());

  it('same-space endpoint ⇒ configured; the kit runs ONCE per signature (no per-call probe)', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl },
    });

    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);

    expect(endpoint.calls).toHaveLength(1);
    expect(endpoint.calls[0].url).toBe('http://llama.local:8080/embeddings');
    expect(endpoint.calls[0].body.model).toBe('embeddinggemma-2');
    // The kit strings are sent in the profile's DOCUMENT space (the calibrated
    // space), one input per reference string.
    expect(endpoint.calls[0].body.input).toHaveLength(24);
    expect(endpoint.calls[0].body.input[0]).toBe(`title: none | text:${kit().strings[0]}`);
    expect(endpoint.calls[0].headers.authorization).toBe('Bearer sk-test');
    expect(healthReports.some((h) => h.key === 'ai.embed' && h.patch.ok === true)).toBe(true);
    expect(adapter.getEffectiveCapabilities().embed).toBe(true);

    // Cached by the resolved-config signature: repeated activation and the
    // call path reuse the verdict — never another provider round-trip.
    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);
    const embedClient = await adapter.getRoleClient('embed');
    embedClient.queue({
      type: 'ok',
      value: { vectors: [unitVectorAt(0), unitVectorAt(1)], dim: 768 },
    });
    await expect(adapter.probeRole('embed')).resolves.toMatchObject({ ok: true });
    expect(endpoint.calls).toHaveLength(1);
  });

  it('same-dim FOREIGN space ⇒ configured false, ai.embed probe_failed/nonConformingEndpoint, capability OFF', async () => {
    const endpoint = makeConformanceEndpoint('foreign');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl },
    });

    await expect(adapter.roleConfigured('embed')).resolves.toBe(false);
    // Fail closed on the call path too: the adapter never hands out a client
    // for a rejected endpoint (consumers park).
    await expect(adapter.getRoleClient('embed')).resolves.toBeNull();
    await expect(adapter.embed(['hello'])).rejects.toMatchObject({
      class: 'config',
      reason: 'not_configured',
    });

    const failure = healthReports.find((h) => h.key === 'ai.embed' && h.patch.ok === false);
    expect(failure.patch).toMatchObject({
      code: 'probe_failed',
      reason: 'nonConformingEndpoint',
      hint: 'serverErrors.ai.nonConformingEndpoint',
    });
    expect(adapter.getEffectiveCapabilities().embed).toBe(false);
    expect(endpoint.calls).toHaveLength(1);
  });

  it('wrong-dim endpoint ⇒ configured false with the structural reason', async () => {
    const endpoint = makeConformanceEndpoint('wrongDim');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl },
    });

    await expect(adapter.roleConfigured('embed')).resolves.toBe(false);
    const failure = healthReports.find((h) => h.key === 'ai.embed' && h.patch.ok === false);
    expect(failure.patch).toMatchObject({ code: 'probe_failed', reason: 'wrongDim' });
  });

  it('exactly ONE re-probe per config change (a new signature invalidates the cached verdict)', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, timers, clock } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl },
    });

    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);
    expect(endpoint.calls).toHaveLength(1);

    // The endpoint changes identity together with the config signature: the
    // new signature is probed exactly once and the verdict flips.
    endpoint.setMode('foreign');
    await r.set('LLM_EMBED_MODEL', 'embeddinggemma-2-v2');
    await expect(adapter.roleConfigured('embed')).resolves.toBe(false);
    expect(endpoint.calls).toHaveLength(2);

    // Repeat activation on the same signature: cached, no extra round-trip.
    await expect(adapter.roleConfigured('embed')).resolves.toBe(false);
    expect(endpoint.calls).toHaveLength(2);

    // The debounced re-probe rides the same cached verdict.
    clock.advance(60_000);
    timers.fireDue();
    await flushAsync();
    expect(endpoint.calls).toHaveLength(2);
  });

  it('the built-in embedded engine is exempt: configured with zero conformance calls', async () => {
    const endpoint = makeConformanceEndpoint('foreign');
    const { adapter } = buildAdapter({ deps: { fetchImpl: endpoint.fetchImpl } });

    await expect(adapter.roleConfigured('embed')).resolves.toBe(true);
    await expect(adapter.getRoleClient('embed')).resolves.not.toBeNull();
    expect(endpoint.calls).toHaveLength(0);
  });
});

// ── embed text probe completeness + partial admin state (C3-A/C4-A) ──────────

describe('embed text probe completeness', () => {
  beforeEach(() => probeState.reset());

  const capability = (name) =>
    probeState.getCapabilityEntries().find((entry) => entry.capability === name);

  function withProps(endpoint, pooling) {
    return async (url, init) => {
      if (String(url).endsWith('/props')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { pooling };
          },
        };
      }
      return endpoint.fetchImpl(url, init);
    };
  }

  it('healthy remote endpoint passes: non-empty, profile dim, distinct samples ⇒ text_embed ON', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: {
        fetchImpl: withProps(endpoint, 'mean'),
        presetFor: () => EMBED_PRESET,
      },
    });
    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [unitVectorAt(0), unitVectorAt(2)], dim: 768 },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({ ok: true, reason: null });
    expect(capability('text_embed')).toMatchObject({ enabled: true, reason: null });
    expect(
      healthReports.some((h) => h.key === 'ai.embed' && h.patch.ok === true && !h.patch.hint)
    ).toBe(true);

    // Activation-time only: the cached verdict is reused, never re-embedded.
    const textProbeCalls = client.calls.filter((call) => call.method === 'embed').length;
    expect(textProbeCalls).toBe(1);
    await adapter.probeRole('embed');
    await adapter.roleConfigured('embed');
    expect(client.calls.filter((call) => call.method === 'embed')).toHaveLength(textProbeCalls);
  });

  it('constant-output endpoint ⇒ degenerateEmbedding, text_embed OFF + ai.embed failure', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl, presetFor: () => EMBED_PRESET },
    });
    const client = await adapter.getRoleClient('embed');
    const constant = unitVectorAt(0);
    client.queue({ type: 'ok', value: { vectors: [constant, constant], dim: 768 } });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({
      ok: false,
      reason: 'degenerateEmbedding',
    });
    expect(capability('text_embed')).toMatchObject({
      enabled: false,
      reason: 'degenerateEmbedding',
    });
    expect(healthReports.find((h) => h.key === 'ai.embed' && h.patch.ok === false).patch).toMatchObject(
      { code: 'probe_failed', reason: 'degenerateEmbedding' }
    );
  });

  it('wrong runtime dim (512 vs profile 768) ⇒ wrongDim, text_embed OFF', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter } = buildAdapter({
      resolver: r,
      deps: { fetchImpl: endpoint.fetchImpl, presetFor: () => EMBED_PRESET },
    });
    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [new Array(512).fill(0.1), new Array(512).fill(0.2)], dim: 512 },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({
      ok: false,
      reason: 'wrongDim',
    });
    expect(capability('text_embed')).toMatchObject({ enabled: false, reason: 'wrongDim' });
  });

  it('server pooling mismatch vs profile ⇒ poolingMismatch, text_embed OFF', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter } = buildAdapter({
      resolver: r,
      deps: {
        fetchImpl: withProps(endpoint, 'cls'),
        presetFor: () => EMBED_PRESET,
      },
    });
    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [unitVectorAt(0), unitVectorAt(3)], dim: 768 },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({
      ok: false,
      reason: 'poolingMismatch',
    });
    expect(capability('text_embed')).toMatchObject({
      enabled: false,
      reason: 'poolingMismatch',
    });
  });

  it('built-in positive-control failure ⇒ positiveControlFailed, text_embed OFF + admin reason', async () => {
    const { adapter, healthReports } = buildAdapter({
      deps: {
        embeddedPositiveControl: async () => ({ median: 0.2, min: 0.1, dim: 768 }),
      },
    });
    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [unitVectorAt(0), unitVectorAt(1)], dim: 768 },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({
      ok: false,
      reason: 'positiveControlFailed',
    });
    expect(capability('text_embed')).toMatchObject({
      enabled: false,
      reason: 'positiveControlFailed',
    });
    expect(healthReports.find((h) => h.key === 'ai.embed' && h.patch.ok === false).patch).toMatchObject(
      { code: 'probe_failed', reason: 'positiveControlFailed' }
    );
  });

  it('built-in healthy positive control passes text_embed', async () => {
    const { adapter } = buildAdapter();
    const client = await adapter.getRoleClient('embed');
    client.queue({
      type: 'ok',
      value: { vectors: [unitVectorAt(0), unitVectorAt(1)], dim: 768 },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({ ok: true });
    expect(capability('text_embed')).toMatchObject({ enabled: true, reason: null });
  });

  it('failed embed MEDIA with text_embed passing ⇒ ai.embed ok + hint (admin partial)', async () => {
    const endpoint = makeConformanceEndpoint('conforming');
    const r = makeResolver({ ...REMOTE_EMBED });
    const mediaFailingClients = {
      created: [],
      createClient(spec) {
        const client = {
          spec,
          calls: [],
          async embed(texts) {
            this.calls.push({ method: 'embed', texts });
            return { vectors: [unitVectorAt(0), unitVectorAt(4)], dim: 768 };
          },
          async embedQuery() {
            return { vectors: [unitVectorAt(0)], dim: 768 };
          },
          async embedMedia() {
            throw Object.assign(new Error('media silently dropped'), {
              class: 'config',
              reason: 'media_dropped',
            });
          },
        };
        this.created.push(client);
        return client;
      },
    };
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      clients: mediaFailingClients,
      deps: { fetchImpl: endpoint.fetchImpl, presetFor: () => EMBED_PRESET },
    });

    await expect(adapter.probeRole('embed')).resolves.toMatchObject({ ok: true });
    expect(capability('text_embed')).toMatchObject({ enabled: true });
    expect(capability('image_embed')).toMatchObject({ enabled: false });
    const partial = healthReports.find(
      (h) => h.key === 'ai.embed' && h.patch.ok === true && h.patch.hint
    );
    expect(partial.patch).toMatchObject({
      ok: true,
      hint: 'serverErrors.ai.providerProbeFailed',
    });
  });
});

// ── hot embed registry sync + vector reset (C6) ──────────────────────────────

describe('hot embed registry sync', () => {
  it('a hot embed config change updates the registry/modelId and resets the vector store once', async () => {
    const r = makeResolver({ ...REMOTE_EMBED });
    const { adapter, models } = buildAdapter({ resolver: r });
    const reset = jest.spyOn(vectorRuntime, 'resetVectorStore').mockImplementation(() => {});
    try {
      // Boot sync + initial observation (the boot probe primes the signature).
      await adapter.syncModelRegistry();
      await adapter.getRoleClient('embed');
      const before = await models.getActiveByRole('embed');
      expect(before).toMatchObject({ modelName: 'embeddinggemma-2' });
      reset.mockClear();

      // Hot config change: the client rebuild must ALSO re-sync the embed row.
      await r.set('LLM_EMBED_MODEL', 'embeddinggemma-2-v2');
      const client = await adapter.getRoleClient('embed');
      const after = await models.getActiveByRole('embed');
      expect(after.id).not.toBe(before.id);
      expect(after).toMatchObject({
        role: 'embed',
        engine: 'remote',
        modelName: 'embeddinggemma-2-v2',
        enabled: true,
      });
      expect(reset).toHaveBeenCalledTimes(1);

      client.queue({ type: 'ok', value: { vectors: [unitVectorAt(0)], dim: 768 } });
      await expect(adapter.embed(['hello'])).resolves.toMatchObject({ modelId: after.id });

      // Same signature again: no double sync / no second reset.
      await adapter.getRoleClient('embed');
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      reset.mockRestore();
    }
  });
});

describe('capability matrix runtime authority (declared ≠ probed)', () => {
  beforeEach(() => probeState.reset());

  it('a declared chat role whose probe fails ⇒ chat capability OFF + ai.chat warning hint', async () => {
    const r = makeResolver({ ...REMOTE_CHAT });
    const preset = {
      id: 'gemma-4-12b-it',
      expected: { chat: true, vision_chat: true, asr: true },
    };
    const { adapter, healthReports } = buildAdapter({
      resolver: r,
      deps: {
        presetFor: () => preset,
        probeRole: async ({ role }) => ({ ok: false, role, reason: 'schema: not JSON' }),
      },
    });

    await expect(adapter.probeRole('chat')).resolves.toMatchObject({ ok: false });

    expect(adapter.getEffectiveCapabilities().chat).toBe(false);
    const warning = probeState.listWarnings().find((w) => w.role === 'chat');
    expect(warning).toMatchObject({
      capability: 'chat',
      code: 'probe_failed',
      hint: 'serverErrors.ai.providerProbeFailed',
    });
    const failure = healthReports.find((h) => h.key === 'ai.chat' && h.patch.ok === false);
    expect(failure.patch).toMatchObject({ code: 'probe_failed' });
  });

  it('a passing probe turns the capability ON (undeclared-but-probed is authority too)', async () => {
    const r = makeResolver({ ...REMOTE_CHAT });
    const preset = {
      id: 'gemma-4-12b-it',
      expected: { chat: true, vision_chat: true, asr: true },
    };
    const { adapter } = buildAdapter({
      resolver: r,
      deps: {
        presetFor: () => preset,
        probeRole: async ({ role }) => ({ ok: true, role, reason: null }),
      },
    });

    await expect(adapter.probeRole('chat')).resolves.toMatchObject({ ok: true });
    expect(adapter.getEffectiveCapabilities().chat).toBe(true);
    expect(probeState.listWarnings().find((w) => w.role === 'chat')).toBeUndefined();
  });

  it('probeConfiguredRoles probes configured roles only and publishes each outcome', async () => {
    const r = makeResolver({ ...REMOTE_CHAT });
    const probed = [];
    const { adapter } = buildAdapter({
      resolver: r,
      deps: {
        presetFor: (role) => ({ expected: { [role === 'chat' ? 'chat' : role]: true } }),
        probeRole: async ({ role }) => {
          probed.push(role);
          return {
            ok: role === 'chat',
            role,
            reason: role === 'chat' ? null : 'mediaProbePending',
          };
        },
      },
    });

    const outcomes = await adapter.probeConfiguredRoles();
    expect(probed).toEqual(['chat']); // embed/vision/asr resolve no config here
    expect(outcomes.chat).toMatchObject({ ok: true });
    expect(adapter.getEffectiveCapabilities()).toMatchObject({
      embed: expect.any(Boolean),
      chat: true,
      vision: expect.any(Boolean),
      asr: expect.any(Boolean),
    });
  });

  it('an unconfigured role carries no capability (no probe, no warning)', async () => {
    const { adapter } = buildAdapter();
    const outcomes = await adapter.probeConfiguredRoles();
    expect(outcomes.chat).toBeUndefined();
    expect(adapter.getEffectiveCapabilities().chat).toBe(false);
    expect(probeState.listWarnings()).toHaveLength(0);
  });
});
