/**
 * WebDAV utils tests.
 * @see docs/spec/server/utils/webdav.md
 */
const { getRecursiveFolderStats } = require('../webdav');

describe('webdav - getRecursiveFolderStats', () => {
  /** @type {jest.Mock} */
  let listDir;

  beforeEach(() => {
    listDir = jest.fn();
  });

  it('returns fileCount and totalSize for a folder', async () => {
    listDir
      .mockResolvedValueOnce([
        { type: 'file', size: 100, basename: 'a.txt', filename: '/test/a.txt' },
        { type: 'directory', basename: 'sub', filename: '/test/sub' },
      ])
      .mockResolvedValueOnce([
        { type: 'file', size: 50, basename: 'b.txt', filename: '/test/sub/b.txt' },
      ]);

    const result = await getRecursiveFolderStats('/test', listDir);

    expect(result).toHaveProperty('fileCount', 2);
    expect(result).toHaveProperty('totalSize', 150);
  });

  it('returns fileCount and totalSize for empty folder', async () => {
    listDir.mockResolvedValueOnce([]);

    const result = await getRecursiveFolderStats('/empty', listDir);

    expect(result).toEqual({ fileCount: 0, totalSize: 0 });
  });
});
