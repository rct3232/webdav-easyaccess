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
  downloadFile,
  createFolder,
  getFolderStats,
  uploadMultipleFiles,
  batchMoveFiles,
  batchCopyFiles,
  getBulkOperationStatus,
  cancelBulkOperation,
  checkConflicts,
} from '../fileService';

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFilesMetadata', () => {
    it('returns [] when paths empty, post not called', async () => {
      const result = await getFilesMetadata([]);

      expect(result).toEqual([]);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('getFileBlob', () => {
    it('passes inline and shareToken in params and headers when provided', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await getFileBlob('/a.pdf', { inline: true, shareToken: 't' });

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: expect.objectContaining({
          path: '/a.pdf',
          inline: 'true',
          shareToken: 't',
        }),
        headers: expect.objectContaining({ 'X-Share-Token': 't' }),
        responseType: 'blob',
      }));
    });
  });

  describe('createFolder', () => {
    it('calls POST /folders/create', async () => {
      post.mockResolvedValueOnce({ data: { messageCode: 'folderCreated', path: '/foo/bar' } });

      await createFolder('/foo/bar');

      expect(post).toHaveBeenCalledWith('/folders/create', { path: '/foo/bar' });
    });
  });

  describe('getFolderStats', () => {
    it('calls GET /folders/stats with path param and returns fileCount and totalSize', async () => {
      get.mockResolvedValueOnce({ data: { fileCount: 10, totalSize: 2048 } });

      const result = await getFolderStats('/my/folder');

      expect(get).toHaveBeenCalledWith(
        '/folders/stats',
        expect.objectContaining({
          params: { path: '/my/folder' },
        })
      );
      expect(result).toHaveProperty('fileCount', 10);
      expect(result).toHaveProperty('totalSize', 2048);
    });
  });

  describe('downloadFile', () => {
    it('calls get with path only, no options (auth-only)', async () => {
      get.mockResolvedValueOnce({ data: new Blob(['x']) });

      await downloadFile('/a.pdf');

      expect(get).toHaveBeenCalledWith('/files/download', expect.objectContaining({
        params: { path: '/a.pdf' },
        responseType: 'blob',
      }));
      const callArgs = get.mock.calls[0];
      expect(callArgs[1].params).not.toHaveProperty('shareToken');
      expect(callArgs[1].headers || {}).not.toHaveProperty('X-Share-Token');
    });
  });

  describe('listFiles', () => {
    it('returns array of file items', async () => {
      const items = [
        { path: '/test.txt', basename: 'test.txt', type: 'file', size: 0 },
        { path: '/folder', basename: 'folder', type: 'directory', size: 0 },
      ];
      get.mockResolvedValueOnce({ data: items });

      const result = await listFiles('/');

      expect(get).toHaveBeenCalledWith('/files/list', expect.objectContaining({
        params: expect.objectContaining({ path: '/' }),
      }));
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('path');
      expect(result[0]).toHaveProperty('basename');
      expect(result[0]).toHaveProperty('type');
    });

    it('passes shareToken when provided', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await listFiles('/folder', { shareToken: 'my-share-token' });

      expect(get).toHaveBeenCalledWith('/files/list', expect.objectContaining({
        params: expect.objectContaining({ path: '/folder', shareToken: 'my-share-token' }),
        headers: expect.objectContaining({ 'X-Share-Token': 'my-share-token' }),
      }));
    });

    it('listFiles("") uses normalized path (root /) per spec', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await listFiles('');

      expect(get).toHaveBeenCalledWith('/files/list', expect.objectContaining({
        params: expect.objectContaining({ path: '/' }),
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
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', path: '/file1.txt' } });
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', path: '/file2.txt' } });

      const result = await uploadMultipleFiles(files, '/', onProgress);

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
      const result = await uploadMultipleFiles([{ file, relativePath: '' }], '/', onProgress);
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
      post.mockResolvedValueOnce({ data: { messageCode: 'uploadSuccess', path: '/a.txt' } });
      post.mockRejectedValueOnce(
        Object.assign(new Error('Conflict'), {
          response: { status: 409, data: { errorCode: 'serverErrors.files.conflict' } },
        })
      );

      const result = await uploadMultipleFiles(files, '/', onProgress);

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
        { sourcePath: '/a.txt', destinationPath: '/b/a.txt' },
      ]);

      expect(post).toHaveBeenCalledWith('/files/batch-move', {
        moves: [{ sourcePath: '/a.txt', destinationPath: '/b/a.txt' }],
        onConflict: 'error',
      });
      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toBe('job-123');
    });

    it('batchCopyFiles returns jobId', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-456' } });

      const result = await batchCopyFiles([
        { sourcePath: '/a.txt', destinationPath: '/copy/a.txt' },
      ]);

      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toBe('job-456');
    });

    it('getBulkOperationStatus returns status for jobId', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-x' } });
      get.mockResolvedValueOnce({
        data: { status: 'completed', progress: 1, total: 1, results: [] },
      });

      await batchMoveFiles([{ sourcePath: '/x.txt', destinationPath: '/y/x.txt' }]);
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
        [{ sourcePath: '/a.txt', destinationPath: '/b/a.txt' }],
        'overwrite'
      );

      expect(post).toHaveBeenCalledWith('/files/batch-move', {
        moves: [{ sourcePath: '/a.txt', destinationPath: '/b/a.txt' }],
        onConflict: 'overwrite',
      });
    });

    it('batchCopyFiles passes onConflict option', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'job-skip' } });

      await batchCopyFiles(
        [{ sourcePath: '/x.txt', destinationPath: '/y/x.txt' }],
        'skip'
      );

      expect(post).toHaveBeenCalledWith('/files/batch-copy', {
        copies: [{ sourcePath: '/x.txt', destinationPath: '/y/x.txt' }],
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

  describe('checkConflicts', () => {
    it('returns conflicts array', async () => {
      post.mockResolvedValueOnce({ data: { conflicts: [] } });

      const result = await checkConflicts([
        { sourcePath: '/a.txt', destinationPath: '/b/a.txt', operation: 'move' },
      ]);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('returns conflicts when server reports them', async () => {
      post.mockResolvedValueOnce({
        data: {
          conflicts: [
            { sourcePath: '/a.txt', destinationPath: '/b/a.txt', reason: 'exists' },
          ],
        },
      });

      const result = await checkConflicts([
        { sourcePath: '/a.txt', destinationPath: '/b/a.txt', operation: 'move' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourcePath: '/a.txt',
        destinationPath: '/b/a.txt',
        reason: 'exists',
      });
    });
  });
});
