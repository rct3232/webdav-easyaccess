/**
 * ShareLink model tests.
 * Verifies create, findByToken, findByUserId, update, delete, incrementDownloadCount, isExpired.
 */
const ShareLink = require('../ShareLink');
const { createTestDatabase, createAuthenticatedTestUser } = require('../../test-utils');

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
    it('creates a share link and returns token, filePath, createdBy', async () => {
      const result = await ShareLink.create('/docs/report.pdf', userId, 14);
      expect(result).toMatchObject({
        filePath: '/docs/report.pdf',
        createdBy: userId,
        downloadCount: 0,
      });
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.createdAt).toBeDefined();
    });

    it('creates link with null expiresInDays (no expiration)', async () => {
      const result = await ShareLink.create('/docs/forever.txt', userId, null);
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('findByToken', () => {
    it('returns link when token exists', async () => {
      const created = await ShareLink.create('/docs/find-me.pdf', userId, 7);
      const link = await ShareLink.findByToken(created.token);
      expect(link).toMatchObject({
        token: created.token,
        filePath: '/docs/find-me.pdf',
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
      await ShareLink.create('/docs/user-link1.pdf', userId, 7);
      await ShareLink.create('/docs/user-link2.pdf', userId, 7);
      const links = await ShareLink.findByUserId(userId);
      expect(links.length).toBeGreaterThanOrEqual(2);
      links.forEach((l) => expect(l.createdBy).toBe(userId));
    });
  });

  describe('update', () => {
    it('updates link and returns updated data', async () => {
      const created = await ShareLink.create('/docs/update-me.pdf', userId, 7);
      const updated = await ShareLink.update(created.token, { expiresInDays: 30 });
      expect(updated).toBeDefined();
    });
  });

  describe('incrementDownloadCount', () => {
    it('increments downloadCount', async () => {
      const created = await ShareLink.create('/docs/download-me.pdf', userId, 7);
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
      const created = await ShareLink.create('/docs/delete-me.pdf', userId, 7);
      await ShareLink.delete(created.token);
      const link = await ShareLink.findByToken(created.token);
      expect(link).toBeNull();
    });
  });
});
