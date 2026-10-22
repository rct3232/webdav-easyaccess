'use strict';

/**
 * QueryParsesRepository L2 conformance (docs/spec/server/services/
 * searchService.md §2.3 step 4, §2.5). Runs against the ACTIVE backend via
 * createTestDatabase() (sqlite default leg; real PG adapter leg — orchestrator
 * owned). Covers the get-or-embed cache row contract: normalized-text primary
 * key, JSON envelope vector storage, hit_count increments on cache hits only,
 * predicates JSON round-trip and the unicode key identity.
 */

const { createTestDatabase, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createQueryParsesRepository = require('@server/store/repositories/QueryParsesRepository');

describe('QueryParsesRepository conformance', () => {
  let dbCleanup;
  let repo;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createQueryParsesRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const readRow = async (key) => {
    const { rows } = await dbQuery('SELECT * FROM query_parses WHERE normalized_query = ?', [key]);
    return rows[0] || null;
  };

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('get on an unknown key → null', async () => {
    await expect(repo.get('no-such-normalized-query')).resolves.toBeNull();
  });

  it('recordEmbedding inserts the cache row: vector verbatim, predicates as JSON, hit_count 0, ISO created_at', async () => {
    const vectorText = JSON.stringify({ space: 'v1|model:7', dim: 4, v: [1, 0, 0, 0] });
    await expect(
      repo.recordEmbedding({ normalizedQuery: 'cache me', vector: vectorText })
    ).resolves.toEqual({ changes: 1 });

    const row = await repo.get('cache me');
    expect(row).toMatchObject({
      normalizedQuery: 'cache me',
      vector: vectorText,
      hitCount: 0,
    });
    expect(row.predicates).toEqual([]);
    expect(typeof row.createdAt).toBe('string');
    expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(false);

    const raw = await readRow('cache me');
    expect(raw.vector).toBe(vectorText);
  });

  it('predicates round-trip as a PARSED array through the repository boundary (both dialects)', async () => {
    const predicates = [{ kind: 'name', value: 'reserved' }];
    await repo.recordEmbedding({
      normalizedQuery: 'with predicates',
      vector: null,
      predicates,
    });
    const row = await repo.get('with predicates');
    expect(row.predicates).toEqual(predicates);
    expect(Array.isArray(row.predicates)).toBe(true);
  });

  it('recordEmbedding on an existing key overwrites ONLY the vector (hit_count and created_at untouched)', async () => {
    const first = JSON.stringify({ space: 'v1|model:7', dim: 4, v: [1, 0, 0, 0] });
    const second = JSON.stringify({ space: 'v1|model:9', dim: 4, v: [0, 1, 0, 0] });
    await repo.recordEmbedding({ normalizedQuery: 'overwrite me', vector: first });
    await repo.incrementHitCount('overwrite me');
    const before = await readRow('overwrite me');

    await repo.recordEmbedding({ normalizedQuery: 'overwrite me', vector: second });

    const after = await readRow('overwrite me');
    expect(after.vector).toBe(second);
    expect(Number(after.hit_count)).toBe(Number(before.hit_count));
    expect(after.created_at).toBe(before.created_at);

    const mapped = await repo.get('overwrite me');
    expect(mapped.vector).toBe(second);
    expect(mapped.hitCount).toBe(1);
  });

  it('incrementHitCount bumps by exactly 1 per call and reports 0 changes for an unknown key', async () => {
    await repo.recordEmbedding({
      normalizedQuery: 'hit counter',
      vector: JSON.stringify({ space: 'v1|model:7', dim: 4, v: [1, 0, 0, 0] }),
    });
    await expect(repo.incrementHitCount('hit counter')).resolves.toEqual({ changes: 1 });
    await expect(repo.incrementHitCount('hit counter')).resolves.toEqual({ changes: 1 });
    const row = await repo.get('hit counter');
    expect(row.hitCount).toBe(2);

    await expect(repo.incrementHitCount('never-inserted-key')).resolves.toEqual({ changes: 0 });
  });

  it('normalized-text keys are byte-exact: NFKC-folded variants are DISTINCT rows', async () => {
    await repo.recordEmbedding({
      normalizedQuery: 'café latte',
      vector: JSON.stringify({ space: 'v1|model:7', dim: 4, v: [1, 0, 0, 0] }),
    });
    await repo.recordEmbedding({
      normalizedQuery: 'cafe latte',
      vector: JSON.stringify({ space: 'v1|model:7', dim: 4, v: [0, 1, 0, 0] }),
    });
    expect((await repo.get('café latte')).vector).not.toBe((await repo.get('cafe latte')).vector);
  });

  it('upsert is idempotent per key — one row total for repeated writes', async () => {
    for (let i = 0; i < 3; i += 1) {
      await repo.recordEmbedding({
        normalizedQuery: 'idempotent key',
        vector: JSON.stringify({ space: 'v1|model:7', dim: 4, v: [i, 0, 0, 0] }),
      });
    }
    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM query_parses WHERE normalized_query = ?',
      ['idempotent key']
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });
});
