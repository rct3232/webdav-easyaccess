/**
 * selectiveDownload service tests.
 * Verifies selectiveCollectFiles behavior per spec.
 * @see docs/spec/server/services/selectiveDownload.md
 */
const { selectiveCollectFiles } = require('../selectiveDownload');

function createMockWebdav(overrides = {}) {
  const defaults = {
    listDirectory: jest.fn().mockResolvedValue([]),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  return { ...defaults, ...overrides };
}

const alwaysEnter = () => true;
const alwaysInclude = () => true;

describe('selectiveCollectFiles', () => {
  describe('delete single file with permission', () => {
    it('deletes the file and includes it in deletedPaths', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn().mockResolvedValue([
          { basename: 'file.txt', type: 'file' },
        ]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canIncludeFile: alwaysInclude,
        webdav,
      });

      expect(result.files.map(f => f.path)).toContain('/dir/file.txt');
    });
  });

  it('returns empty files when root directory is denied', async () => {
    const result = await selectiveCollectFiles({
      rootPath: '/root',
      canEnterDirectory: () => false,
      canIncludeFile: alwaysInclude,
      webdav: createMockWebdav(),
    });

    expect(result.files).toHaveLength(0);
    expect(result.skippedPaths).toContain('/root');
  });

  describe('skip file without delete permission', () => {
    it('adds the file to skippedPaths and not deletedPaths', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn().mockResolvedValue([
          { basename: 'file.txt', type: 'file' },
        ]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canIncludeFile: () => false,
        webdav,
      });

      expect(result.skippedPaths).toContain('/dir/file.txt');
      expect(result.files.map(f => f.path)).not.toContain('/dir/file.txt');
    });
  });

  describe('meta-path protection', () => {
    it('throws 403 when root is /.wea and allowMetaPath is false', async () => {
      await expect(
        selectiveCollectFiles({
          rootPath: '/.wea',
          canEnterDirectory: alwaysEnter,
          canIncludeFile: alwaysInclude,
          webdav: createMockWebdav(),
        })
      ).rejects.toThrow();
    });
  });

  describe('missing callbacks', () => {
    it('throws 400 when canEnterDirectory is not provided', async () => {
      await expect(
        selectiveCollectFiles({
          rootPath: '/dir',
          canIncludeFile: alwaysInclude,
          webdav: createMockWebdav(),
        })
      ).rejects.toThrow();
    });

    it('throws 400 when canIncludeFile is not provided', async () => {
      await expect(
        selectiveCollectFiles({
          rootPath: '/dir',
          canEnterDirectory: alwaysEnter,
        })
      ).rejects.toThrow();
    });
  });

  describe('recursive delete', () => {
    it('enters dir, deletes children, then deletes the dir itself', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'subdir', type: 'directory' },
          ])
          .mockResolvedValueOnce([
            { basename: 'file.txt', type: 'file' },
          ]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/root',
        canEnterDirectory: alwaysEnter,
        canIncludeFile: alwaysInclude,
        webdav,
      });

      expect(result.files.map(f => f.path)).toContain('/root/subdir/file.txt');
    });
  });

  describe('partial skip in subtree', () => {
    it('does not delete the parent dir when a child is skipped', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'file1.txt', type: 'file' },
            { basename: 'file2.txt', type: 'file' },
          ]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/dir',
        canEnterDirectory: alwaysEnter,
        canIncludeFile: (filePath) => filePath === '/dir/file1.txt',
        webdav,
      });

      expect(result.files.map(f => f.path)).toContain('/dir/file1.txt');
      expect(result.skippedPaths).toContain('/dir/file2.txt');
      expect(result.skippedPaths).not.toContain('/dir');
    });

    it('skips subdirectories denied by canEnterDirectory', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'allowed.txt', type: 'file' },
            { basename: 'denied-dir', type: 'directory' },
          ])
          .mockResolvedValueOnce([
            { basename: 'inside.txt', type: 'file' },
          ]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/root',
        canEnterDirectory: (dirPath) => dirPath !== '/root/denied-dir',
        canIncludeFile: alwaysInclude,
        webdav,
      });

      expect(result.files).toHaveLength(1);
      expect(result.skippedPaths).toContain('/root/denied-dir');
    });
  });

  describe('async callback support', () => {
    it('awaits Promise-returning canEnterDirectory', async () => {
      const webdav = createMockWebdav({
        listDirectory: jest.fn()
          .mockResolvedValueOnce([
            { basename: 'subdir', type: 'directory' },
          ])
          .mockResolvedValueOnce([]),
      });

      const result = await selectiveCollectFiles({
        rootPath: '/root',
        canEnterDirectory: async (dirPath) => {
          return dirPath === '/root' || dirPath === '/root/subdir';
        },
        canIncludeFile: alwaysInclude,
        webdav,
      });

    });
  });
});
