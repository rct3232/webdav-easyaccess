/**
 * Unit tests for ShareLink model
 */

const ShareLink = require('../ShareLink');
const {
  setupTestStore,
  resetTestStore,
  teardownTestStore
} = require('../../test-utils');

describe('ShareLink Model', () => {
  beforeAll(async () => {
    await setupTestStore();
  });

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  describe('create', () => {
    it('should create a new share link', async () => {
      const link = await ShareLink.create('/test/file.txt', 1);

      expect(link).toBeDefined();
      expect(link.token).toBeDefined();
      expect(typeof link.token).toBe('string');
      expect(link.filePath).toBe('/test/file.txt');
      expect(link.createdBy).toBe(1);
      expect(link.expiresAt).toBeDefined();
    });

    it('should create a share link with custom expiration', async () => {
      const link = await ShareLink.create('/test/file.txt', 1, 30);
      expect(link.expiresAt).toBeDefined();
      
      const expiresAt = new Date(link.expiresAt);
      const now = new Date();
      const diffDays = Math.round((expiresAt - now) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(30);
    });

    it('should generate unique tokens', async () => {
      const link1 = await ShareLink.create('/file1.txt', 1);
      const link2 = await ShareLink.create('/file2.txt', 1);
      expect(link1.token).not.toBe(link2.token);
    });
  });

  describe('findByToken', () => {
    it('should find a link by token', async () => {
      const created = await ShareLink.create('/test/file.txt', 1);
      const found = await ShareLink.findByToken(created.token);

      expect(found).toBeDefined();
      expect(found.token).toBe(created.token);
      expect(found.filePath).toBe('/test/file.txt');
    });

    it('should return null for non-existent token', async () => {
      const found = await ShareLink.findByToken('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all links for a user', async () => {
      await ShareLink.create('/file1.txt', 1);
      await ShareLink.create('/file2.txt', 1);
      await ShareLink.create('/file3.txt', 2);

      const links = await ShareLink.findByUserId(1);
      expect(links).toHaveLength(2);
      expect(links.every(l => l.createdBy === 1)).toBe(true);
    });

    it('should return empty array for user with no links', async () => {
      const links = await ShareLink.findByUserId(999);
      expect(links).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update a share link', async () => {
      const created = await ShareLink.create('/test/file.txt', 1);
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const updates = { expiresAt: newExpiry };
      
      const updated = await ShareLink.update(created.token, updates);
      expect(updated.expiresAt).toBe(newExpiry);

      const found = await ShareLink.findByToken(created.token);
      expect(found.expiresAt).toBe(newExpiry);
    });
  });

  describe('delete', () => {
    it('should delete a share link', async () => {
      const created = await ShareLink.create('/test/file.txt', 1);
      await ShareLink.delete(created.token);

      const found = await ShareLink.findByToken(created.token);
      expect(found).toBeNull();
    });
  });

  describe('incrementDownloadCount', () => {
    it('should increment download count', async () => {
      const created = await ShareLink.create('/test/file.txt', 1);
      expect(created.downloadCount).toBe(0);

      await ShareLink.incrementDownloadCount(created.token);
      const updated = await ShareLink.findByToken(created.token);
      expect(updated.downloadCount).toBe(1);

      await ShareLink.incrementDownloadCount(created.token);
      const updated2 = await ShareLink.findByToken(created.token);
      expect(updated2.downloadCount).toBe(2);
    });
  });

  describe('isExpired', () => {
    it('should return false for new link', async () => {
      const link = await ShareLink.create('/test/file.txt', 1);
      expect(ShareLink.isExpired(link)).toBe(false);
    });

    it('should return false for link with null expiration', async () => {
      const link = await ShareLink.create('/test/file.txt', 1, null);
      expect(ShareLink.isExpired(link)).toBe(false);
    });

    it('should return true for expired link', async () => {
      const link = {
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      };
      expect(ShareLink.isExpired(link)).toBe(true);
    });
  });
});
