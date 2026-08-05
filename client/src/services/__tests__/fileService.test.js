/**
 * fileService tests.
 * Uses apiClient mock: MSW + axios in Node has compat issues (200 body empty, FormData blob read).
 * Tests verify fileService behavior per spec.
 * @see docs/spec/client/services/fileService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post, put } from '../apiClient';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

jest.mock('../permissionService', () => ({
  checkPermission: jest.fn(),
  grantPermission: jest.fn(),
  revokePermission: jest.fn(),
  listFilePermissions: jest.fn(),
}));

import {
  listFiles,
  getFilesMetadata,
  getFileBlob,
  getVideoPreviewStreamUrl,
  downloadFile,
  createFolder,
  getFolderStats,
  uploadMultipleFiles,
  batchMoveFiles,
  batchCopyFiles,
  getBulkOperationStatus,
  cancelBulkOperation,
  checkConflicts,
  requestThumbnailsBatch,
} from '../fileService';

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFilesMetadata', () => {
    it('returns [] when nodeIds empty, post not called', async () => {
      const result = await getFilesMetadata([]);

      expect(result).toEqual([]);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('getFileBlob', () => {
    it('passes inline and shareToken in params and headers when provided', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await getFileBlob(42, { inline: true, shareToken: 't' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: expect.objectContaining({
          nodeId: 42,
          inline: 'true',
          shareToken: 't',
        }),
        headers: expect.objectContaining({ 'X-Share-Token': 't' }),
        responseType: 'blob',
      }));
    });
  });

  describe('getVideoPreviewStreamUrl', () => {
    it('requests preview ticket and returns preview-stream URL', async () => {
      post.mockResolvedValueOnce({ data: { ticket: 'ticket123' } });

      const url = await getVideoPreviewStreamUrl(7);

      expect(post).toHaveBeenCalledWith(
        '/files/preview-ticket',
        { nodeId: 7 },
        expect.any(Object)
      );
      expect(url).toContain('/api/files/preview-stream?');
      expect(url).toContain('ticket=ticket123');
      expect(url).toContain('nodeId=7');
    });

    it('passes shareToken in body and headers when provided', async () => {
      post.mockResolvedValueOnce({ data: { ticket: 't' } });

      await getVideoPreviewStreamUrl(7, { shareToken: 'st' });

      expect(post).toHaveBeenCalledWith(
        '/files/preview-ticket',
        { nodeId: 7, shareToken: 'st' },
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Share-Token': 'st' }),
        })
      );
    });
  });

  describe('createFolder', () => {
    it('calls POST /folders/create with parentNodeId and name', async () => {
      post.mockResolvedValueOnce({ data: { messageCode: 'folderCreated', nodeId: 99 } });

      await createFolder(3, 'bar');

      expect(post).toHaveBeenCalledWith('/folders/create', { parentNodeId: 3, name: 'bar' });
    });
  });

  describe('getFolderStats', () => {
    it('calls GET /folders/stats with nodeId param and returns fileCount and totalSize', async () => {
      get.mockResolvedValueOnce({ data: { fileCount: 10, totalSize: 2048 } });

      const result = await getFolderStats(5);

      expect(get).toHaveBeenCalledWith(
        '/folders/stats',
        expect.objectContaining({
          params: { nodeId: 5 },
        })
      );
      expect(result).toHaveProperty('fileCount', 10);
      expect(result).toHaveProperty('totalSize', 2048);
    });
  });

  describe('downloadFile', () => {
    it('calls get with nodeId only, no options (auth-only)', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await downloadFile(1);

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { nodeId: 1 },
        responseType: 'blob',
      }));
      const callArgs = get.mock.calls[0];
      expect(callArgs[1].params).not.toHaveProperty('shareToken');
      expect(callArgs[1].headers || {}).not.toHaveProperty('X-Share-Token');
    });

    it('passes shareToken in params and headers when provided', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await downloadFile(2, { shareToken: 'st' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { nodeId: 2, shareToken: 'st' },
        responseType: 'blob',
        headers: { 'X-Share-Token': 'st' },
      }));
    });

    it('passes options.fileName for display; non-image uses default download', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await downloadFile(3, { fileName: 'doc.pdf' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { nodeId: 3 },
      }));
    });

    it('on iOS when canShare({ files }) returns true uses share sheet', async () => {
      const shareMock = jest.fn().mockResolvedValue(undefined);
      const canShareMock = jest.fn().mockReturnValue(true);
      const origNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {
          ...origNavigator,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          platform: 'iPhone',
          canShare: canShareMock,
          share: shareMock,
        },
        configurable: true,
      });
      get.mockResolvedValueOnce({ data: new Blob(['content']) });

      await downloadFile(4, { fileName: 'p.jpg' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { nodeId: 4 },
        responseType: 'blob',
      }));
      expect(canShareMock).toHaveBeenCalledWith({ files: [expect.any(File)] });
      expect(shareMock).toHaveBeenCalledTimes(1);
      expect(shareMock.mock.calls[0][0]).toMatchObject({ files: [expect.any(File)] });
      Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
    });

    it('on iOS when canShare returns false uses fallback download', async () => {
      const canShareMock = jest.fn().mockReturnValue(false);
      const origNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: {
          ...origNavigator,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          platform: 'iPhone',
          canShare: canShareMock,
        },
        configurable: true,
      });
      get.mockResolvedValueOnce({ data: new Blob(['content']) });

      await downloadFile(5, { fileName: 'doc.pdf' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { nodeId: 5 },
        responseType: 'blob',
      }));
      expect(canShareMock).toHaveBeenCalledWith({ files: [expect.any(File)] });
      Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
    });
  });

  describe('listFiles', () => {
    it('returns array of file items', async () => {
      const items = [
        { nodeId: 1, path: '/test.txt', basename: 'test.txt', type: 'file', size: 0 },
        { nodeId: 2, path: '/folder', basename: 'folder', type: 'directory', size: 0 },
      ];
      get.mockResolvedValueOnce({ data: items });

      const result = await listFiles(1);

      expect(get).toHaveBeenCalledWith('/files/list', expect.objectContaining({
        params: expect.objectContaining({ nodeId: 1 }),
      }));
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('nodeId');
      expect(result[0]).toHaveProperty('basename');
      expect(result[0]).toHaveProperty('type');
    });

    it('passes shareToken when provided', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await listFiles(3, { shareToken: 'my-share-token' });

      expect(get).toHaveBeenCalledWith('/files/list', expect.objectContaining({
        params: expect.objectContaining({ nodeId: 3, shareToken: 'my-share-token' }),
        headers: expect.objectContaining({ 'X-Share-Token': 'my-share-token' }),
      }));
    });
  });

  describe('uploadMultipleFiles', () => {
    it('calls onProgress and returns results/errors', async () => {
      const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
      const file2 = new File(['content2'], 'file2.txt', { type: 'text/plain' });
      const files = [
        { file: file1, relativePath: '' },
        { file: file2, relativePath: '' },
      ];
      const onProgress = jest.fn();
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', nodeId: 10 } });
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', nodeId: 11 } });

      const result = await uploadMultipleFiles(files, 1, onProgress);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.results)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls.some((c) => c[0]?.status === 'uploading')).toBe(true);
      expect(onProgress.mock.calls.some((c) => c[0]?.status === 'success')).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('populates errors on upload failure', async () => {
      const file = new File(['x'], 'fail.txt', { type: 'text/plain' });
      const onProgress = jest.fn();
      const err = Object.assign(new Error('Fail'), {
        response: { status: 400, data: { errorCode: 'serverErrors.files.invalidPath' } },
      });
      post.mockRejectedValueOnce(err);

      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await uploadMultipleFiles([{ file, relativePath: '' }], 1, onProgress);
      spy.mockRestore();

      expect(result.errors).toHaveLength(1);
      expect(result.results).toHaveLength(0);
    });

    it('partial success: returns results and errors structure', async () => {
      const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
      const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });
      const files = [
        { file: file1, relativePath: 'a.txt' },
        { file: file2, relativePath: 'b.txt' },
      ];
      const onProgress = jest.fn();
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', nodeId: 10 } });
      post.mockRejectedValueOnce(
        Object.assign(new Error('Conflict'), {
          response: { status: 409, data: { errorCode: 'serverErrors.files.conflict' } },
        })
      );

      const result = await uploadMultipleFiles(files, 1, onProgress);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('errors');
      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
      expect(result.errors[0]).toMatchObject({
        relativePath: 'b.txt',
        error: expect.any(String),
      });
    });
  });

  describe('batchMoveFiles / batchCopyFiles', () => {
    it('batchMoveFiles returns jobId', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-123' } });

      const result = await batchMoveFiles([
        { sourceNodeId: 1, destinationParentNodeId: 5 },
      ]);

      expect(post).toHaveBeenCalledWith('/files/batch-move', {
        moves: [{ sourceNodeId: 1, destinationParentNodeId: 5 }],
        onConflict: 'error',
      });
      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toBe('job-123');
    });

    it('batchCopyFiles returns jobId', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-456' } });

      const result = await batchCopyFiles([
        { sourceNodeId: 1, destinationParentNodeId: 3 },
      ]);

      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toBe('job-456');
    });

    it('getBulkOperationStatus returns status for jobId', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-x' } });
      get.mockResolvedValueOnce({
        data: { status: 'completed', progress: 1, total: 1, results: [] },
      });

      await batchMoveFiles([{ sourceNodeId: 1, destinationParentNodeId: 2 }]);
      const status = await getBulkOperationStatus('job-x');

      expect(get).toHaveBeenCalledWith(expect.stringContaining('job-x'));
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('progress');
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('results');
    });

    it('getBulkOperationStatus returns error for unknown jobId', async () => {
      get.mockRejectedValueOnce(new Error('404'));

      await expect(getBulkOperationStatus('nonexistent-job-id')).rejects.toThrow();
    });

    it('batchMoveFiles passes onConflict option', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-overwrite' } });

      await batchMoveFiles(
        [{ sourceNodeId: 1, destinationParentNodeId: 2 }],
        'overwrite'
      );

      expect(post).toHaveBeenCalledWith('/files/batch-move', {
        moves: [{ sourceNodeId: 1, destinationParentNodeId: 2 }],
        onConflict: 'overwrite',
      });
    });

    it('batchCopyFiles passes onConflict option', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-skip' } });

      await batchCopyFiles(
        [{ sourceNodeId: 3, destinationParentNodeId: 4 }],
        'skip'
      );

      expect(post).toHaveBeenCalledWith('/files/batch-copy', {
        copies: [{ sourceNodeId: 3, destinationParentNodeId: 4 }],
        onConflict: 'skip',
      });
    });
  });

  describe('cancelBulkOperation', () => {
    it('404 for non-existent job: throws or returns per implementation', async () => {
      const err = Object.assign(new Error('Not found'), {
        response: { status: 404, data: { errorCode: 'serverErrors.files.jobNotFound' } },
      });
      post.mockRejectedValueOnce(err);

      await expect(cancelBulkOperation('nonexistent-job')).rejects.toThrow();
    });
  });

  describe('requestThumbnailsBatch', () => {
    it('posts { nodeIds } to /thumbnails/batch (apiClient prefixes /api)', async () => {
      post.mockResolvedValueOnce({
        data: { thumbnails: [{ nodeId: 7, thumbnailUrl: 'http://thumb/a.jpg' }] },
      });

      const result = await requestThumbnailsBatch([7, 8]);

      expect(post).toHaveBeenCalledWith(
        '/thumbnails/batch',
        { nodeIds: [7, 8] },
        expect.any(Object)
      );
      expect(result).toHaveProperty('thumbnails');
      expect(result.thumbnails[0]).toMatchObject({ nodeId: 7 });
    });

    it('passes shareToken in body and headers when provided', async () => {
      post.mockResolvedValueOnce({ data: { thumbnails: [] } });

      await requestThumbnailsBatch([7], { shareToken: 'st' });

      expect(post).toHaveBeenCalledWith(
        '/thumbnails/batch',
        { nodeIds: [7], shareToken: 'st' },
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Share-Token': 'st' }),
        })
      );
    });
  });

  describe('checkConflicts', () => {
    it('returns conflicts array', async () => {
      post.mockResolvedValueOnce({ data: { conflicts: [] } });

      const result = await checkConflicts([
        { sourceNodeId: 1, destinationParentNodeId: 2, type: 'move' },
      ]);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('returns conflicts when server reports them', async () => {
      post.mockResolvedValueOnce({
        data: {
          conflicts: [
            { sourceNodeId: 1, destinationParentNodeId: 2, reason: 'exists' },
          ],
        },
      });

      const result = await checkConflicts([
        { sourceNodeId: 1, destinationParentNodeId: 2, type: 'move' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceNodeId: 1,
        destinationParentNodeId: 2,
        reason: 'exists',
      });
    });
  });
});
