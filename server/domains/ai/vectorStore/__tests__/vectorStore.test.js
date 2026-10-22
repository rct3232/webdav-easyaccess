'use strict';

// vectorStore seam factory (vectorStore.md §2.1-§2.3, PLAN §28.2.1 A-1).
//
// RED-first: written before `vectorStore/index.js` exists. Pins the boot
// selection matrix (pg probe ok/fail, sqlite ok/fail, unsupported dialect),
// the `vector` health row on selection/degrade, the §2.2 write hooks
// (canonical halves + derived shadow in ONE transaction) and rebuildShadow
// delegation.

const {
  createVectorStore,
  probeVectorCapability,
  createCanonicalHooks,
  VECTOR_HEALTH_KEY,
} = require('../index');

const MODEL_ID = 42;
const DIM = 4;

function fakeHealth() {
  return { report: jest.fn() };
}

function fakeEngine(overrides = {}) {
  return {
    init: jest.fn().mockResolvedValue('ok'),
    neighbors: jest.fn().mockResolvedValue([{ nodeId: 1, score: 0.9 }]),
    allVectors: jest.fn().mockResolvedValue([]),
    rebuildShadow: jest.fn().mockResolvedValue({ rowsInserted: 3 }),
    syncShadow: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseOpts(overrides = {}) {
  return {
    executor: { dialect: 'postgres' },
    modelId: MODEL_ID,
    dim: DIM,
    loadRows: jest.fn().mockResolvedValue([]),
    health: fakeHealth(),
    ...overrides,
  };
}

describe('createVectorStore — boot selection matrix', () => {
  it('postgres ∧ pgvector ≥ 0.7 → PgVector (native), health ok', async () => {
    const engine = fakeEngine();
    const createPg = jest.fn(() => engine);
    const opts = baseOpts({ createPg });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);

    expect(createPg).toHaveBeenCalledTimes(1);
    expect(createPg.mock.calls[0][0]).toMatchObject({
      modelId: MODEL_ID,
      dim: DIM,
      executor: opts.executor,
      loadRows: opts.loadRows,
    });
    expect(engine.init).toHaveBeenCalledTimes(1);
    expect(store.impl).toBe('native');
    expect(store.engine).toBe('pgvector');
    expect(opts.health.report).toHaveBeenCalledWith(VECTOR_HEALTH_KEY, { ok: true });
  });

  it('postgres ∧ pgvector absent → TextVectorJs + degraded health row with hint', async () => {
    const engine = fakeEngine();
    const createPg = jest.fn(() => engine);
    const opts = baseOpts({ createPg });
    opts.probePg = jest.fn().mockResolvedValue({
      available: false,
      installed: false,
      version: null,
      hint: 'CREATE EXTENSION vector (pgvector ≥ 0.7 required)',
    });

    const store = await createVectorStore(opts);

    expect(createPg).not.toHaveBeenCalled();
    expect(store.impl).toBe('fallback_js');
    expect(store.engine).toBe('js');
    expect(opts.health.report).toHaveBeenCalledWith(VECTOR_HEALTH_KEY, {
      ok: false,
      reason: 'pgvectorUnavailable',
      hint: 'CREATE EXTENSION vector (pgvector ≥ 0.7 required)',
    });
    // The fallback is a legal sink: reads delegate to the canonical loader.
    await store.neighbors([1, 0, 0, 0], 5, null);
    expect(opts.loadRows).toHaveBeenCalled();
  });

  it('postgres probe throw → JsFallback (boot never blocks)', async () => {
    const opts = baseOpts();
    opts.probePg = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: '42P01' }));

    const store = await createVectorStore(opts);

    expect(store.impl).toBe('fallback_js');
    expect(opts.health.report).toHaveBeenCalledWith(
      VECTOR_HEALTH_KEY,
      expect.objectContaining({ ok: false, reason: '42P01' })
    );
  });

  it('postgres ∧ native probe ok but no bounded dim → JsFallback (no dim, no shadow)', async () => {
    const createPg = jest.fn();
    const opts = baseOpts({ dim: null, createPg });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);

    expect(createPg).not.toHaveBeenCalled();
    expect(store.impl).toBe('fallback_js');
    expect(opts.health.report).toHaveBeenCalledWith(
      VECTOR_HEALTH_KEY,
      expect.objectContaining({ ok: false, reason: 'dimUnavailable' })
    );
  });

  it('sqlite ∧ sqlite-vec loadable → SqliteVec (native), health ok', async () => {
    const engine = fakeEngine();
    const createSqlite = jest.fn(() => engine);
    const opts = baseOpts({
      executor: { dialect: 'sqlite' },
      sqliteDb: { marker: 'db' },
      createSqlite,
    });
    opts.probeSqlite = jest.fn().mockReturnValue({ available: true, reason: null, hint: null });

    const store = await createVectorStore(opts);

    expect(opts.probeSqlite).toHaveBeenCalledWith(opts.sqliteDb);
    expect(createSqlite).toHaveBeenCalledTimes(1);
    expect(createSqlite.mock.calls[0][0]).toMatchObject({
      modelId: MODEL_ID,
      db: opts.sqliteDb,
      loadRows: opts.loadRows,
    });
    expect(store.impl).toBe('native');
    expect(store.engine).toBe('sqlite-vec');
    expect(opts.health.report).toHaveBeenCalledWith(VECTOR_HEALTH_KEY, { ok: true });
  });

  it('sqlite ∧ extension load failure → TextVectorJs + degraded health row', async () => {
    const createSqlite = jest.fn();
    const opts = baseOpts({
      executor: { dialect: 'sqlite' },
      sqliteDb: { marker: 'db' },
      createSqlite,
    });
    opts.probeSqlite = jest.fn().mockReturnValue({
      available: false,
      reason: 'vec0Unavailable',
      hint: 'install the sqlite-vec loadable extension (≥ 0.1.9)',
    });

    const store = await createVectorStore(opts);

    expect(createSqlite).not.toHaveBeenCalled();
    expect(store.impl).toBe('fallback_js');
    expect(opts.health.report).toHaveBeenCalledWith(VECTOR_HEALTH_KEY, {
      ok: false,
      reason: 'vec0Unavailable',
      hint: 'install the sqlite-vec loadable extension (≥ 0.1.9)',
    });
  });

  it('native construction throw degrades to JsFallback (never throws)', async () => {
    const opts = baseOpts({
      createPg: jest.fn(() => {
        throw new Error('init exploded');
      }),
    });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);

    expect(store.impl).toBe('fallback_js');
    expect(opts.health.report).toHaveBeenCalledWith(
      VECTOR_HEALTH_KEY,
      expect.objectContaining({ ok: false })
    );
  });

  it('unsupported dialect falls through to JsFallback (supported shipping state)', async () => {
    const opts = baseOpts({ executor: { dialect: 'mysql' } });

    const store = await createVectorStore(opts);

    expect(store.impl).toBe('fallback_js');
    expect(opts.health.report).toHaveBeenCalledWith(
      VECTOR_HEALTH_KEY,
      expect.objectContaining({ ok: false, reason: 'unsupportedDialect' })
    );
  });
});

describe('probeVectorCapability', () => {
  it('pg available ⇒ { engine: pgvector, available: true }', async () => {
    const capability = await probeVectorCapability({
      executor: { dialect: 'postgres' },
      probePg: async () => ({ available: true, version: '0.8.1' }),
    });
    expect(capability).toMatchObject({
      engine: 'pgvector',
      available: true,
      version: '0.8.1',
    });
  });

  it('no executor ⇒ js capability with a hint', async () => {
    await expect(probeVectorCapability({})).resolves.toMatchObject({
      engine: 'js',
      available: false,
      reason: 'executorUnavailable',
    });
  });
});

describe('write hooks — canonical halves + shadow in ONE transaction (§2.2)', () => {
  it('seam upsert runs pooled + chunk + syncShadow on the same tx handle', async () => {
    const engine = fakeEngine();
    const tx = { tx: true };
    const canonical = {
      transaction: jest.fn(async (fn) => fn(tx)),
      upsertPooled: jest.fn().mockResolvedValue(undefined),
      replaceChunks: jest.fn().mockResolvedValue(undefined),
    };
    const opts = baseOpts({ hooks: canonical, createPg: jest.fn(() => engine) });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);
    await store.upsert(
      9,
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ],
      DIM
    );

    expect(canonical.transaction).toHaveBeenCalledTimes(1);
    expect(canonical.upsertPooled).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ nodeId: 9, modelId: MODEL_ID, dim: DIM, vector: '1,0,0,0' })
    );
    expect(canonical.replaceChunks).toHaveBeenCalledWith(tx, 9, MODEL_ID, ['0,1,0,0']);
    expect(engine.syncShadow).toHaveBeenCalledWith(tx, 9, '1,0,0,0', ['0,1,0,0']);
  });

  it('pipeline hooks use the same tx for canonical writes and the shadow sync', async () => {
    const engine = fakeEngine();
    const tx = {};
    const canonical = {
      transaction: jest.fn(async (fn) => fn(tx)),
      upsertPooled: jest.fn().mockResolvedValue(undefined),
      replaceChunks: jest.fn().mockResolvedValue(undefined),
    };
    const opts = baseOpts({ hooks: canonical, createPg: jest.fn(() => engine) });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);
    await store.hooks.transaction(async (handle) => {
      await store.hooks.upsertPooled(handle, {
        nodeId: 3,
        modelId: MODEL_ID,
        dim: DIM,
        vector: '0,0,1,0',
        source: 'chunk_pool',
        contentHash: 'h',
      });
      await store.hooks.replaceChunks(handle, 3, MODEL_ID, ['0,0,0,1']);
    });

    expect(canonical.upsertPooled).toHaveBeenCalledWith(tx, expect.objectContaining({ nodeId: 3 }));
    expect(canonical.replaceChunks).toHaveBeenCalledWith(tx, 3, MODEL_ID, ['0,0,0,1']);
    expect(engine.syncShadow).toHaveBeenCalledWith(tx, 3, '0,0,1,0', ['0,0,0,1']);
  });
});

describe('rebuildShadow delegation', () => {
  it('native engine rebuild is delegated (admin trigger seam)', async () => {
    const engine = fakeEngine();
    const opts = baseOpts({ createPg: jest.fn(() => engine) });
    opts.probePg = jest.fn().mockResolvedValue({ available: true, version: '0.8.0' });

    const store = await createVectorStore(opts);

    await expect(store.rebuildShadow()).resolves.toEqual({ rowsInserted: 3 });
    expect(engine.rebuildShadow).toHaveBeenCalledTimes(1);
  });

  it('JsFallback rebuild is a uniform no-op (no derived artifact)', async () => {
    const opts = baseOpts();
    opts.probePg = jest.fn().mockResolvedValue({ available: false, hint: 'hint' });

    const store = await createVectorStore(opts);

    await expect(store.rebuildShadow()).resolves.toBeUndefined();
  });
});

describe('createCanonicalHooks', () => {
  it('binds the executor dialect placeholders (sqlite ? / postgres $n)', async () => {
    const sqliteTx = { run: jest.fn().mockResolvedValue({ changes: 1 }) };
    const sqlite = createCanonicalHooks({ dialect: 'sqlite' });
    await sqlite.upsertPooled(sqliteTx, {
      nodeId: 1,
      modelId: 2,
      dim: 3,
      vector: '1,2,3',
      source: 'chunk_pool',
      contentHash: null,
    });
    expect(sqliteTx.run.mock.calls[0][0]).toContain('VALUES (?, ?, ?, ?, ?, ?');

    const pgTx = { run: jest.fn().mockResolvedValue({ changes: 1 }) };
    const pg = createCanonicalHooks({ dialect: 'postgres' });
    await pg.upsertPooled(pgTx, {
      nodeId: 1,
      modelId: 2,
      dim: 3,
      vector: '1,2,3',
      source: 'chunk_pool',
      contentHash: null,
    });
    expect(pgTx.run.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4, $5, $6');
  });
});
