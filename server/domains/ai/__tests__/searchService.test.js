/**
 * searchService unit tests (P0 name section; domain object + thrown bare codes).
 * @see docs/spec/server/services/searchService.md
 */
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  dbQuery,
} = require('@server/test-utils');
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
    expect(recorded.every((e) => e.action === 'search_hit' && e.userId === ctx.user.id)).toBe(
      true
    );
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
