/**
 * recentFiles pure helper tests.
 * @see docs/spec/client/utils/recentFiles.md
 */
import {
  updateSubPathsOnPathChange,
  removeSubPathsOnFolderDelete,
  removeMultiplePaths,
} from '../recentFiles';

describe('recentFiles (pure helpers)', () => {
  describe('updateSubPathsOnPathChange', () => {
    it('returns empty plan when recentEntries is empty', () => {
      const result = updateSubPathsOnPathChange([], '/old', '/new');
      expect(result).toEqual({ removedPaths: [], addedEntries: [] });
    });

    it('returns empty plan when oldPath equals newPath', () => {
      const result = updateSubPathsOnPathChange(
        [{ path: '/old/file.txt', type: 'file', name: 'file.txt', basename: 'file.txt' }],
        '/old',
        '/old'
      );
      expect(result).toEqual({ removedPaths: [], addedEntries: [] });
    });

    it('removes paths under oldPath and re-adds only non-directory entries under newPath', () => {
      const recentEntries = [
        { path: '/old/file.txt', type: 'file', name: 'file.txt', basename: 'file.txt' },
        { path: '/old/sub', type: 'directory', name: 'sub', basename: 'sub' },
        { path: '/old/sub/child.txt', type: 'file', name: 'child.txt', basename: 'child.txt' },
      ];

      const result = updateSubPathsOnPathChange(recentEntries, '/old', '/new');

      // Removed: exact oldPath match + subpaths (including directories)
      expect(result.removedPaths).toEqual(
        expect.arrayContaining(['/old/file.txt', '/old/sub', '/old/sub/child.txt'])
      );

      // Added: file entries only (directory entries are NOT re-added)
      expect(result.addedEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/new/file.txt',
            name: 'file.txt',
            basename: 'file.txt',
            type: 'file',
          }),
          expect.objectContaining({
            path: '/new/sub/child.txt',
            name: 'child.txt',
            basename: 'child.txt',
            type: 'file',
          }),
        ])
      );

      expect(result.addedEntries.find((e) => e.path === '/new/sub')).toBeUndefined();
    });
  });

  describe('removeSubPathsOnFolderDelete', () => {
    it('removes any recent entry whose normalized path equals folderPath or has folderPath + "/" prefix', () => {
      const recentEntries = [
        { path: '/folder', type: 'directory', name: 'folder' },
        { path: '/folder/a.txt', type: 'file', name: 'a.txt' },
        { path: '/folder/sub/b.txt', type: 'file', name: 'b.txt' },
        { path: '/other/x.txt', type: 'file', name: 'x.txt' },
      ];

      const result = removeSubPathsOnFolderDelete(recentEntries, '/folder');

      expect(result.removedPaths).toEqual(
        expect.arrayContaining(['/folder', '/folder/a.txt', '/folder/sub/b.txt'])
      );
      expect(result.removedPaths).not.toEqual(expect.arrayContaining(['/other/x.txt']));
    });

    it('returns empty removedPaths when recentEntries is empty', () => {
      expect(removeSubPathsOnFolderDelete([], '/folder')).toEqual({ removedPaths: [] });
    });
  });

  describe('removeMultiplePaths', () => {
    it('removes only exact path matches after normalization', () => {
      const recentEntries = [
        { path: '/a', type: 'file', name: 'a' },
        { path: '/a/b', type: 'file', name: 'b' },
        { path: '/b', type: 'file', name: 'broot' },
      ];

      const result = removeMultiplePaths(recentEntries, ['/a', '/b']);

      expect(result.removedPaths).toEqual(expect.arrayContaining(['/a', '/b']));
      expect(result.removedPaths).not.toEqual(expect.arrayContaining(['/a/b']));
    });

    it('returns empty removedPaths when filePaths is empty', () => {
      const recentEntries = [{ path: '/a', type: 'file', name: 'a' }];
      expect(removeMultiplePaths(recentEntries, [])).toEqual({ removedPaths: [] });
    });
  });
});

