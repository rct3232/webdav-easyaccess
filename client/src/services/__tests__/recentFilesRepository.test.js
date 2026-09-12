/**
 * recentFilesRepository tests.
 */
import { normalizePath } from '../../utils/pathUtils';

import { get, post, del } from '../apiClient';
import { notifyRecentFilesChange } from '../recentFilesNotifier';
import { getRecentFiles, addRecentFile, removeRecentFile } from '../recentFilesRepository';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../recentFilesNotifier', () => ({
  notifyRecentFilesChange: jest.fn(),
}));

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

    it('returns list from GET /recent-files mapping fileNodeId to nodeId', async () => {
      const list = [{ fileNodeId: 1, name: 'a', type: 'file', displayPath: '/a' }];
      get.mockResolvedValueOnce({ data: list });
      const result = await getRecentFiles();
      expect(get).toHaveBeenCalledWith('/recent-files');
      expect(result).toEqual([
        expect.objectContaining({
          nodeId: 1,
          name: 'a',
          type: 'file',
          path: normalizePath('/a'),
          displayPath: normalizePath('/a'),
        }),
      ]);
    });
  });

  describe('addRecentFile', () => {
    it('posts fileNodeId and returns refreshed list, notifies', async () => {
      post.mockResolvedValueOnce({});
      get.mockResolvedValueOnce({
        data: [{ fileNodeId: 7, name: 'new', type: 'file', displayPath: '/new' }],
      });

      const result = await addRecentFile({ nodeId: 7, name: 'new', type: 'file' });

      expect(post).toHaveBeenCalledWith('/recent-files', { fileNodeId: 7 });
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        expect.objectContaining({ nodeId: 7, path: '/new', displayPath: '/new' }),
      ]);
    });

    it('skips notify and refresh when silent=true', async () => {
      post.mockResolvedValueOnce({});
      const result = await addRecentFile({ nodeId: 1, name: 'x', type: 'file' }, { silent: true });

      expect(post).toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns fallback list without notifying when persistence fails', async () => {
      post.mockRejectedValueOnce(new Error('save failed'));
      get.mockResolvedValueOnce({
        data: [{ fileNodeId: 2, name: 'existing', type: 'file', displayPath: '/existing' }],
      });

      const result = await addRecentFile({ nodeId: 1, name: 'x', type: 'file' });

      expect(result).toEqual([expect.objectContaining({ nodeId: 2, path: '/existing' })]);
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
    });
  });

  describe('removeRecentFile', () => {
    it('deletes by numeric nodeId and notifies', async () => {
      del.mockResolvedValueOnce({
        data: [{ fileNodeId: 5, name: 'a', type: 'file', displayPath: '/a' }],
      });

      const result = await removeRecentFile(5);

      expect(del).toHaveBeenCalledWith('/recent-files/5');
      expect(notifyRecentFilesChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual([expect.objectContaining({ nodeId: 5, path: '/a' })]);
    });

    it('skips notify when silent=true', async () => {
      del.mockResolvedValueOnce({ data: [] });
      const result = await removeRecentFile(5, { silent: true });

      expect(del).toHaveBeenCalled();
      expect(notifyRecentFilesChange).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
