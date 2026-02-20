/**
 * storage tests.
 * Verifies ensureDir, exists, readFile, writeFile, deletePath, listDir with FS backend in test.
 */
const storage = require('../storage');
const { createTestDatabase } = require('../../test-utils');

describe('storage store', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('ensureDir / exists', () => {
    it('creates dir and exists returns true', async () => {
      await storage.ensureDir('/.wea/storage-test-dir');
      const ok = await storage.exists('/.wea/storage-test-dir');
      expect(ok).toBe(true);
    });

    it('exists returns false for non-existent path', async () => {
      const ok = await storage.exists('/.wea/nonexistent-path-xyz');
      expect(ok).toBe(false);
    });
  });

  describe('writeFile / readFile', () => {
    it('writes and reads file', async () => {
      const path = '/.wea/storage-test.txt';
      const content = 'hello storage test';
      await storage.writeFile(path, content, { overwrite: true });
      const buf = await storage.readFile(path);
      const text = Buffer.from(buf).toString('utf8');
      expect(text).toBe(content);
    });
  });

  describe('deletePath', () => {
    it('removes file so exists returns false', async () => {
      const path = '/.wea/storage-delete-test.txt';
      await storage.writeFile(path, 'temp', { overwrite: true });
      await storage.deletePath(path);
      const ok = await storage.exists(path);
      expect(ok).toBe(false);
    });
  });

  describe('listDir', () => {
    it('returns entries for existing dir', async () => {
      const items = await storage.listDir('/.wea');
      expect(Array.isArray(items)).toBe(true);
    });

    it('throws when EACCES (permission denied)', async () => {
      const fsp = require('fs/promises');
      const spy = jest.spyOn(fsp, 'readdir').mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      );
      await expect(storage.listDir('/.wea')).rejects.toMatchObject({ code: 'EACCES' });
      spy.mockRestore();
    });
  });

  describe('writeFile error handling', () => {
    it('throws when ENOSPC (disk full)', async () => {
      const fsp = require('fs/promises');
      const spy = jest.spyOn(fsp, 'writeFile').mockRejectedValueOnce(
        Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })
      );
      await expect(storage.writeFile('/.wea/enospc-test.txt', 'x', { overwrite: true })).rejects.toMatchObject({
        code: 'ENOSPC',
      });
      spy.mockRestore();
    });
  });
});
