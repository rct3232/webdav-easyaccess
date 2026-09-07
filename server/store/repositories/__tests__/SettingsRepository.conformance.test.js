'use strict';

/**
 * SettingsRepository L2 conformance (docs/spec/server/store/repository-contract.md).
 * Runs against the ACTIVE backend via createTestDatabase(): sqlite in the
 * default CI leg, real PostgreSQL under the WEA_TEST_PG_* adapter leg. The
 * suite asserts behavior through the repository interface only.
 */

const { createTestDatabase } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createSettingsRepository = require('@server/store/repositories/SettingsRepository');

describe('SettingsRepository conformance', () => {
  let dbCleanup;
  let repo;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createSettingsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('get returns null for a missing key', async () => {
    await expect(repo.get(`nope-${Date.now()}`)).resolves.toBeNull();
  });

  it('set/get round-trips a plaintext string value', async () => {
    const key = `conf.get.${Date.now()}`;
    await repo.set(key, 'plain-value');
    await expect(repo.get(key)).resolves.toBe('plain-value');
  });

  it('set overwrites an existing key (upsert)', async () => {
    const key = `conf.upsert.${Date.now()}`;
    await repo.set(key, 'first');
    await repo.set(key, 'second');
    await expect(repo.get(key)).resolves.toBe('second');
  });

  it('getAll returns a key->value map including written rows', async () => {
    const key = `conf.all.${Date.now()}`;
    await repo.set(key, 'all-value');
    const all = await repo.getAll();
    expect(all[key]).toBe('all-value');
  });

  it('listRows returns rows with key, value and updated_at', async () => {
    const key = `conf.rows.${Date.now()}`;
    await repo.set(key, 'row-value');
    const rows = await repo.listRows();
    const row = rows.find((r) => r.key === key);
    expect(row).toBeDefined();
    expect(row.value).toBe('row-value');
    expect(row.updated_at).toBeDefined();
  });

  it('normalises non-string values to strings on write', async () => {
    const key = `conf.num.${Date.now()}`;
    await repo.set(key, 42);
    await expect(repo.get(key)).resolves.toBe('42');
  });
});
