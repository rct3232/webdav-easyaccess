import { get, post, put } from '../apiClient';
import {
  listFiles,
  renameFile,
  createFolder,
  getWebDAVInfo,
  uploadFileWithPath,
  uploadMultipleFiles,
  checkConflicts,
  downloadMultipleFiles,
  checkPermission,
  requestThumbnailsBatch,
  batchDeleteFiles,
  batchMoveFiles,
  batchCopyFiles,
  getBulkOperationStatus,
  cancelBulkOperation,
} from '../fileService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic operations', () => {
    it('listFiles calls get with correct params', async () => {
      const mockData = [{ basename: 'file.txt' }];
      get.mockResolvedValue({ data: mockData });

      const result = await listFiles('/test');

      expect(get).toHaveBeenCalledWith('/files/list', { params: { path: '/test' } });
      expect(result).toEqual(mockData);
    });

    it('renameFile calls put with correct body', async () => {
      put.mockResolvedValue({ data: { path: '/test/new.txt' } });

      await renameFile('/test/old.txt', 'new.txt');

      expect(put).toHaveBeenCalledWith('/files/rename', {
        oldPath: '/test/old.txt',
        newName: 'new.txt',
      });
    });

    it('createFolder calls post with correct body', async () => {
      post.mockResolvedValue({ data: { success: true } });

      await createFolder('/test/new-folder');

      expect(post).toHaveBeenCalledWith('/folders/create', { path: '/test/new-folder' });
    });

    it('getWebDAVInfo calls get', async () => {
      const mockInfo = { url: 'http://example.com' };
      get.mockResolvedValue({ data: mockInfo });

      const result = await getWebDAVInfo();

      expect(get).toHaveBeenCalledWith('/webdav/info');
      expect(result).toEqual(mockInfo);
    });
  });

  describe('Upload operations', () => {
    it('uploadFileWithPath calls post with relativePath', async () => {
      post.mockResolvedValue({ data: { success: true } });
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      await uploadFileWithPath(mockFile, '/dest', 'folder/test.txt', 'skip');

      const formData = post.mock.calls[0][1];
      expect(formData.get('relativePath')).toBe('folder/test.txt');
      expect(formData.get('onConflict')).toBe('skip');
    });

    it('uploadMultipleFiles handles multiple files and progress', async () => {
      post.mockResolvedValue({ data: { success: true } });
      const files = [
        { file: new File(['1'], '1.txt'), relativePath: '1.txt' },
        { file: new File(['2'], '2.txt'), relativePath: '2.txt' }
      ];
      const onProgress = jest.fn();

      const result = await uploadMultipleFiles(files, '/dest', onProgress);

      expect(post).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ current: 1, status: 'uploading' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ current: 1, status: 'success' }));
      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('uploadMultipleFiles handles errors and continues', async () => {
      post.mockResolvedValueOnce({ data: { success: true } })
          .mockRejectedValueOnce(new Error('Upload failed'));
      
      const files = [
        { file: new File(['1'], '1.txt'), relativePath: '1.txt' },
        { file: new File(['2'], '2.txt'), relativePath: '2.txt' }
      ];
      const onProgress = jest.fn();

      const result = await uploadMultipleFiles(files, '/dest', onProgress);

      expect(post).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    });
  });

  describe('Complex operations', () => {
    it('batchDeleteFiles calls post with paths array and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'job-123' } });

      const result = await batchDeleteFiles(['/test/file.txt']);

      expect(post).toHaveBeenCalledWith('/files/batch-delete', { paths: ['/test/file.txt'] });
      expect(result.jobId).toBe('job-123');
    });

    it('batchMoveFiles calls post with moves array and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'job-456' } });

      const result = await batchMoveFiles([{ sourcePath: '/src', destinationPath: '/dest' }]);

      expect(post).toHaveBeenCalledWith('/files/batch-move', {
        moves: [{ sourcePath: '/src', destinationPath: '/dest' }],
        onConflict: 'error'
      });
      expect(result.jobId).toBe('job-456');
    });

    it('batchCopyFiles calls post with copies array and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'job-789' } });

      const result = await batchCopyFiles([{ sourcePath: '/src', destinationPath: '/dest' }]);

      expect(post).toHaveBeenCalledWith('/files/batch-copy', {
        copies: [{ sourcePath: '/src', destinationPath: '/dest' }],
        onConflict: 'error'
      });
      expect(result.jobId).toBe('job-789');
    });

    it('checkConflicts calls post', async () => {
      const mockConflicts = [{ path: '/dest', type: 'file' }];
      post.mockResolvedValue({ data: { conflicts: mockConflicts } });

      const result = await checkConflicts([{ sourcePath: '/src', destinationPath: '/dest', type: 'move' }]);

      expect(post).toHaveBeenCalledWith('/files/check-conflicts', expect.any(Object));
      expect(result).toEqual(mockConflicts);
    });

    it('checkPermission calls get', async () => {
      get.mockResolvedValue({ data: { canRead: true } });

      const result = await checkPermission('/path');

      expect(get).toHaveBeenCalledWith('/permissions/check', { params: { path: '/path' } });
      expect(result).toEqual({ canRead: true });
    });
  });

  describe('Batch operations', () => {
    it('batchDeleteFiles calls post and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'j1' } });
      const result = await batchDeleteFiles(['/p1', '/p2']);
      expect(post).toHaveBeenCalledWith('/files/batch-delete', { paths: ['/p1', '/p2'] });
      expect(result.jobId).toBe('j1');
    });

    it('batchMoveFiles calls post and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'j2' } });
      const moves = [{ sourcePath: '/s1', destinationPath: '/d1' }];
      const result = await batchMoveFiles(moves);
      expect(post).toHaveBeenCalledWith('/files/batch-move', { moves, onConflict: 'error' });
      expect(result.jobId).toBe('j2');
    });

    it('batchCopyFiles calls post and returns jobId', async () => {
      post.mockResolvedValue({ data: { jobId: 'j3' } });
      const copies = [{ sourcePath: '/s1', destinationPath: '/d1' }];
      const result = await batchCopyFiles(copies);
      expect(post).toHaveBeenCalledWith('/files/batch-copy', { copies, onConflict: 'error' });
      expect(result.jobId).toBe('j3');
    });

    it('getBulkOperationStatus calls get', async () => {
      get.mockResolvedValue({ data: { status: 'completed', progress: 2, total: 2, results: [] } });
      const result = await getBulkOperationStatus('job-1');
      expect(get).toHaveBeenCalledWith('/files/bulk-operation/job-1');
      expect(result.status).toBe('completed');
    });

    it('cancelBulkOperation calls post', async () => {
      post.mockResolvedValue({ data: { message: 'Cancel requested', jobId: 'job-1' } });
      await cancelBulkOperation('job-1');
      expect(post).toHaveBeenCalledWith('/files/bulk-operation/job-1/cancel');
    });
  });
});
