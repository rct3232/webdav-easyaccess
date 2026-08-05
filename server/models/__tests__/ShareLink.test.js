/**
 * ShareLink model tests.
 * Verifies create, findByToken, findByUserId, update, delete, incrementDownloadCount, isExpired.
 */
const ShareLink = require('../ShareLink');
const { createTestDatabase, createAuthenticatedTestUser, createTestFileNode } = require('../../test-utils');

describe('ShareLink model', () => {
  let dbCleanup;
  let userId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const { user } = await createAuthenticatedTestUser();
    userId = user.id;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('create', () => {
    it('creates a share link and returns token, nodeId, createdBy', async () => {
      const { nodeId } = await createTestFileNode({ name: 'report.pdf' });
      const result = await ShareLink.create(nodeId, userId, 14);
      expect(result).toMatchObject({
        nodeId,
        createdBy: userId,
        downloadCount: 0,
      });
      expect(result.filePath).toBeUndefined();
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.createdAt).toBeDefined();
    });

    it('creates link with null expiresInDays (no expiration)', async () => {
      const { nodeId } = await createTestFileNode({ name: 'forever.txt' });
      const result = await ShareLink.create(nodeId, userId, null);
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('findByToken', () => {
    it('returns link when token exists', async () => {
      const { nodeId } = await createTestFileNode({ name: 'find-me.pdf' });
      const created = await ShareLink.create(nodeId, userId, 7);
      const link = await ShareLink.findByToken(created.token);
      expect(link).toMatchObject({
        token: created.token,
        nodeId,
        createdBy: userId,
      });
    });

    it('returns null when token does not exist', async () => {
      const link = await ShareLink.findByToken('nonexistent-token-xyz');
      expect(link).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns links created by user', async () => {
      const node1 = await createTestFileNode({ name: 'user-link1.pdf' });
      const node2 = await createTestFileNode({ name: 'user-link2.pdf' });
      await ShareLink.create(node1.nodeId, userId, 7);
      await ShareLink.create(node2.nodeId, userId, 7);
      const links = await ShareLink.findByUserId(userId);
      expect(links.length).toBeGreaterThanOrEqual(2);
      links.forEach((l) => expect(l.createdBy).toBe(userId));
    });
  });

  describe('update', () => {
    it('updates link and returns updated data', async () => {
      const { nodeId } = await createTestFileNode({ name: 'update-me.pdf' });
      const created = await ShareLink.create(nodeId, userId, 7);
      const updated = await ShareLink.update(created.token, { expiresInDays: 30 });
      expect(updated).toBeDefined();
      expect(updated.nodeId).toBe(nodeId);
    });
  });

  describe('incrementDownloadCount', () => {
    it('increments downloadCount', async () => {
      const { nodeId } = await createTestFileNode({ name: 'download-me.pdf' });
      const created = await ShareLink.create(nodeId, userId, 7);
      expect(created.downloadCount).toBe(0);
      const after = await ShareLink.incrementDownloadCount(created.token);
      expect(after.downloadCount).toBe(1);
      const again = await ShareLink.incrementDownloadCount(created.token);
      expect(again.downloadCount).toBe(2);
    });
  });

  describe('isExpired', () => {
    it('returns false when expiresAt is null', () => {
      const link = { expiresAt: null };
      expect(ShareLink.isExpired(link)).toBe(false);
    });

    it('returns false when expiresAt is in future', () => {
      const future = new Date();
      future.setDate(future.getDate() + 7);
      const link = { expiresAt: future.toISOString() };
      expect(ShareLink.isExpired(link)).toBe(false);
    });

    it('returns true when expiresAt is in past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const link = { expiresAt: past.toISOString() };
      expect(ShareLink.isExpired(link)).toBe(true);
    });
  });

  describe('delete', () => {
    it('removes link so findByToken returns null', async () => {
      const { nodeId } = await createTestFileNode({ name: 'delete-me.pdf' });
      const created = await ShareLink.create(nodeId, userId, 7);
      await ShareLink.delete(created.token);
      const link = await ShareLink.findByToken(created.token);
      expect(link).toBeNull();
    });
  });
});
