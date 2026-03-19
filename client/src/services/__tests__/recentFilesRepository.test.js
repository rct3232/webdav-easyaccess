/**
 * recentFilesRepository tests.
 */
import { normalizePath } from '../../utils/pathUtils';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../recentFilesNotifier', () => ({
  notifyRecentFilesChange: jest.fn(),
}));

import { get, post, del } from '../apiClient';
import { notifyRecentFilesChange } from '../recentFilesNotifier';
import {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  applyRecentFilesAfterRename,
  applyRecentFilesAfterBulkDelete,
  applyRecentFilesAfterBulkMove,
} from '../recentFilesRepository';

describe('recentFilesRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRecentFiles', () => {
    it('returns [] on GET error', async () => {
      get.mockRejectedValueOnce(new Error('Network error'));
      const result = await getRecentFiles();
      expect(result).toEqual([]);
    });

    it('returns list from GET /recent-files', async () => {
      const list = [{ path: '/a', type: 'file', name: 'a' }];
      get.mockResolvedValueOnce({ data: list });
      const result = await getRecentFiles();
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(result).toEqual(list);
    });
  });

  describe('addRecentFile', () => {
    it('notifies and returns updated list unless silent', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [{ path: '/new', type: 'file' }] });

      const result = await addRecentFile({ path: '/new', name: 'new', type: 'file' });

      expect(post).toHaveBeenCalledWith(
        '/recent-files',
        expect.objectContaining({ path: normalizePath('/new'), name: 'new', type: 'file' })
      );
      expect(getRecentFiles).toBeDefined();
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ path: '/new', type: 'file' }]);
    });

    it('skips notify and refresh when silent=true', async () => {
      post.mockResolvedValueOnce({});
      const result = await addRecentFile({ path: '/x', name: 'x', type: 'file' }, { silent: true });

      expect(post).toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns fallback list without notifying when persistence fails', async () => {
      post.mockRejectedValueOnce(new Error('save failed'));
      get.mockResolvedValueOnce({ data: [{ path: '/existing', type: 'file' }] });

      const result = await addRecentFile({ path: '/x', name: 'x', type: 'file' });

      expect(result).toEqual([{ path: '/existing', type: 'file' }]);
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
    });
  });

  describe('removeRecentFile', () => {
    it('notifies when silent is not enabled', async () => {
      del.mockResolvedValueOnce({ data: [{ path: '/a', type: 'file' }] });

      const result = await removeRecentFile('/a');

      expect(del).toHaveBeenCalledWith(`/recent-files/${encodeURIComponent(normalizePath('/a'))}`);
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ path: '/a', type: 'file' }]);
    });

    it('skips notify when silent=true', async () => {
      del.mockResolvedValueOnce({ data: [] });
      const result = await removeRecentFile('/a', { silent: true });

      expect(del).toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('clearRecentFiles', () => {
    it('clears all recent files and notifies once on success', async () => {
      del.mockResolvedValueOnce({});

      await clearRecentFiles();

      expect(del).toHaveBeenCalledWith('/recent-files');
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
    });

    it('does not notify when clear fails', async () => {
      del.mockRejectedValueOnce(new Error('clear failed'));

      await clearRecentFiles();

      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
    });
  });

  describe('applyRecentFilesAfterRename', () => {
    it('for file renames: removes old and adds new, then refreshes + notifies', async () => {
      del.mockResolvedValueOnce({ data: [] });
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [{ path: '/new', type: 'file' }] });

      const result = await applyRecentFilesAfterRename('/old', '/new', {
        type: 'file',
        name: 'new',
        basename: 'new',
      });

      expect(del).toHaveBeenCalledWith(
        `/recent-files/${encodeURIComponent(normalizePath('/old'))}`
      );
      // removeRecentFile is called internally with { silent: true }, so no notify during internal operations.
      expect(post).toHaveBeenCalledWith(
        '/recent-files',
        expect.objectContaining({ path: normalizePath('/new') })
      );
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ path: '/new', type: 'file' }]);
    });

    it('for directory renames: updates subpaths using pure planning helpers', async () => {
      const initialRecent = [
        { path: '/old/sub', type: 'directory', name: 'sub', basename: 'sub' },
        { path: '/old/sub/file.txt', type: 'file', name: 'file.txt', basename: 'file.txt' },
        { path: '/other/keep.txt', type: 'file', name: 'keep.txt', basename: 'keep.txt' },
      ];
      const updatedRecent = [
        { path: '/new/sub/file.txt', type: 'file', name: 'file.txt', basename: 'file.txt' },
      ];

      // First refresh for planning, second refresh for result.
      get.mockResolvedValueOnce({ data: initialRecent });
      get.mockResolvedValueOnce({ data: updatedRecent });

      del.mockResolvedValue({ data: [] });
      post.mockResolvedValue({});

      const result = await applyRecentFilesAfterRename('/old', '/new', {
        type: 'directory',
        name: 'new',
        basename: 'new',
      });

      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedRecent);

      // Removed: includes directory + file recent entries under old.
      expect(del).toHaveBeenCalledWith(`/recent-files/${encodeURIComponent(normalizePath('/old/sub'))}`);
      expect(del).toHaveBeenCalledWith(
        `/recent-files/${encodeURIComponent(normalizePath('/old/sub/file.txt'))}`
      );

      // Added: only non-directory entries under old.
      expect(post).toHaveBeenCalledWith(
        '/recent-files',
        expect.objectContaining({ path: normalizePath('/new/sub/file.txt') })
      );
    });
  });

  describe('applyRecentFilesAfterBulkDelete', () => {
    it('uses batch remove endpoint and notifies once', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [{ path: '/a', type: 'file' }] });

      const result = await applyRecentFilesAfterBulkDelete({
        filePaths: ['/a'],
        folderPaths: ['/f'],
      });

      expect(post).toHaveBeenCalledWith('/recent-files/remove-paths', {
        filePaths: ['/a'],
        folderPaths: ['/f'],
      });
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ path: '/a', type: 'file' }]);
    });

    it('with empty payload returns GET result and does not notify', async () => {
      get.mockResolvedValueOnce({ data: [] });
      const result = await applyRecentFilesAfterBulkDelete({ filePaths: [], folderPaths: [] });

      expect(post).not.toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('applyRecentFilesAfterBulkMove', () => {
    it('uses apply-moves endpoint and notifies once', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({ data: [{ path: '/b', type: 'file' }] });

      const result = await applyRecentFilesAfterBulkMove([
        { oldPath: '/a', newPath: '/b', file: { type: 'file', name: 'a', basename: 'a' } },
      ]);

      expect(post).toHaveBeenCalledWith('/recent-files/apply-moves', {
        moves: [
          expect.objectContaining({
            oldPath: '/a',
            newPath: '/b',
          }),
        ],
      });
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ path: '/b', type: 'file' }]);
    });

    it('with empty moves returns GET result and does not notify', async () => {
      get.mockResolvedValueOnce({ data: [] });
      const result = await applyRecentFilesAfterBulkMove([]);

      expect(post).not.toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});

