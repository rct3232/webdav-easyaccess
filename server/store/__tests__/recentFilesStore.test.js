/**
 * recentFilesStore tests.
 * Verifies addRecentFile dedupe/cap, applyBulkMove, removePaths.
 */
const recentFilesStore = require('../recentFilesStore');
const { createTestDatabase, createAuthenticatedTestUser } = require('../../test-utils');

describe('recentFilesStore', () => {
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

  describe('addRecentFile', () => {
    it('adds file to empty list', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      const result = await recentFilesStore.addRecentFile(userId, {
        path: '/docs/file1.pdf',
        name: 'file1.pdf',
        type: 'file',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        path: '/docs/file1.pdf',
        name: 'file1.pdf',
        type: 'file',
      });
    });

    it('dedupes by path: re-adding same path moves to front', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/a.pdf', name: 'a.pdf' });
      await recentFilesStore.addRecentFile(userId, { path: '/b.pdf', name: 'b.pdf' });
      const after = await recentFilesStore.addRecentFile(userId, { path: '/a.pdf', name: 'a.pdf' });
      expect(after).toHaveLength(2);
      expect(after[0].path).toBe('/a.pdf');
      expect(after[1].path).toBe('/b.pdf');
    });

    it('caps at MAX_RECENT_FILES (20)', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      for (let i = 0; i < 25; i++) {
        await recentFilesStore.addRecentFile(userId, {
          path: `/file${i}.txt`,
          name: `file${i}.txt`,
        });
      }
      const list = await recentFilesStore.getUserRecentFiles(userId);
      expect(list.length).toBe(20);
    });
  });

  describe('removeRecentFile', () => {
    it('removes file by path', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/remove-me.pdf', name: 'remove-me.pdf' });
      const after = await recentFilesStore.removeRecentFile(userId, '/remove-me.pdf');
      expect(after).toHaveLength(0);
    });
  });

  describe('applyBulkMove', () => {
    it('updates paths for file move', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/old/loc.txt', name: 'loc.txt' });
      const result = await recentFilesStore.applyBulkMove(userId, [
        { oldPath: '/old/loc.txt', newPath: '/new/loc.txt', file: { type: 'file', name: 'loc.txt' } },
      ]);
      expect(result.some((f) => f.path === '/new/loc.txt')).toBe(true);
      expect(result.some((f) => f.path === '/old/loc.txt')).toBe(false);
    });

    it('updates paths for directory move (subpaths)', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/folder/a.pdf', name: 'a.pdf' });
      await recentFilesStore.addRecentFile(userId, { path: '/folder/sub/b.pdf', name: 'b.pdf' });
      const result = await recentFilesStore.applyBulkMove(userId, [
        { oldPath: '/folder', newPath: '/moved', file: { type: 'directory' } },
      ]);
      expect(result.some((f) => f.path === '/moved/a.pdf')).toBe(true);
      expect(result.some((f) => f.path === '/moved/sub/b.pdf')).toBe(true);
      expect(result.some((f) => f.path.startsWith('/folder'))).toBe(false);
    });
  });

  describe('removePaths', () => {
    it('removes specified file paths', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/del1.txt', name: 'del1.txt' });
      await recentFilesStore.addRecentFile(userId, { path: '/keep.txt', name: 'keep.txt' });
      const result = await recentFilesStore.removePaths(userId, ['/del1.txt'], []);
      expect(result.some((f) => f.path === '/del1.txt')).toBe(false);
      expect(result.some((f) => f.path === '/keep.txt')).toBe(true);
    });

    it('removes paths under folderPaths', async () => {
      await recentFilesStore.clearRecentFiles(userId);
      await recentFilesStore.addRecentFile(userId, { path: '/folder/x.pdf', name: 'x.pdf' });
      await recentFilesStore.addRecentFile(userId, { path: '/other/y.pdf', name: 'y.pdf' });
      const result = await recentFilesStore.removePaths(userId, [], ['/folder']);
      expect(result.some((f) => f.path.startsWith('/folder'))).toBe(false);
      expect(result.some((f) => f.path === '/other/y.pdf')).toBe(true);
    });
  });
});
