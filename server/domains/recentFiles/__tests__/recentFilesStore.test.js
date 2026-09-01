/**
 * recentFilesService tests (nodeId contract).
 * Verifies addRecentFile dedupe/reorder, cap at 20, removeRecentFile, clearRecentFiles.
 */
const recentFilesService = require('../service');
const composition = require('../../../service/composition');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
} = require('../../../test-utils');

describe('recentFilesService (nodeId)', () => {
  let dbCleanup;
  let userId;
  let prevFileStorage;

  beforeAll(async () => {
    prevFileStorage = process.env.WEA_FILE_STORAGE;
    process.env.WEA_FILE_STORAGE = 'webdav';
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const { user } = await createAuthenticatedTestUser();
    userId = user.id;
    composition.__setCompositionForTests({ fileNodesStore: createFileNodesStore() });
  });

  afterAll(async () => {
    composition.resetComposition();
    if (prevFileStorage === undefined) {
      delete process.env.WEA_FILE_STORAGE;
    } else {
      process.env.WEA_FILE_STORAGE = prevFileStorage;
    }
    await dbCleanup?.();
  });

  beforeEach(async () => {
    await recentFilesService.clearRecentFiles(userId);
  });

  describe('addRecentFile', () => {
    it('adds file to empty list', async () => {
      const { nodeId } = await createTestFileNode({ name: 'add-1.txt' });

      const result = await recentFilesService.addRecentFile(userId, nodeId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        fileNodeId: nodeId,
        name: 'add-1.txt',
        type: 'file',
      });
      expect(result[0].displayPath).toBe('/add-1.txt');
    });

    it('dedupes by fileNodeId: re-adding same node moves to front', async () => {
      const a = await createTestFileNode({ name: 'dedupe-a.txt' });
      const b = await createTestFileNode({ name: 'dedupe-b.txt' });

      await recentFilesService.addRecentFile(userId, a.nodeId);
      await recentFilesService.addRecentFile(userId, b.nodeId);
      const after = await recentFilesService.addRecentFile(userId, a.nodeId);

      expect(after).toHaveLength(2);
      expect(after[0].fileNodeId).toBe(a.nodeId);
      expect(after[1].fileNodeId).toBe(b.nodeId);
    });

    it('caps at MAX_RECENT_FILES (20)', async () => {
      for (let i = 0; i < 25; i++) {
        const { nodeId } = await createTestFileNode({ name: `cap-${i}.txt` });
        await recentFilesService.addRecentFile(userId, nodeId);
      }

      const list = await recentFilesService.getRecentFiles(userId);
      expect(list.length).toBe(20);
    });

    it('throws pathRequired for missing or invalid fileNodeId', async () => {
      await expect(recentFilesService.addRecentFile(userId, undefined)).rejects.toThrow(
        'pathRequired'
      );
      await expect(recentFilesService.addRecentFile(userId, null)).rejects.toThrow('pathRequired');
      await expect(recentFilesService.addRecentFile(userId, NaN)).rejects.toThrow('pathRequired');
      await expect(recentFilesService.addRecentFile(userId, 'not-a-number')).rejects.toThrow(
        'pathRequired'
      );
    });

    it('rejects with 404 when node does not exist', async () => {
      await expect(recentFilesService.addRecentFile(userId, 999999)).rejects.toMatchObject({
        status: 404,
        message: 'fileNotFound',
      });
    });
  });

  describe('removeRecentFile', () => {
    it('removes file by fileNodeId', async () => {
      const a = await createTestFileNode({ name: 'remove-a.txt' });
      const b = await createTestFileNode({ name: 'remove-b.txt' });

      await recentFilesService.addRecentFile(userId, a.nodeId);
      await recentFilesService.addRecentFile(userId, b.nodeId);
      const after = await recentFilesService.removeRecentFile(userId, a.nodeId);

      expect(after.some((f) => f.fileNodeId === a.nodeId)).toBe(false);
      expect(after.some((f) => f.fileNodeId === b.nodeId)).toBe(true);
    });
  });

  describe('clearRecentFiles', () => {
    it('clears all entries', async () => {
      const a = await createTestFileNode({ name: 'clear-a.txt' });
      const b = await createTestFileNode({ name: 'clear-b.txt' });
      await recentFilesService.addRecentFile(userId, a.nodeId);
      await recentFilesService.addRecentFile(userId, b.nodeId);

      await recentFilesService.clearRecentFiles(userId);

      const list = await recentFilesService.getRecentFiles(userId);
      expect(list).toHaveLength(0);
    });
  });
});
