/**
 * searchService unit tests (P0 name section; domain object + thrown bare codes).
 * @see docs/spec/server/services/searchService.md
 */
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbQuery,
} = require('@server/test-utils');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const permissionStore = require('@server/store/permissionStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const { createSearchService } = require('../searchService');
const { initVectorStore, resetVectorStore, getVectorStore } = require('../vectorStoreRuntime');
const { createResultRefRegistry } = require('../resultRefRegistry');

let dbCleanup;
let fileNodeService;

/** Flush the fire-and-forget usage-event writes before asserting on the DB. */
async function flushUsageEvents() {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
});

afterAll(async () => {
  await dbCleanup?.();
});

async function createUserWithRoot() {
  const { user, token } = await createAuthenticatedTestUser({
    username: `svcsearch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
}

// Fake usage service recording in-memory — DI seam for the recording contract.
function createUsageServiceFake() {
  const events = [];
  return {
    events,
    recordEvent: jest.fn(async (event) => {
      events.push(event);
      return { changes: 1 };
    }),
  };
}

// ---------------------------------------------------------------------------
// C1 fake seams (semantic leg)
// ---------------------------------------------------------------------------

/** Fake llmAdapter: roleConfigured('embed') true, deterministic embedQuery. */
function createFakeEmbedAdapter({ modelId = 7, dim = 4, vectorFor, failing = false } = {}) {
  const calls = [];
  return {
    calls,
    roleConfigured: async (role) => role === 'embed',
    embedQuery: async (text) => {
      if (failing) throw new Error('provider unavailable');
      calls.push(text);
      const v = vectorFor ? vectorFor(text) : [1, 0, 0, 0];
      return { vectors: [v], dim, modelId };
    },
  };
}

/** No-op config resolver: every key falls back to its shipped default. */
const defaultConfigResolver = { getConfig: async () => undefined };

/**
 * C1 service factory: the query_parses store stays REAL (exercises the
 * repository + facade over the active sqlite test backend); every other new
 * seam is injected.
 */
function createC1Service({
  adapter,
  configResolver = defaultConfigResolver,
  llmModelsStore = { getActiveByRole: async () => ({ id: 7 }) },
  provisioner = { loadLock: () => ({ repo: 'org/embed-model', revision: 'rev-1' }) },
  semanticScorer,
  queryParsesStore,
  usageService,
} = {}) {
  return createSearchService({
    usageService: usageService || createUsageServiceFake(),
    configResolver,
    llmAdapter: adapter,
    llmModelsStore,
    provisioner,
    semanticScorer,
    ...(queryParsesStore ? { queryParsesStore } : {}),
  });
}

// ---------------------------------------------------------------------------
// Validation + thrown codes
// ---------------------------------------------------------------------------

describe('searchService validation', () => {
  it('throws the bare queryRequired code for missing/empty/whitespace queries', async () => {
    const service = createSearchService({ usageService: createUsageServiceFake() });
    await expect(service.search(1, {})).rejects.toMatchObject({ message: 'queryRequired' });
    await expect(service.search(1, { query: '' })).rejects.toMatchObject({
      message: 'queryRequired',
    });
    await expect(service.search(1, { query: '   ' })).rejects.toMatchObject({
      message: 'queryRequired',
    });
  });

  it('throws the bare queryTooLong code beyond 200 chars (measured after trim)', async () => {
    const service = createSearchService({ usageService: createUsageServiceFake() });
    await expect(service.search(1, { query: 'a'.repeat(201) })).rejects.toMatchObject({
      message: 'queryTooLong',
    });
    await expect(service.search(1, { query: `${'a'.repeat(200)} ` })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Domain object shape (embed-absent degrade contract)
// ---------------------------------------------------------------------------

describe('searchService response shape', () => {
  it('returns the domain object with an always-absent semantic leg (P0)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'shape-notes.md');
    const service = createSearchService({ usageService: createUsageServiceFake() });

    const result = await service.search(ctx.user.id, { query: 'shape' });

    expect(result.nameMatches).toEqual([
      expect.objectContaining({ nodeId: expect.any(Number), name: 'shape-notes.md' }),
    ]);
    expect(result.counts).toEqual({ name: 1, semantic: 0, total: 1, nameTruncated: false });
    expect(result.semanticUnavailableReason).toBe('not_configured');
  });

  it('maps repository rows to { nodeId, name } only (no type/size leakage)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'rowshape.txt');
    const service = createSearchService({ usageService: createUsageServiceFake() });

    const result = await service.search(ctx.user.id, { query: 'rowshape' });

    expect(Object.keys(result.nameMatches[0]).sort()).toEqual(['name', 'nodeId']);
  });
});

// ---------------------------------------------------------------------------
// Signature (result_ref) construction
// ---------------------------------------------------------------------------

describe('searchService result_ref', () => {
  it('emits "sr1." + 16 hex chars deterministic per normalized query', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'sig.txt');
    const service = createSearchService({ usageService: createUsageServiceFake() });

    const first = await service.search(ctx.user.id, { query: 'sig' });
    const second = await service.search(ctx.user.id, { query: 'sig' });

    expect(first.resultRef).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(second.resultRef).toBe(first.resultRef);
  });

  it('normalizes NFKC/case/whitespace before signing; a different query signs differently', async () => {
    const service = createSearchService({ usageService: createUsageServiceFake() });
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'signorm.txt');

    const spaced = await service.search(ctx.user.id, { query: '  Si   gn  ' });
    const tight = await service.search(ctx.user.id, { query: 'si gn' });
    const other = await service.search(ctx.user.id, { query: 'gn si' });

    expect(spaced.resultRef).toBe(tight.resultRef);
    expect(other.resultRef).not.toBe(tight.resultRef);
  });

  it('accepts a resultRef input and provably ignores it', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'sigignore.txt');
    const service = createSearchService({ usageService: createUsageServiceFake() });

    const plain = await service.search(ctx.user.id, { query: 'sigignore' });
    const withRef = await service.search(ctx.user.id, {
      query: 'sigignore',
      resultRef: 'sr1.cafecafecafecafe',
    });

    expect(withRef.resultRef).toBe(plain.resultRef);
    expect(withRef).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// Name cap + usage recording
// ---------------------------------------------------------------------------

describe('searchService cap + recording', () => {
  it('caps the name section at the configured limit and flags nameTruncated', async () => {
    const ctx = await createUserWithRoot();
    for (let i = 0; i < 201; i += 1) {
      await fileNodeService.createFile(ctx.root.id, `cap-note-${String(i).padStart(3, '0')}.txt`);
    }

    const usageService = createUsageServiceFake();
    const service = createSearchService({ usageService });

    const result = await service.search(ctx.user.id, { query: 'cap-note' });

    expect(result.nameMatches).toHaveLength(200);
    expect(result.counts.nameTruncated).toBe(true);
    expect(result.counts.name).toBe(200);
    expect(result.counts.total).toBe(200);

    // Only RETURNED rows get usage rows (the truncated tail must not).
    await flushUsageEvents();
    const recorded = usageService.recordEvent.mock.calls.map((c) => c[0]);
    expect(recorded).toHaveLength(200);
    expect(new Set(recorded.map((e) => e.nodeId)).size).toBe(200);
    expect(recorded.every((e) => e.action === 'search_hit' && e.userId === ctx.user.id)).toBe(true);
  }, 30000);

  it('records one search_hit event per returned node through the default store path', async () => {
    const ctx = await createUserWithRoot();
    const a = await fileNodeService.createFile(ctx.root.id, 'store-alpha.txt');
    const b = await fileNodeService.createFile(ctx.root.id, 'store-beta.txt');
    // Default DI: the shared usageService writes real usage_events rows.
    const service = createSearchService();

    await service.search(ctx.user.id, { query: 'store-' });
    await flushUsageEvents();

    const { rows: events } = await dbQuery(
      'SELECT node_id FROM usage_events WHERE user_id = ? AND action = ?',
      [ctx.user.id, 'search_hit']
    );
    expect(events.map((row) => Number(row.node_id)).sort((x, y) => x - y)).toEqual(
      [a.id, b.id].sort((x, y) => x - y)
    );
  });
});

// ---------------------------------------------------------------------------
// Semantic leg — honest degrade matrix (embed gate / kill switch / provider)
// ---------------------------------------------------------------------------

describe('searchService semantic leg — degrade matrix', () => {
  it('embed configured with NO scorer ⇒ HONESTLY EMPTY: semantic present, available true, no reason', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'honest-empty.txt');
    const service = createC1Service({ adapter: createFakeEmbedAdapter() });

    const result = await service.search(ctx.user.id, { query: 'unfindable phrase' });

    expect(result.semantic).toEqual([]);
    expect(result.semanticUnavailableReason).toBeUndefined();
    expect(result.counts).toEqual({
      name: 0,
      semantic: 0,
      total: 0,
      nameTruncated: false,
      semanticCappedSegments: false,
    });
  });

  it('embed ABSENT keeps the omit shape: no semantic key, reason set (absent ≠ honestly empty)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'absent-leg.txt');
    const service = createC1Service({ adapter: null });

    const result = await service.search(ctx.user.id, { query: 'absent' });

    expect(result.semantic).toBeUndefined();
    expect(result.semanticUnavailableReason).toBe('not_configured');
    expect(result.counts.semanticCappedSegments).toBeUndefined();
  });

  it('kill switch off ⇒ identical to the unconfigured omit shape', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'killed-leg.txt');
    const service = createC1Service({
      adapter: createFakeEmbedAdapter(),
      configResolver: {
        getConfig: async (key) => (key === 'AI_SEMANTIC_SEARCH_ENABLED' ? 'false' : undefined),
      },
    });

    const result = await service.search(ctx.user.id, { query: 'killed' });

    expect(result.semantic).toBeUndefined();
    expect(result.semanticUnavailableReason).toBe('disabled');
  });

  it.each([
    ['preparing', 'preparing'],
    ['non_conforming', 'non_conforming'],
    ['provisioning_failed', 'provisioning_failed'],
    ['probe_failed', 'probe_failed'],
  ])('surfaces the adapter readiness reason %s on the omit shape', async (reason) => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, `readiness-${reason}.txt`);
    const service = createC1Service({
      adapter: {
        getRoleReadiness: async () => ({ configured: false, reason }),
        embedQuery: async () => ({ vectors: [[1, 0, 0, 0]], dim: 4, modelId: 7 }),
      },
    });

    const result = await service.search(ctx.user.id, { query: reason });

    expect(result.semantic).toBeUndefined();
    expect(result.semanticUnavailableReason).toBe(reason);
  });

  it('provider failure with the role configured ⇒ honest empty (available true), name intact, no throw', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'degraded-provider.txt');
    const service = createC1Service({ adapter: createFakeEmbedAdapter({ failing: true }) });

    const result = await service.search(ctx.user.id, { query: 'degraded' });

    expect(result.nameMatches).toHaveLength(1);
    expect(result.semantic).toEqual([]);
    expect(result.counts.total).toBe(1);
    expect(result.counts.semantic).toBe(0);
  });

  it('mid-switch (embed call reports a different model id than the registry row) ⇒ honest empty', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'midswitch.txt');
    const service = createC1Service({
      adapter: createFakeEmbedAdapter({ modelId: 8 }),
      llmModelsStore: { getActiveByRole: async () => ({ id: 7 }) },
    });

    const result = await service.search(ctx.user.id, { query: 'midswitch phrase' });

    expect(result.semantic).toEqual([]);
  });

  it('typed-array adapter vectors (Float32Array) are normalized into the cache envelope', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'typed-vec.txt');
    const f32 = new Float32Array([1, 0, 0, 0]);
    const adapter = {
      roleConfigured: async (role) => role === 'embed',
      embedQuery: async () => ({ vectors: [f32], dim: 4, modelId: 7 }),
    };
    const service = createC1Service({ adapter });

    await service.search(ctx.user.id, { query: 'typed' });
    const { rows } = await dbQuery('SELECT vector FROM query_parses WHERE normalized_query = ?', [
      'typed',
    ]);
    const envelope = JSON.parse(rows[0].vector);
    expect(envelope.v).toEqual([1, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Semantic leg — query_parses cache (get-or-embed)
// ---------------------------------------------------------------------------

describe('searchService semantic leg — query_parses cache', () => {
  it('first search embeds query + segments; the SECOND identical search makes ZERO provider calls', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'cache-notes.txt');
    const adapter = createFakeEmbedAdapter();
    const service = createC1Service({ adapter });

    await service.search(ctx.user.id, { query: 'cache notes' });
    // full normalized query + 2 segments — 3 distinct texts
    expect(adapter.calls.sort()).toEqual(['cache', 'cache notes', 'notes']);

    await service.search(ctx.user.id, { query: '  CACHE   notes ' });
    expect(adapter.calls.sort()).toEqual(['cache', 'cache notes', 'notes']);

    const { rows } = await dbQuery(
      `SELECT normalized_query, hit_count FROM query_parses
        WHERE normalized_query IN ('cache', 'cache notes', 'notes')
        ORDER BY normalized_query`
    );
    expect(rows.map((r) => [r.normalized_query, Number(r.hit_count)])).toEqual([
      ['cache', 1],
      ['cache notes', 1],
      ['notes', 1],
    ]);
  });

  it('a single-word query shares ONE cache row between the query and its segment', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'solo-word.txt');
    const adapter = createFakeEmbedAdapter();
    const service = createC1Service({ adapter });

    await service.search(ctx.user.id, { query: 'solo' });

    expect(adapter.calls).toEqual(['solo']);
    const { rows } = await dbQuery(
      "SELECT hit_count FROM query_parses WHERE normalized_query = 'solo'"
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].hit_count)).toBe(0);
  });

  it('a cached envelope from a DIFFERENT space is a MISS: re-embed and overwrite the vector', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'space-shift.txt');
    const adapterA = createFakeEmbedAdapter({ modelId: 7 });
    const serviceA = createC1Service({
      adapter: adapterA,
      llmModelsStore: { getActiveByRole: async () => ({ id: 7 }) },
    });
    await serviceA.search(ctx.user.id, { query: 'space shift' });

    const adapterB = createFakeEmbedAdapter({ modelId: 9, vectorFor: () => [0, 1, 0, 0] });
    const serviceB = createC1Service({
      adapter: adapterB,
      llmModelsStore: { getActiveByRole: async () => ({ id: 9 }) },
    });
    await serviceB.search(ctx.user.id, { query: 'space shift' });

    // The model change MUST re-embed (the old space's vector is not reused).
    expect(adapterB.calls.sort()).toEqual(['shift', 'space', 'space shift']);
    const { rows } = await dbQuery('SELECT vector FROM query_parses WHERE normalized_query = ?', [
      'space shift',
    ]);
    const envelope = JSON.parse(rows[0].vector);
    expect(envelope.space).toBe('v1|model:9');
    expect(envelope.v).toEqual([0, 1, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Semantic leg — segments, signature, scorer seam, assembly
// ---------------------------------------------------------------------------

describe('searchService semantic leg — segments + signature', () => {
  it('flags semanticCappedSegments for a 4-word query and embeds only the first 3 segments', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'cap-seg.txt');
    const adapter = createFakeEmbedAdapter();
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'alpha beta gamma delta' });

    expect(adapter.calls.sort()).toEqual(['alpha', 'alpha beta gamma delta', 'beta', 'gamma']);
    expect(result.counts.semanticCappedSegments).toBe(true);
  });

  it('keeps semanticCappedSegments false for ≤3 segments', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nocap-seg.txt');
    const service = createC1Service({ adapter: createFakeEmbedAdapter() });

    const result = await service.search(ctx.user.id, { query: 'one two' });

    expect(result.counts.semanticCappedSegments).toBe(false);
  });

  it('signs the space with the embed model identity; byte-identical repeats, model change flips the ref', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'sig-space.txt');
    const serviceA = createC1Service({
      adapter: createFakeEmbedAdapter({ modelId: 7 }),
      llmModelsStore: { getActiveByRole: async () => ({ id: 7 }) },
    });
    const first = await serviceA.search(ctx.user.id, { query: 'sig space' });
    const second = await serviceA.search(ctx.user.id, { query: 'sig space' });

    expect(first.resultRef).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(second.resultRef).toBe(first.resultRef);

    const serviceB = createC1Service({
      adapter: createFakeEmbedAdapter({ modelId: 8 }),
      llmModelsStore: { getActiveByRole: async () => ({ id: 8 }) },
    });
    const other = await serviceB.search(ctx.user.id, { query: 'sig space' });
    expect(other.resultRef).not.toBe(first.resultRef);
  });

  it('falls back to the embedded lock identity (repo@revision) when no registry row exists', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'lock-fallback.txt');
    const adapter = createFakeEmbedAdapter({ modelId: null });
    const service = createC1Service({
      adapter,
      llmModelsStore: { getActiveByRole: async () => null },
      provisioner: { loadLock: () => ({ repo: 'org/embed-model', revision: 'rev-1' }) },
    });

    const result = await service.search(ctx.user.id, { query: 'lock fallback' });

    // The envelope space records the lock identity; the same inputs re-sign identically.
    const { rows } = await dbQuery('SELECT vector FROM query_parses WHERE normalized_query = ?', [
      'lock fallback',
    ]);
    const envelope = JSON.parse(rows[0].vector);
    expect(envelope.space).toBe('v1|model:org/embed-model@rev-1');
    const again = await createC1Service({
      adapter,
      llmModelsStore: { getActiveByRole: async () => null },
      provisioner: { loadLock: () => ({ repo: 'org/embed-model', revision: 'rev-1' }) },
    }).search(ctx.user.id, { query: 'lock fallback' });
    expect(again.resultRef).toBe(result.resultRef);
  });
});

describe('searchService semantic leg — scorer seam + assembly', () => {
  it('invokes the injected scorer with the cached vectors and assembles order, dedup, cap and usage', async () => {
    const ctx = await createUserWithRoot();
    const nameMatched = await fileNodeService.createFile(ctx.root.id, 'vec-matched.txt');
    const a = await fileNodeService.createFile(ctx.root.id, 'red-file.txt');
    const b = await fileNodeService.createFile(ctx.root.id, 'blue-file.txt');
    const c = await fileNodeService.createFile(ctx.root.id, 'green-file.txt');
    const d = await fileNodeService.createFile(ctx.root.id, 'gold-file.txt');
    const usageService = createUsageServiceFake();

    const scorer = jest.fn(async ({ userId, queryVec, segmentVecs, sampleFn }) => {
      expect(userId).toBe(ctx.user.id);
      expect(Array.isArray(queryVec)).toBe(true);
      expect(segmentVecs).toHaveLength(1);
      // sampleFn is the visible-corpus sample seam — must be callable.
      const sample = await sampleFn(10);
      expect(Array.isArray(sample)).toBe(true);
      return [
        { nodeId: nameMatched.id, score: 0.99 }, // deduped away (already in name_matches)
        { nodeId: a.id, score: 0.9 },
        { nodeId: c.id, score: 0.9 },
        { nodeId: b.id, score: 0.5 },
        { nodeId: d.id, score: 0.4 },
      ];
    });

    const service = createC1Service({
      adapter: createFakeEmbedAdapter(),
      semanticScorer: scorer,
      configResolver: {
        getConfig: async (key) => (key === 'SEARCH_SEMANTIC_LIMIT' ? 2 : undefined),
      },
      usageService,
    });

    const result = await service.search(ctx.user.id, { query: 'vec' });

    expect(result.nameMatches).toEqual([
      expect.objectContaining({ nodeId: nameMatched.id, name: 'vec-matched.txt' }),
    ]);
    // Order score desc then node_id asc, cap 2 AFTER dedup.
    expect(result.semantic).toEqual([
      { nodeId: a.id, name: 'red-file.txt', score: 0.9 },
      { nodeId: c.id, name: 'green-file.txt', score: 0.9 },
    ]);
    expect(result.counts).toEqual({
      name: 1,
      semantic: 2,
      total: 3,
      nameTruncated: false,
      semanticCappedSegments: false,
    });

    await flushUsageEvents();
    const recorded = usageService.recordEvent.mock.calls.map((c) => c[0]);
    const semanticHits = recorded.filter((e) => [a.id, c.id].includes(e.nodeId));
    expect(semanticHits).toHaveLength(2);
    expect(semanticHits.every((e) => e.action === 'search_hit' && e.userId === ctx.user.id)).toBe(
      true
    );
    // The deduplicated-away and capped-away rows never get usage rows.
    expect(recorded.filter((e) => e.nodeId === b.id || e.nodeId === d.id)).toHaveLength(0);
  });

  it('a scorer throw degrades the section honestly (never a 5xx path)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'scorer-boom.txt');
    const service = createC1Service({
      adapter: createFakeEmbedAdapter(),
      semanticScorer: async () => {
        throw new Error('scorer exploded');
      },
    });

    const result = await service.search(ctx.user.id, { query: 'boom' });

    expect(result.semantic).toEqual([]);
    expect(result.counts.semantic).toBe(0);
  });
});

describe('searchService semantic leg — production scorer BASELINE_SAMPLE_DOCS', () => {
  it('applies a changed config value to the NEXT search without a restart', async () => {
    const ctx = await createUserWithRoot();
    const doc = await fileNodeService.createFile(
      ctx.root.id,
      `hot-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
    );
    const config = { BASELINE_SAMPLE_DOCS: '3' };

    const { id: modelId } = await llmModelsStore.upsertModel({
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'embeddinggemma-2-ONNX',
      modelRevision: null,
      precision: 'q4',
      maxInputChars: 8192,
      chunkBudget: 4,
      batchSize: 8,
      enabled: true,
    });
    await embeddingsStore.upsert(Number(doc.id), {
      modelId: Number(modelId),
      dim: 4,
      vector: [1, 0, 0, 0],
      source: 'head',
      contentHash: `hot-baseline-${Date.now()}`,
    });

    // The default (production) scorer is constructed once; only the config
    // value changes between the two searches. The sample cap is observed
    // through the store seam the service hands to the scorer.
    const realStore = createFileNodesStore();
    const sampleCaps = [];
    const fileNodesStore = {
      ...realStore,
      sampleVisibleNodeIds: jest.fn(async (userId, n) => {
        sampleCaps.push(Number(n));
        return realStore.sampleVisibleNodeIds(userId, n);
      }),
    };

    try {
      const service = createSearchService({
        usageService: createUsageServiceFake(),
        configResolver: {
          getConfig: async (key) =>
            key === 'BASELINE_SAMPLE_DOCS' ? config.BASELINE_SAMPLE_DOCS : undefined,
        },
        llmAdapter: createFakeEmbedAdapter({ modelId: Number(modelId), dim: 4 }),
        llmModelsStore,
        fileNodesStore,
      });

      const first = await service.search(ctx.user.id, { query: 'hot baseline alpha' });
      expect(first.counts.semantic).toBe(1);

      config.BASELINE_SAMPLE_DOCS = '9';
      const second = await service.search(ctx.user.id, { query: 'hot baseline beta' });
      expect(second.counts.semantic).toBe(1);

      expect(sampleCaps).toEqual([3, 9]);
    } finally {
      await dbQuery('DELETE FROM embeddings', []);
      await dbQuery("DELETE FROM llm_models WHERE role = 'embed'", []);
    }
  });
});

// ---------------------------------------------------------------------------
// C6: the production scorer reads the boot-selected vectorStore engine
// ---------------------------------------------------------------------------

describe('searchService default scorer — vectorStore engine factory', () => {
  afterEach(() => {
    resetVectorStore();
  });

  it('passes the runtime engine factory into the default scorer and uses its neighbors', async () => {
    const ctx = await createUserWithRoot();
    const file = await fileNodeService.createFile(ctx.root.id, 'engine-wired.txt');

    const { id: modelId } = await llmModelsStore.upsertModel({
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'embeddinggemma-2-ONNX',
      modelRevision: `rev-c6-search-${Date.now()}-${Math.random()}`,
      precision: 'q4',
      maxInputChars: 8192,
      chunkBudget: 4,
      batchSize: 8,
    });

    const engine = {
      neighbors: jest.fn(async () => [{ nodeId: Number(file.id), score: 0.9 }]),
      allVectors: jest.fn(async () => []),
      upsert: jest.fn(),
      rebuildShadow: jest.fn(),
    };
    const createStore = jest.fn(async () => engine);
    const store = await initVectorStore({
      llmModelsStore,
      createStore,
    });

    expect(store).toBe(engine);
    expect(getVectorStore()).toBe(engine);
    expect(createStore).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: Number(modelId), dim: 768 })
    );

    const service = createSearchService({
      usageService: createUsageServiceFake(),
      // The adapter identity must match the registry row or the space-identity
      // guard degrades the leg (mid-switch protection).
      llmAdapter: createFakeEmbedAdapter({ modelId: Number(modelId), dim: 768 }),
      llmModelsStore,
    });
    const result = await service.search(ctx.user.id, { query: 'unmatchable phrase' });

    expect(engine.neighbors).toHaveBeenCalled();
    expect(result.semantic.map((row) => row.nodeId)).toContain(Number(file.id));
  });
});

// ---------------------------------------------------------------------------
// NL-parse leg (parse.nl) — adapter-injected fake chat; parser contract:
// searchService.md §2.8 (no E2E here — the fake-LLM harness owns it).
// ---------------------------------------------------------------------------

/** Fake llmAdapter with both exception-family roles; deterministic embed, scripted chat. */
function createFakeNlAdapter({
  configuredRoles = ['embed', 'chat'],
  chatReply = null,
  chatThrows = null,
  modelId = 7,
  dim = 4,
} = {}) {
  const embedCalls = [];
  const chatCalls = [];
  return {
    embedCalls,
    chatCalls,
    roleConfigured: async (role) => configuredRoles.includes(role),
    embedQuery: async (text) => {
      embedCalls.push(text);
      return { vectors: [[1, 0, 0, 0]], dim, modelId };
    },
    chat: async (messages, opts) => {
      chatCalls.push({ messages, opts });
      if (chatThrows)
        throw chatThrows instanceof Error ? chatThrows : new Error(String(chatThrows));
      const json = typeof chatReply === 'function' ? chatReply(messages) : chatReply;
      return { json, text: JSON.stringify(json ?? 'not-json'), usage: null, truncated: false };
    },
  };
}

const SIZE_ATOM = { type: 'size', min: 10485760 };

function readPredicatesColumn(normalizedQuery) {
  return dbQuery('SELECT predicates FROM query_parses WHERE normalized_query = ?', [
    normalizedQuery,
  ]).then(({ rows }) => (rows[0] ? JSON.parse(rows[0].predicates) : null));
}

describe('searchService NL-parse leg — gates (chat-off byte compatibility)', () => {
  it('chat unconfigured (embed-only) ⇒ ZERO chat calls and the parser-free response', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-gate.txt');
    const adapter = createFakeNlAdapter({ configuredRoles: ['embed'] });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'big files nl-gate-only' });

    expect(adapter.chatCalls).toHaveLength(0);
    expect(result.predicates).toBeUndefined();
    expect(Object.keys(result)).not.toContain('predicates');
  });

  it('chat-off and broken-chat responses are BYTE-IDENTICAL to the parser-free baseline', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-byte.pdf');
    const embedOnly = createFakeNlAdapter({ configuredRoles: ['embed'] });
    const first = await createC1Service({ adapter: embedOnly }).search(ctx.user.id, {
      query: 'byte pin query',
    });

    const brokenChat = createFakeNlAdapter({
      configuredRoles: ['embed', 'chat'],
      chatReply: 'garbage',
    });
    const second = await createC1Service({ adapter: brokenChat }).search(ctx.user.id, {
      query: 'byte pin query',
    });

    expect(brokenChat.chatCalls).toHaveLength(1);
    expect(second.predicates).toBeUndefined();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('AI_NL_PARSE_ENABLED kill switch off ⇒ zero chat calls, embed leg unaffected', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-switch.txt');
    const adapter = createFakeNlAdapter();
    const service = createC1Service({
      adapter,
      configResolver: {
        getConfig: async (key) => (key === 'AI_NL_PARSE_ENABLED' ? false : undefined),
      },
    });

    const result = await service.search(ctx.user.id, { query: 'switch off query' });

    expect(adapter.chatCalls).toHaveLength(0);
    expect(result.predicates).toBeUndefined();
    expect(adapter.embedCalls.length).toBeGreaterThan(0);
  });

  it('ONE chat call MAX per search submit (segmented query still calls chat once)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-once.txt');
    const adapter = createFakeNlAdapter({
      chatReply: { predicates: [SIZE_ATOM], vector_query: null },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'one two three four' });

    expect(adapter.chatCalls).toHaveLength(1);
    expect(adapter.chatCalls[0].opts.schema).toBeDefined();
    expect(adapter.chatCalls[0].opts.maxTokens).toEqual(expect.any(Number));
    expect(result.predicates).toEqual([SIZE_ATOM]);
  });
});

describe('searchService NL-parse leg — output, validation, cache', () => {
  it('valid parse ⇒ response carries canonical grammar atoms and the nl1 envelope lands in query_parses.predicates', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-write.pdf');
    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [
          { type: 'path', value: 'downloads' },
          SIZE_ATOM,
          { type: 'date', withinDays: 365 },
        ],
        vector_query: null,
      },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'downloads pdfs big' });

    expect(result.predicates).toEqual([
      { type: 'path', value: 'downloads', prefix: '/downloads' },
      SIZE_ATOM,
      { type: 'date', withinDays: 365 },
    ]);
    const stored = await readPredicatesColumn('downloads pdfs big');
    expect(stored).toMatchObject({ grammar: 'nl1' });
    expect(stored.atoms).toEqual(result.predicates);
    expect(stored.vectorQuery).toBeNull();
    // The embed vector landed on the SAME row (one row, two caches).
    const { rows } = await dbQuery(
      "SELECT vector FROM query_parses WHERE normalized_query = 'downloads pdfs big'"
    );
    expect(JSON.parse(rows[0].vector).v).toEqual([1, 0, 0, 0]);
  });

  it('cache hit ⇒ SECOND submit: zero chat calls, zero embed provider calls, same atoms served', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-hit.pdf');
    const firstAdapter = createFakeNlAdapter({
      chatReply: { predicates: [SIZE_ATOM], vector_query: 'huge pdfs' },
    });
    await createC1Service({ adapter: firstAdapter }).search(ctx.user.id, { query: 'hit check' });

    const secondAdapter = createFakeNlAdapter({
      chatReply: { predicates: [{ type: 'like' }], vector_query: null },
    });
    const second = await createC1Service({ adapter: secondAdapter }).search(ctx.user.id, {
      query: 'HIT   check',
    });

    expect(secondAdapter.chatCalls).toHaveLength(0);
    expect(secondAdapter.embedCalls).toHaveLength(0);
    expect(second.predicates).toEqual([SIZE_ATOM]);
  });

  it('grammar-violating chat output ⇒ SILENT fallback (no key, no cache write, embed on the original text)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-bad.pdf');
    const adapter = createFakeNlAdapter({
      chatReply: { predicates: [{ type: 'mime', value: 'pdf' }], vector_query: null },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'bad grammar query' });

    expect(result.predicates).toBeUndefined();
    expect(adapter.embedCalls).toEqual(expect.arrayContaining(['bad grammar query']));
    expect(await readPredicatesColumn('bad grammar query')).toEqual([]);
  });

  it('chat provider failure (budget/breaker class) ⇒ silent fallback, never a throw', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-fail.pdf');
    const adapter = createFakeNlAdapter({ chatThrows: 'llm role chat is not configured' });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'provider fail query' });

    expect(result.predicates).toBeUndefined();
    expect(await readPredicatesColumn('provider fail query')).toEqual([]);
  });

  it('refined vector_query ⇒ the whole-query embed runs on the refined text, segments keep the original words', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-refine.pdf');
    const adapter = createFakeNlAdapter({
      chatReply: { predicates: [], vector_query: '  Mountain Photos  ' },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'mountains over 5mb' });

    expect(adapter.embedCalls).toEqual(['mountain photos', 'mountains', 'over', '5mb']);
    expect(result.predicates).toEqual([]);
    // Replay through the PARSE CACHE: chat must not be called again, so the refined text —
    // and with it the result_ref — is replay-stable.
    const replayAdapter = createFakeNlAdapter({ chatThrows: 'replay must not call chat' });
    const replay = await createC1Service({ adapter: replayAdapter }).search(ctx.user.id, {
      query: 'mountains over 5mb',
    });
    expect(replayAdapter.chatCalls).toHaveLength(0);
    expect(replay.resultRef).toBe(result.resultRef);
    // The refined text rides the same cached embed path — its OWN normalized-text row:
    const refined = await readPredicatesColumn('mountain photos');
    expect(refined).toEqual([]);
    const { rows } = await dbQuery(
      "SELECT vector FROM query_parses WHERE normalized_query = 'mountain photos'"
    );
    expect(JSON.parse(rows[0].vector).v).toEqual([1, 0, 0, 0]);
  });

  it('an over-long refinement is dropped while the atoms still apply', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-long.pdf');
    const adapter = createFakeNlAdapter({
      chatReply: { predicates: [SIZE_ATOM], vector_query: 'x'.repeat(201) },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, { query: 'long refine query' });

    expect(result.predicates).toEqual([SIZE_ATOM]);
    expect(adapter.embedCalls).toEqual(expect.arrayContaining(['long refine query']));
  });

  it('re-embed on a model-space change keeps the stored parse envelope (parse cache survives the vector cache miss)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-space.pdf');
    const firstAdapter = createFakeNlAdapter({
      chatReply: { predicates: [SIZE_ATOM], vector_query: null },
    });
    await createC1Service({ adapter: firstAdapter }).search(ctx.user.id, { query: 'space keep' });

    const shiftAdapter = createFakeNlAdapter({
      modelId: 9,
      chatThrows: 'parse cache must not re-call chat',
    });
    const shifted = await createC1Service({
      adapter: shiftAdapter,
      llmModelsStore: { getActiveByRole: async () => ({ id: 9 }) },
    }).search(ctx.user.id, { query: 'space keep' });

    // Chat is CONFIGURED on this instance yet the atoms arrive with ZERO chat calls —
    // they came from the parse cache while the vector cache missed (new space, re-embed).
    expect(shiftAdapter.chatCalls).toHaveLength(0);
    expect(shiftAdapter.embedCalls.length).toBeGreaterThan(0);
    expect(shifted.predicates).toEqual([SIZE_ATOM]);
    const { rows } = await dbQuery(
      "SELECT vector FROM query_parses WHERE normalized_query = 'space keep'"
    );
    expect(JSON.parse(rows[0].vector).space).toBe('v1|model:9');
  });

  it('tampered envelope is a MISS: re-parse overwrites it', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-tamper.pdf');
    await dbQuery(
      `INSERT INTO query_parses (normalized_query, predicates)
       VALUES ('tamper row', '{"grammar":"nl1","atoms":[{"type":"mime"}],"vectorQuery":null}')`
    );

    const adapter = createFakeNlAdapter({ chatReply: { predicates: [SIZE_ATOM] } });
    const result = await createC1Service({ adapter }).search(ctx.user.id, {
      query: 'tamper row',
    });

    expect(adapter.chatCalls).toHaveLength(1);
    expect(result.predicates).toEqual([SIZE_ATOM]);
    expect(await readPredicatesColumn('tamper row')).toMatchObject({
      grammar: 'nl1',
      atoms: [SIZE_ATOM],
    });
  });
});

describe('searchService NL-parse leg — session predicate state', () => {
  it('grammar-valid request state reaches the prompt (symbols only) and runs the parse LIVE', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-state.pdf');
    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [
          { type: 'path', value: '/downloads' },
          { type: 'tag', value: 'pdf' },
        ],
        vector_query: null,
      },
    });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, {
      query: 'stateful submit',
      predicates: [{ type: 'like' }],
    });

    expect(result.predicates).toEqual([
      { type: 'path', value: '/downloads', prefix: '/downloads' },
      { type: 'tag', value: 'pdf' },
    ]);
    expect(adapter.chatCalls).toHaveLength(1);
    const userMessage = adapter.chatCalls[0].messages[adapter.chatCalls[0].messages.length - 1];
    // Symbols only — the like-atom arrives as field/value text, never as vectors or ids.
    expect(userMessage.content).toContain('stateful submit');
    expect(userMessage.content).toContain('like');
    expect(userMessage.content).not.toContain('nodeId');
  });

  it('a state-carrying submit neither reads NOR writes the parse cache', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-skip.pdf');
    const warm = createFakeNlAdapter({ chatReply: { predicates: [SIZE_ATOM] } });
    await createC1Service({ adapter: warm }).search(ctx.user.id, { query: 'cache skip row' });
    expect(warm.chatCalls).toHaveLength(1);

    const stateful = createFakeNlAdapter({ chatReply: { predicates: [{ type: 'like' }] } });
    const second = await createC1Service({ adapter: stateful }).search(ctx.user.id, {
      query: 'cache skip row',
      predicates: [{ type: 'tag', value: 'beach' }],
    });

    expect(stateful.chatCalls).toHaveLength(1);
    expect(second.predicates).toEqual([{ type: 'like' }]);
    expect(await readPredicatesColumn('cache skip row')).toMatchObject({ atoms: [SIZE_ATOM] });

    const statelessAgain = createFakeNlAdapter();
    const third = await createC1Service({ adapter: statelessAgain }).search(ctx.user.id, {
      query: 'cache skip row',
    });
    expect(statelessAgain.chatCalls).toHaveLength(0);
    expect(third.predicates).toEqual([SIZE_ATOM]);
  });

  it('malformed request state is discarded silently (never a 4xx path) — parse runs stateless', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'nl-badstate.pdf');
    const adapter = createFakeNlAdapter({ chatReply: { predicates: [] } });
    const service = createC1Service({ adapter });

    const result = await service.search(ctx.user.id, {
      query: 'bad state row',
      predicates: 'not-an-array',
    });

    expect(result.predicates).toEqual([]);
    expect(adapter.chatCalls).toHaveLength(1);
    const userMessage = adapter.chatCalls[0].messages[adapter.chatCalls[0].messages.length - 1];
    expect(userMessage.content).toBe('bad state row');
  });
});

// ---------------------------------------------------------------------------
// §2.9 delta semantics — replay binding, merge rules, filters, fallbacks
// ---------------------------------------------------------------------------

async function setFileSize(nodeId, size) {
  await createFileNodesStore().upsertCache(Number(nodeId), Number(size), null, null);
}

/** Deterministic scorer: returns the supplied ids, honoring candidateIds. */
function createDeltaScorer(ids, scoreFor) {
  return jest.fn(async ({ candidateIds = null }) => {
    const universe = candidateIds ? [...candidateIds] : ids;
    return universe.map((nodeId, index) => ({
      nodeId: Number(nodeId),
      score: scoreFor ? scoreFor(Number(nodeId), index) : 0.9 - index * 0.01,
    }));
  });
}

function createDeltaService({
  adapter,
  scorer,
  llmModelsStore: models = { getActiveByRole: async () => ({ id: 7, provider: 'embedded' }) },
  resultRefRegistry,
  usageService,
  embeddingsStore: embeddings,
} = {}) {
  return createSearchService({
    usageService: usageService || createUsageServiceFake(),
    configResolver: defaultConfigResolver,
    llmAdapter: adapter,
    llmModelsStore: models,
    provisioner: { loadLock: () => ({ repo: 'org/embed-model', revision: 'rev-1' }) },
    semanticScorer: scorer,
    ...(resultRefRegistry ? { resultRefRegistry } : {}),
    ...(embeddings ? { embeddingsStore: embeddings } : {}),
  });
}

const REF_ONLY_REPLY = {
  predicates: [],
  vector_query: null,
  delta: { $ref: 'latest' },
};

describe('searchService §2.9 delta — $ref replay', () => {
  it('re-executes the base name+semantic sections under current ACL and emits additive delta fields', async () => {
    const ctx = await createUserWithRoot();
    const nameHit = await fileNodeService.createFile(ctx.root.id, 'delta-base-notes.txt');
    const semA = await fileNodeService.createFile(ctx.root.id, 'red-photo.txt');
    const semB = await fileNodeService.createFile(ctx.root.id, 'blue-photo.txt');
    const scorer = createDeltaScorer([semA.id, semB.id]);
    const baseAdapter = createFakeNlAdapter({ configuredRoles: ['embed'] });
    const base = await createDeltaService({ adapter: baseAdapter, scorer }).search(ctx.user.id, {
      query: 'delta-base',
    });
    expect(base.nameMatches.map((row) => row.nodeId)).toEqual([nameHit.id]);
    expect(base.semantic.map((row) => row.nodeId)).toEqual([semA.id, semB.id]);

    const followAdapter = createFakeNlAdapter({ chatReply: REF_ONLY_REPLY });
    const usageService = createUsageServiceFake();
    const follow = await createDeltaService({
      adapter: followAdapter,
      scorer,
      usageService,
    }).search(ctx.user.id, {
      query: 'and those ones',
      resultRef: base.resultRef,
    });

    expect(follow.nameMatches).toEqual(base.nameMatches);
    expect(follow.semantic).toEqual(base.semantic);
    expect(follow.delta).toEqual({
      add: [],
      replace: [],
      exclude: [],
      excludeSimilar: false,
      ref: 'latest',
    });
    expect(follow.sessionPredicates).toEqual([]);
    expect(follow.predicates).toEqual([]);
    expect(follow.resultRef).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(follow.resultRef).not.toBe(base.resultRef);
    expect(followAdapter.chatCalls).toHaveLength(1);
    expect(followAdapter.embedCalls).toHaveLength(0);

    // Exactly one usage row per RETURNED node (internal base pass never logs).
    await flushUsageEvents();
    expect(usageService.recordEvent.mock.calls).toHaveLength(3);
  });

  it('a ref-only rerun is deterministic: same inputs ⇒ same fresh ref, zero extra provider calls', async () => {
    const ctx = await createUserWithRoot();
    const file = await fileNodeService.createFile(ctx.root.id, 'replay-stable.txt');
    const scorer = createDeltaScorer([], () => 0.9);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
    }).search(ctx.user.id, { query: 'replay-stable' });
    expect(base.nameMatches.map((row) => row.nodeId)).toEqual([file.id]);

    const followAdapter = createFakeNlAdapter({ chatReply: REF_ONLY_REPLY });
    const service = createDeltaService({ adapter: followAdapter, scorer });
    const first = await service.search(ctx.user.id, {
      query: 'those files',
      resultRef: base.resultRef,
    });
    const second = await service.search(ctx.user.id, {
      query: 'those files',
      resultRef: base.resultRef,
    });

    expect(second.resultRef).toBe(first.resultRef);
    expect(second).toEqual(first);
    expect(followAdapter.chatCalls).toHaveLength(1); // second parse is cached
    expect(followAdapter.embedCalls).toHaveLength(0); // base vectors are cached
  });

  it('derives a plain base ref from query_parses after a registry miss (restart fallback)', async () => {
    const ctx = await createUserWithRoot();
    const query = `restart-derive-${Date.now()}`;
    const file = await fileNodeService.createFile(ctx.root.id, `${query}.txt`);
    const scorer = createDeltaScorer([], () => 0.9);
    const baseRegistry = createResultRefRegistry();
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
      resultRefRegistry: baseRegistry,
    }).search(ctx.user.id, { query });
    expect(base.nameMatches.map((row) => row.nodeId)).toEqual([file.id]);

    const followAdapter = createFakeNlAdapter({ chatReply: REF_ONLY_REPLY });
    const follow = await createDeltaService({
      adapter: followAdapter,
      scorer,
      resultRefRegistry: createResultRefRegistry(), // simulate a fresh process
    }).search(ctx.user.id, { query: 'of those', resultRef: base.resultRef });

    expect(follow.nameMatches.map((row) => row.nodeId)).toEqual([file.id]);
    expect(follow.delta).toMatchObject({ ref: 'latest' });
    expect(followAdapter.embedCalls).toHaveLength(0);
  });

  it('different base refs produce different delta signatures (no collision)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'collision-alpha.txt');
    await fileNodeService.createFile(ctx.root.id, 'collision-beta.txt');
    const scorer = createDeltaScorer([], () => 0.9);
    const baseService = createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
    });
    const baseA = await baseService.search(ctx.user.id, { query: 'collision-alpha' });
    const baseB = await baseService.search(ctx.user.id, { query: 'collision-beta' });
    const follow = createDeltaService({
      adapter: createFakeNlAdapter({ chatReply: REF_ONLY_REPLY }),
      scorer,
    });

    const deltaA = await follow.search(ctx.user.id, {
      query: 'those ones',
      resultRef: baseA.resultRef,
    });
    const deltaB = await follow.search(ctx.user.id, {
      query: 'those ones',
      resultRef: baseB.resultRef,
    });

    expect(deltaA.resultRef).not.toBe(deltaB.resultRef);
  });
});

describe('searchService §2.9 delta — merge filters', () => {
  it('add filters BOTH sections (size atom)', async () => {
    const ctx = await createUserWithRoot();
    const bigName = await fileNodeService.createFile(ctx.root.id, 'filter-add-big.bin');
    const smallName = await fileNodeService.createFile(ctx.root.id, 'filter-add-small.bin');
    const bigSem = await fileNodeService.createFile(ctx.root.id, 'red-filter.bin');
    const smallSem = await fileNodeService.createFile(ctx.root.id, 'blue-filter.bin');
    await setFileSize(bigName.id, 5000);
    await setFileSize(smallName.id, 100);
    await setFileSize(bigSem.id, 5000);
    await setFileSize(smallSem.id, 100);

    const scorer = createDeltaScorer([bigSem.id, smallSem.id]);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
    }).search(ctx.user.id, { query: 'filter-add' });
    expect(base.nameMatches).toHaveLength(2);
    expect(base.semantic).toHaveLength(2);

    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [{ type: 'size', min: 1000 }],
        vector_query: null,
        delta: { add: [{ type: 'size', min: 1000 }], $ref: 'latest' },
      },
    });
    const result = await createDeltaService({ adapter, scorer }).search(ctx.user.id, {
      query: 'only the big ones',
      resultRef: base.resultRef,
    });

    expect(result.nameMatches.map((row) => row.nodeId)).toEqual([bigName.id]);
    expect(result.semantic.map((row) => row.nodeId)).toEqual([bigSem.id]);
    expect(result.sessionPredicates).toEqual([{ type: 'size', min: 1000 }]);
    expect(result.delta.add).toEqual([{ type: 'size', min: 1000 }]);
  });

  it('exclude is a SUBTRACTION pass over the replay result', async () => {
    const ctx = await createUserWithRoot();
    const keep = await fileNodeService.createFile(ctx.root.id, 'exclude-keep.bin');
    const drop = await fileNodeService.createFile(ctx.root.id, 'exclude-drop.bin');
    await setFileSize(keep.id, 100);
    await setFileSize(drop.id, 5000);
    const scorer = createDeltaScorer([], () => 0.9);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
    }).search(ctx.user.id, { query: 'exclude-' });
    expect(base.nameMatches).toHaveLength(2);

    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [],
        vector_query: null,
        delta: { exclude: [{ type: 'size', min: 1000 }], $ref: 'latest' },
      },
    });
    const result = await createDeltaService({ adapter, scorer }).search(ctx.user.id, {
      query: 'not the big one',
      resultRef: base.resultRef,
    });

    expect(result.nameMatches.map((row) => row.nodeId)).toEqual([keep.id]);
    expect(result.sessionPredicates).toEqual([]);
    expect(result.delta.exclude).toEqual([{ type: 'size', min: 1000 }]);
  });

  it('replace removes the same-type session slot before adding (non-reference delta)', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'replace-slot.txt');
    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [{ type: 'date', withinDays: 3650 }],
        vector_query: null,
        delta: { replace: [{ type: 'date', withinDays: 3650 }] },
      },
    });
    const result = await createDeltaService({
      adapter,
      scorer: createDeltaScorer([], () => 0.9),
    }).search(ctx.user.id, {
      query: 'replace the date',
      predicates: [{ type: 'date', withinDays: 30 }],
    });

    expect(result.predicates).toEqual([{ type: 'date', withinDays: 3650 }]);
    expect(result.delta.replace).toEqual([{ type: 'date', withinDays: 3650 }]);
    expect(result.sessionPredicates).toEqual([{ type: 'date', withinDays: 3650 }]);
    expect(result.delta.ref).toBeNull();
  });

  it('exclude_similar drops the lower-ranked near-duplicate at the profile θ_dup', async () => {
    const ctx = await createUserWithRoot();
    const first = await fileNodeService.createFile(ctx.root.id, 'similar-a.txt');
    const second = await fileNodeService.createFile(ctx.root.id, 'similar-b.txt');
    const seededEmbeddings = {
      getByNodeIds: async (nodeIds) =>
        nodeIds.map((nodeId) => ({
          nodeId: Number(nodeId),
          modelId: 7,
          dim: 4,
          vector: '1,0,0,0',
          source: 'head',
          contentHash: `similar-${nodeId}`,
        })),
    };

    const models = { getActiveByRole: async () => ({ id: 7, provider: 'embedded' }) };
    const scorer = createDeltaScorer([], () => 0.9);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
      llmModelsStore: models,
    }).search(ctx.user.id, { query: 'similar-' });
    expect(base.nameMatches.map((row) => row.nodeId)).toEqual([first.id, second.id]);

    const adapter = createFakeNlAdapter({
      chatReply: {
        predicates: [],
        vector_query: null,
        delta: { exclude_similar: true, $ref: 'latest' },
      },
    });
    const result = await createDeltaService({
      adapter,
      scorer,
      llmModelsStore: models,
      embeddingsStore: seededEmbeddings,
    }).search(ctx.user.id, { query: 'drop the similar ones', resultRef: base.resultRef });

    expect(result.nameMatches.map((row) => row.nodeId)).toEqual([first.id]);
    expect(result.delta.excludeSimilar).toBe(true);
  });

  it('drops a node whose ACL grant was revoked between turns (replay re-checks current ACL)', async () => {
    const owner = await createUserWithRoot();
    const requester = await createUserWithRoot();
    const shared = await fileNodeService.createFile(owner.root.id, 'revoked-delta-file.txt');
    await grantTestPermissionByNodeId({
      userId: requester.user.id,
      fileNodeId: shared.id,
      permission: 'read',
    });

    const scorer = createDeltaScorer([], () => 0.9);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
    }).search(requester.user.id, { query: 'revoked-delta' });
    expect(base.nameMatches.map((row) => row.nodeId)).toEqual([shared.id]);

    await permissionStore.revoke(requester.user.id, shared.id);

    const result = await createDeltaService({
      adapter: createFakeNlAdapter({ chatReply: REF_ONLY_REPLY }),
      scorer,
    }).search(requester.user.id, {
      query: 'of those',
      resultRef: base.resultRef,
    });

    expect(result.nameMatches).toEqual([]);
    expect(result.semantic).toEqual([]);
  });
});

describe('searchService §2.9 delta — silent structural fallbacks', () => {
  it('an unknown/malformed result_ref never 4xxes and returns the parser-free shape', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'fallback-ref.txt');
    const scorer = createDeltaScorer([], () => 0.9);

    for (const ref of ['not-a-ref', 'sr1.0000000000000000', undefined]) {
      const adapter = createFakeNlAdapter({ chatReply: REF_ONLY_REPLY });
      const result = await createDeltaService({ adapter, scorer }).search(ctx.user.id, {
        query: 'fallback ref query',
        resultRef: ref,
      });
      expect(result.delta).toBeUndefined();
      expect(result.sessionPredicates).toBeUndefined();
      expect(result.predicates).toBeUndefined();
      expect(result.nameMatches.map((row) => row.nodeId)).toEqual(expect.any(Array));
    }
  });

  it('a space-mismatched ref falls back silently instead of replaying across model spaces', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'space-mismatch.txt');
    const scorer = createDeltaScorer([], () => 0.9);
    const base = await createDeltaService({
      adapter: createFakeNlAdapter({ configuredRoles: ['embed'] }),
      scorer,
      llmModelsStore: { getActiveByRole: async () => ({ id: 7, provider: 'embedded' }) },
    }).search(ctx.user.id, { query: 'space-mismatch' });

    const adapter = createFakeNlAdapter({ chatReply: REF_ONLY_REPLY, modelId: 8 });
    const result = await createDeltaService({
      adapter,
      scorer,
      llmModelsStore: { getActiveByRole: async () => ({ id: 8, provider: 'embedded' }) },
    }).search(ctx.user.id, {
      query: 'of those',
      resultRef: base.resultRef,
    });

    expect(result.delta).toBeUndefined();
    expect(result.predicates).toBeUndefined();
    expect(result.nameMatches.map((row) => row.nodeId)).toEqual(expect.any(Array));
  });
});
