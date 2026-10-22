/**
 * searchService unit tests (P0 name section; domain object + thrown bare codes).
 * @see docs/spec/server/services/searchService.md
 */
const { createTestDatabase, createAuthenticatedTestUser, dbQuery } = require('@server/test-utils');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createSearchService } = require('../searchService');

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
    expect(result.semanticAvailable).toBe(false);
    expect(result.semanticUnavailableReason).toBe('serverErrors.ai.notConfigured');
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
    expect(result.semanticAvailable).toBe(true);
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
    expect(result.semanticAvailable).toBe(false);
    expect(result.semanticUnavailableReason).toBe('serverErrors.ai.notConfigured');
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
    expect(result.semanticAvailable).toBe(false);
    expect(result.semanticUnavailableReason).toBe('serverErrors.ai.notConfigured');
  });

  it('provider failure with the role configured ⇒ honest empty (available true), name intact, no throw', async () => {
    const ctx = await createUserWithRoot();
    await fileNodeService.createFile(ctx.root.id, 'degraded-provider.txt');
    const service = createC1Service({ adapter: createFakeEmbedAdapter({ failing: true }) });

    const result = await service.search(ctx.user.id, { query: 'degraded phrase' });

    expect(result.nameMatches).toHaveLength(1);
    expect(result.semantic).toEqual([]);
    expect(result.semanticAvailable).toBe(true);
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
    expect(result.semanticAvailable).toBe(true);
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
      'SELECT normalized_query, hit_count FROM query_parses ORDER BY normalized_query'
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
    const { rows } = await dbQuery('SELECT hit_count FROM query_parses');
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

    expect(adapter.calls.sort()).toEqual(['alpha', 'alpha beta gamma', 'alpha beta gamma delta', 'beta', 'gamma']);
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
    const nameMatched = await fileNodeService.createFile(ctx.root.id, 'matched-alpha.txt');
    const a = await fileNodeService.createFile(ctx.root.id, 'vec-alpha.txt');
    const b = await fileNodeService.createFile(ctx.root.id, 'vec-beta.txt');
    const c = await fileNodeService.createFile(ctx.root.id, 'vec-gamma.txt');
    const d = await fileNodeService.createFile(ctx.root.id, 'vec-delta.txt');
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
        { nodeId: c.id, score: 0.9 },
        { nodeId: a.id, score: 0.9 },
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
      expect.objectContaining({ nodeId: nameMatched.id, name: 'matched-alpha.txt' }),
    ]);
    // Order score desc then node_id asc, cap 2 AFTER dedup.
    expect(result.semantic).toEqual([
      { nodeId: c.id, name: 'vec-gamma.txt', score: 0.9 },
      { nodeId: a.id, name: 'vec-alpha.txt', score: 0.9 },
    ]);
    expect(result.semanticAvailable).toBe(true);
    expect(result.counts).toEqual({
      name: 1,
      semantic: 2,
      total: 3,
      nameTruncated: false,
      semanticCappedSegments: false,
    });

    await flushUsageEvents();
    const recorded = usageService.recordEvent.mock.calls.map((c) => c[0]);
    const semanticHits = recorded.filter((e) => [c.id, a.id].includes(e.nodeId));
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
    expect(result.semanticAvailable).toBe(true);
    expect(result.counts.semantic).toBe(0);
  });
});
