'use strict';

/**
 * RecentFilesRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 */

const { createTestDatabase, createUserRootNode } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createRecentFilesRepository = require('@server/store/repositories/RecentFilesRepository');

describe('RecentFilesRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createRecentFilesRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueUser = async () => {
    seq += 1;
    const User = require('@server/models/User');
    const user = await User.create(
      `conf-rf-${Date.now()}-${seq}`,
      `${`conf-rf-${Date.now()}-${seq}`}@conf.test`,
      'pw',
      false
    );
    await createUserRootNode({ userId: user.id });
    return user;
  };

  const uniqueNode = async (name) => {
    const { createTestFileNode } = require('@server/test-utils');
    return createTestFileNode({ name });
  };

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('returns an empty list for a user with no entries', async () => {
    const user = await uniqueUser();
    await expect(repo.getUserRecentFiles(user.id)).resolves.toEqual([]);
  });

  it('add/get returns domain-shaped entries newest first', async () => {
    const user = await uniqueUser();
    const n1 = await uniqueNode(`rf-${Date.now()}-1.txt`);
    const n2 = await uniqueNode(`rf-${Date.now()}-2.txt`);

    await repo.addRecentFile(user.id, n1.nodeId);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const list = await repo.addRecentFile(user.id, n2.nodeId);

    expect(list.length).toBe(2);
    expect(list[0].fileNodeId).toBe(Number(n2.nodeId));
    for (const entry of list) {
      expect(typeof entry.fileNodeId).toBe('number');
      expect(entry.lastAccessed).toBeDefined();
    }
  });

  it('re-adding an existing node refreshes it to the top (no duplicate)', async () => {
    const user = await uniqueUser();
    const n1 = await uniqueNode(`rf-${Date.now()}-3.txt`);
    const n2 = await uniqueNode(`rf-${Date.now()}-4.txt`);
    await repo.addRecentFile(user.id, n1.nodeId);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await repo.addRecentFile(user.id, n2.nodeId);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const list = await repo.addRecentFile(user.id, n1.nodeId);

    const ids = list.map((e) => e.fileNodeId);
    expect(ids.filter((id) => id === Number(n1.nodeId))).toHaveLength(1);
    expect(ids[0]).toBe(Number(n1.nodeId));
  });

  it('caps the list at MAX_RECENT_FILES', async () => {
    const user = await uniqueUser();
    const { MAX_RECENT_FILES } = require('@server/store/repositories/RecentFilesRepository');
    for (let i = 0; i < MAX_RECENT_FILES + 3; i += 1) {
      const node = await uniqueNode(`rf-cap-${Date.now()}-${i}.txt`);
      await repo.addRecentFile(user.id, node.nodeId);
    }
    const list = await repo.getUserRecentFiles(user.id);
    expect(list.length).toBe(MAX_RECENT_FILES);
  });

  it('removeRecentFile removes one entry', async () => {
    const user = await uniqueUser();
    const n1 = await uniqueNode(`rf-${Date.now()}-5.txt`);
    await repo.addRecentFile(user.id, n1.nodeId);
    const list = await repo.removeRecentFile(user.id, n1.nodeId);
    expect(list.some((e) => e.fileNodeId === Number(n1.nodeId))).toBe(false);
  });
});
