/**
 * recentFiles tests: getRecentFiles, onRecentFilesChange, add/remove/clear,
 * updateSubPathsOnPathChange, removeSubPathsOnFolderDelete, removeMultiplePaths,
 * applyRecentFilesAfterRename, applyRecentFilesAfterBulkDelete, applyRecentFilesAfterBulkMove.
 * @see docs/spec/client/utils/recentFiles.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post, del } from '../../services/apiClient';

jest.mock('../../services/apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  del: jest.fn(),
}));

import {
  getRecentFiles,
  onRecentFilesChange,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  updateSubPathsOnPathChange,
  removeSubPathsOnFolderDelete,
  removeMultiplePaths,
  applyRecentFilesAfterRename,
  applyRecentFilesAfterBulkDelete,
  applyRecentFilesAfterBulkMove,
} from '../recentFiles';

describe('recentFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRecentFiles', () => {
    it('returns array from GET /recent-files', async () => {
      const list = [{ path: '/a', name: 'a', type: 'file' }];
      get.mockResolvedValueOnce({ data: list });

      const result = await getRecentFiles();

      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(list);
    });

    it('returns empty array on error', async () => {
      get.mockRejectedValueOnce(new Error('Network error'));

      const result = await getRecentFiles();

      expect(result).toEqual([]);
    });
  });

  describe('onRecentFilesChange', () => {
    it('returns unsubscribe that removes listener', async () => {
      const callback = jest.fn();
      const unsub = onRecentFilesChange(callback);

      get.mockResolvedValue({ data: [] });
      post.mockResolvedValue({});
      await addRecentFile({ path: '/f', name: 'f', type: 'file' });

      expect(callback).toHaveBeenCalled();

      callback.mockClear();
      unsub();
      await addRecentFile({ path: '/g', name: 'g', type: 'file' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('addRecentFile', () => {
    it('calls POST /recent-files with normalized path and notifies unless silent', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [{ path: '/f', name: 'f' }] });

      const result = await addRecentFile({ path: '/f', name: 'f', type: 'file' });

      expect(post).toHaveBeenCalledWith('/recent-files', expect.objectContaining({
        path: '/f',
        name: 'f',
        type: 'file',
      }));
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns [] and skips getRecentFiles/notify when silent', async () => {
      post.mockResolvedValueOnce({});

      const result = await addRecentFile(
        { path: '/f', name: 'f', type: 'file' },
        { silent: true }
      );

      expect(post).toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('removeRecentFile', () => {
    it('calls DELETE /recent-files/:encodedPath and returns array', async () => {
      del.mockResolvedValueOnce({ data: [] });

      const result = await removeRecentFile('/a/file.txt');

      expect(del).toHaveBeenCalledWith('/recent-files/%2Fa%2Ffile.txt');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns [] on error', async () => {
      del.mockRejectedValueOnce(new Error('Failed'));

      const result = await removeRecentFile('/x');

      expect(result).toEqual([]);
    });
  });

  describe('clearRecentFiles', () => {
    it('calls DELETE /recent-files', async () => {
      del.mockResolvedValueOnce({});

      await clearRecentFiles();

      expect(del).toHaveBeenCalledWith('/recent-files');
    });
  });

  describe('updateSubPathsOnPathChange', () => {
    it('calls getRecentFiles and updates sub-paths', async () => {
      get
        .mockResolvedValueOnce({ data: [{ path: '/old/sub', name: 'sub', type: 'file', basename: 'sub' }] })
        .mockResolvedValueOnce({ data: [] });
      del.mockResolvedValue({ data: [] });
      post.mockResolvedValue({});

      const result = await updateSubPathsOnPathChange('/old', '/new');

      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('removeSubPathsOnFolderDelete', () => {
    it('removes entries under folderPath and returns array', async () => {
      get
        .mockResolvedValueOnce({ data: [{ path: '/folder/child', name: 'child', type: 'file' }] })
        .mockResolvedValueOnce({ data: [] });
      del.mockResolvedValue({ data: [] });

      const result = await removeSubPathsOnFolderDelete('/folder');

      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(del).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('removeMultiplePaths', () => {
    it('removes matching paths and returns array', async () => {
      get
        .mockResolvedValueOnce({ data: [{ path: '/a', name: 'a', type: 'file' }] })
        .mockResolvedValueOnce({ data: [] });
      del.mockResolvedValue({ data: [] });

      const result = await removeMultiplePaths(['/a']);

      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('applyRecentFilesAfterRename', () => {
    it('removes old path and adds new path for file', async () => {
      del.mockResolvedValueOnce({ data: [] });
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [] });

      const result = await applyRecentFilesAfterRename('/old', '/new', {
        type: 'file',
        name: 'f',
        basename: 'f',
      });

      expect(del).toHaveBeenCalledWith(expect.stringContaining('old'));
      expect(post).toHaveBeenCalledWith('/recent-files', expect.any(Object));
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('applyRecentFilesAfterBulkDelete', () => {
    it('calls POST /recent-files/remove-paths and returns array', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [] });

      const result = await applyRecentFilesAfterBulkDelete(['/a'], ['/b']);

      expect(post).toHaveBeenCalledWith('/recent-files/remove-paths', {
        filePaths: ['/a'],
        folderPaths: ['/b'],
      });
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns getRecentFiles() when filePaths and folderPaths empty', async () => {
      get.mockResolvedValueOnce({ data: [] });

      const result = await applyRecentFilesAfterBulkDelete([], []);

      expect(post).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(result).toEqual([]);
    });
  });

  describe('applyRecentFilesAfterBulkMove', () => {
    it('calls POST /recent-files/apply-moves and returns array', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [] });

      const result = await applyRecentFilesAfterBulkMove([
        { oldPath: '/a', newPath: '/b', file: { type: 'file', name: 'f', basename: 'f' } },
      ]);

      expect(post).toHaveBeenCalledWith('/recent-files/apply-moves', {
        moves: expect.arrayContaining([
          expect.objectContaining({ oldPath: '/a', newPath: '/b' }),
        ]),
      });
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns getRecentFiles() when moves empty', async () => {
      get.mockResolvedValueOnce({ data: [] });

      const result = await applyRecentFilesAfterBulkMove([]);

      expect(post).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(result).toEqual([]);
    });
  });
});
