/**
 * selectiveDelete service tests.
 * Verifies selective recursive deletion with permission callbacks.
 * @see docs/spec/server/services/selectiveDelete.md
 */
const { selectiveDelete } = require('../selectiveDelete');
const { createWebdavMock } = require('@testing/mocks/webdavMock');

const alwaysEnter = () => true;
const alwaysDelete = () => true;

describe('selectiveDelete', () => {
  describe('delete single file with permission', () => {
    it('deletes the file and includes it in deletedPaths', async () => {
      const webdav = createWebdavMock({
        listDirectory: jest.fn().mockResolvedValue([
          { basename: 'file.txt', type: 'file' },
        ]),
      });

      const result = await selectiveDelete({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canDeleteFileByParent: alwaysDelete,
        webdav,
      });

      expect(result.deletedPaths).toContain('/dir/file.txt');
      expect(webdav.deleteFile).toHaveBeenCalledWith('/dir/file.txt', { isDirectory: false });
    });
  });

  describe('skip file without delete permission', () => {
    it('adds the file to skippedPaths and not deletedPaths', async () => {
      const webdav = createWebdavMock({
        listDirectory: jest.fn().mockResolvedValue([
          { basename: 'file.txt', type: 'file' },
        ]),
      });

      const result = await selectiveDelete({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canDeleteFileByParent: () => false,
        webdav,
      });

      expect(result.skippedPaths).toContain('/dir/file.txt');
      expect(result.deletedPaths).not.toContain('/dir/file.txt');
      expect(webdav.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('meta-path protection', () => {
    it('throws 403 when root is /.wea and allowMetaPath is false', async () => {
      await expect(
        selectiveDelete({
          rootPath: '/.wea',
          canEnterDirectory: alwaysEnter,
          canDeleteFileByParent: alwaysDelete,
        })
      ).rejects.toThrow();
    });
  });

  describe('missing callbacks', () => {
    it('throws 400 when canEnterDirectory is not provided', async () => {
      await expect(
        selectiveDelete({
          rootPath: '/dir',
          canDeleteFileByParent: alwaysDelete,
        })
      ).rejects.toThrow();
    });

    it('throws 400 when canDeleteFileByParent is not provided', async () => {
      await expect(
        selectiveDelete({
          rootPath: '/dir',
          canEnterDirectory: alwaysEnter,
        })
      ).rejects.toThrow();
    });
  });

  describe('recursive delete', () => {
    it('enters dir, deletes children, then deletes the dir itself', async () => {
      const webdav = createWebdavMock({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'subdir', type: 'directory' },
          ])
          .mockResolvedValueOnce([
            { basename: 'file.txt', type: 'file' },
          ]),
      });

      const result = await selectiveDelete({
        rootPath: '/root',
        canEnterDirectory: alwaysEnter,
        canDeleteFileByParent: alwaysDelete,
        webdav,
      });

      expect(result.deletedPaths).toContain('/root/subdir/file.txt');
      expect(result.deletedPaths).toContain('/root/subdir');
      expect(result.deletedDirPrefixes).toContain('/root/subdir');
    });
  });

  describe('partial skip in subtree', () => {
    it('does not delete the parent dir when a child is skipped', async () => {
      const webdav = createWebdavMock({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'file1.txt', type: 'file' },
            { basename: 'file2.txt', type: 'file' },
          ]),
      });

      const result = await selectiveDelete({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canDeleteFileByParent: (filePath) => filePath === '/dir/file1.txt',
        webdav,
      });

      expect(result.deletedPaths).toContain('/dir/file1.txt');
      expect(result.skippedPaths).toContain('/dir/file2.txt');
      expect(result.deletedDirPrefixes).not.toContain('/dir');
    });
  });

  describe('async callback support', () => {
    it('awaits Promise-returning canEnterDirectory', async () => {
      const webdav = createWebdavMock({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'subdir', type: 'directory' },
          ])
          .mockResolvedValueOnce([]),
      });

      const result = await selectiveDelete({
        rootPath: '/root',
        canEnterDirectory: async (dirPath) => {
          return dirPath === '/root' || dirPath === '/root/subdir';
        },
        canDeleteFileByParent: alwaysDelete,
        webdav,
      });

      expect(result.deletedDirPrefixes).toContain('/root/subdir');
    });
  });
});
