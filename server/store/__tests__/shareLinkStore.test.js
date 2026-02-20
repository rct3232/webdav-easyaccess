/**
 * shareLinkStore tests.
 * Verifies createShareLink, getShareLink, getUserShareLinks, updateShareLink, deleteShareLink,
 * incrementDownloadCount, isLinkExpired.
 */
const shareLinkStore = require('../shareLinkStore');
const { createTestDatabase, createAuthenticatedTestUser } = require('../../test-utils');

describe('shareLinkStore', () => {
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

  describe('createShareLink / getShareLink', () => {
    it('creates and retrieves link by token', async () => {
      const link = await shareLinkStore.createShareLink({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      expect(link).toMatchObject({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
        createdBy: userId,
        downloadCount: 0,
      });

      const retrieved = await shareLinkStore.getShareLink('test-token-abc');
      expect(retrieved).toMatchObject({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
        createdBy: userId,
      });
    });

    it('getShareLink returns null for unknown token', async () => {
      const link = await shareLinkStore.getShareLink('nonexistent-token-xyz');
      expect(link).toBeNull();
    });
  });

  describe('getUserShareLinks', () => {
    it('returns links created by user', async () => {
      await shareLinkStore.createShareLink({
        token: 'user-link-1',
        filePath: '/a.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      const links = await shareLinkStore.getUserShareLinks(userId);
      expect(links.some((l) => l.token === 'user-link-1')).toBe(true);
    });
  });

  describe('updateShareLink', () => {
    it('updates link', async () => {
      await shareLinkStore.createShareLink({
        token: 'update-token',
        filePath: '/x.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      const updated = await shareLinkStore.updateShareLink('update-token', {
        downloadCount: 5,
      });
      expect(updated.downloadCount).toBe(5);
    });
  });

  describe('incrementDownloadCount', () => {
    it('increments count', async () => {
      await shareLinkStore.createShareLink({
        token: 'inc-token',
        filePath: '/inc.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      const after = await shareLinkStore.incrementDownloadCount('inc-token');
      expect(after.downloadCount).toBe(1);
    });
  });

  describe('isLinkExpired', () => {
    it('returns false when expiresAt is null', () => {
      expect(shareLinkStore.isLinkExpired({ expiresAt: null })).toBe(false);
    });

    it('returns true when expiresAt is in past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      expect(shareLinkStore.isLinkExpired({ expiresAt: past.toISOString() })).toBe(true);
    });
  });

  describe('deleteShareLink', () => {
    it('removes link', async () => {
      await shareLinkStore.createShareLink({
        token: 'delete-token',
        filePath: '/del.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      await shareLinkStore.deleteShareLink('delete-token');
      const link = await shareLinkStore.getShareLink('delete-token');
      expect(link).toBeNull();
    });
  });
});
