'use strict';

/**
 * FileLikesRepository L2 conformance
 * (docs/spec/server/store/fileLikesStore.md §2.7). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 */

const { createTestDatabase, createUserRootNode, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createFileLikesRepository = require('@server/store/repositories/FileLikesRepository');

describe('FileLikesRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createFileLikesRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueUser = async () => {
    seq += 1;
    const stamp = `${Date.now()}-${seq}`;
    const User = require('@server/models/User');
    const user = await User.create(`conf-fl-${stamp}`, `conf-fl-${stamp}@conf.test`, 'pw', false);
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

  it('isLiked is false for data never liked', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`fl-${Date.now()}-1.txt`);
    await expect(repo.isLiked(user.id, node.nodeId)).resolves.toBe(false);
  });

  it('addLike inserts once and re-like is a no-op (changes: 0, no error)', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`fl-${Date.now()}-2.txt`);

    const first = await repo.addLike(user.id, node.nodeId);
    expect(first.changes).toBe(1);

    const second = await repo.addLike(user.id, node.nodeId);
    expect(second.changes).toBe(0);

    await expect(repo.isLiked(user.id, node.nodeId)).resolves.toBe(true);
    await expect(repo.listLikedNodeIds(user.id)).resolves.toEqual([Number(node.nodeId)]);
  });

  it('removeLike deletes the pair; unliked removal reports changes: 0', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`fl-${Date.now()}-3.txt`);

    const removedUnliked = await repo.removeLike(user.id, node.nodeId);
    expect(removedUnliked.changes).toBe(0);

    await repo.addLike(user.id, node.nodeId);
    const removed = await repo.removeLike(user.id, node.nodeId);
    expect(removed.changes).toBe(1);
    await expect(repo.isLiked(user.id, node.nodeId)).resolves.toBe(false);
  });

  it("filterLiked intersects the viewer's own likes and preserves input order", async () => {
    const user = await uniqueUser();
    const other = await uniqueUser();
    const n1 = await uniqueNode(`fl-${Date.now()}-4.txt`);
    const n2 = await uniqueNode(`fl-${Date.now()}-5.txt`);
    const n3 = await uniqueNode(`fl-${Date.now()}-6.txt`);

    await repo.addLike(user.id, n1.nodeId);
    await repo.addLike(user.id, n3.nodeId);
    // Another viewer's like must never leak into the first viewer's filter.
    await repo.addLike(other.id, n2.nodeId);

    const liked = await repo.filterLiked(user.id, [n3.nodeId, n2.nodeId, n1.nodeId]);
    expect(liked).toEqual([Number(n3.nodeId), Number(n1.nodeId)]);
  });

  it('rejects a like on an unknown node (FK enforced)', async () => {
    const user = await uniqueUser();
    await expect(repo.addLike(user.id, 999999999)).rejects.toBeDefined();
  });

  it('trashed nodes keep their like row; purging the node cascades it away', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`fl-${Date.now()}-7.txt`);
    await repo.addLike(user.id, node.nodeId);

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.markSubtreeDeleted([node.nodeId]);
    await expect(repo.isLiked(user.id, node.nodeId)).resolves.toBe(true);

    await fileNodesStore.deleteNodeTree([node.nodeId]);
    await expect(repo.isLiked(user.id, node.nodeId)).resolves.toBe(false);
  });

  it('like toggles never write action_journal rows (self-reversing trivial state)', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`fl-${Date.now()}-8.txt`);
    const { rows: before } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');

    await repo.addLike(user.id, node.nodeId);
    await repo.removeLike(user.id, node.nodeId);

    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');
    expect(Number(rows[0].cnt)).toBe(Number(before[0].cnt));
  });
});
