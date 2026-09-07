'use strict';

/**
 * ShareLinkRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createShareLinkRepository = require('@server/store/repositories/ShareLinkRepository');

describe('ShareLinkRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;
  let userId;

  const uniqueToken = () => `tok-${Date.now()}-${++seq}`;

  // share_links.file_node_id / created_by are NOT NULL FKs — create real rows.
  const uniqueNode = async (tag) => {
    const node = await createTestFileNode({ name: `sl-${Date.now()}-${tag}.txt` });
    return Number(node.nodeId);
  };

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createShareLinkRepository(storage.getExecutor());

    const User = require('@server/models/User');
    const username = `conf-sl-${Date.now()}`;
    const user = await User.create(username, `${username}@conf.test`, 'pw', false);
    userId = user.id;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('create/get round-trips the canonical link object', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(1);
    const link = await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });
    expect(link.token).toBe(token);
    expect(link.fileNodeId).toBe(nodeId);
    expect(link.nodeId).toBe(nodeId);
    expect(link.createdBy).toBe(Number(userId));
    expect(link.downloadCount).toBe(0);
    expect(typeof link.createdAt).toBe('string');

    const fetched = await repo.getShareLink(token);
    expect(fetched.token).toBe(token);
  });

  it('create is idempotent for an existing token', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(2);
    const first = await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });
    const second = await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });
    expect(second.fileNodeId).toBe(nodeId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('getShareLink returns null for an unknown token', async () => {
    await expect(repo.getShareLink(`missing-${Date.now()}`)).resolves.toBeNull();
  });

  it('expiresInDays produces a future expiresAt', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(3);
    const link = await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId, expiresInDays: 7 });
    expect(link.expiresAt).not.toBeNull();
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('getUserShareLinks lists newest first for the owner', async () => {
    const nodeId = await uniqueNode(4);
    const t1 = uniqueToken();
    const t2 = uniqueToken();
    await repo.createShareLink({ token: t1, fileNodeId: nodeId, createdBy: userId });
    // created_at has second-granularity on sqlite — space the two inserts out.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await repo.createShareLink({ token: t2, fileNodeId: nodeId, createdBy: userId });

    const links = await repo.getUserShareLinks(userId);
    const tokens = links.map((l) => l.token);
    expect(tokens.indexOf(t2)).toBeLessThan(tokens.indexOf(t1));
    expect(second.createdBy).toBe(Number(userId));
  });

  it('updateShareLink patches expiresAt / downloadCount and 404s unknown tokens', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(5);
    await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const updated = await repo.updateShareLink(token, { expiresAt: future, downloadCount: 3 });
    expect(updated.expiresAt).toBe(future);
    expect(updated.downloadCount).toBe(3);

    await expect(repo.updateShareLink(`missing-${Date.now()}`, { downloadCount: 1 })).rejects.toMatchObject(
      { status: 404 }
    );
  });

  it('incrementDownloadCount is atomic and 404s unknown tokens', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(6);
    await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });

    const after1 = await repo.incrementDownloadCount(token);
    expect(after1.downloadCount).toBe(1);
    const after2 = await repo.incrementDownloadCount(token);
    expect(after2.downloadCount).toBe(2);

    await expect(repo.incrementDownloadCount(`missing-${Date.now()}`)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deleteShareLink removes the row', async () => {
    const token = uniqueToken();
    const nodeId = await uniqueNode(7);
    await repo.createShareLink({ token, fileNodeId: nodeId, createdBy: userId });
    await repo.deleteShareLink(token);
    await expect(repo.getShareLink(token)).resolves.toBeNull();
  });
});
