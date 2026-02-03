import { get, post, put, del } from '../apiClient';
import { 
  listFiles, 
  deleteFile, 
  renameFile, 
  createFolder, 
  getWebDAVInfo,
  uploadFile,
  uploadFileWithPath,
  uploadMultipleFiles,
  moveFile,
  copyFile,
  checkConflicts,
  downloadMultipleFiles,
  checkPermission,
  requestThumbnailsBatch,
  batchDeleteFiles,
  batchMoveFiles,
  batchCopyFiles
} from '../fileService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
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

    it('deleteFile calls del with correct params', async () => {
      del.mockResolvedValue({ data: { message: 'deleted' } });

      await deleteFile('/test/file.txt');

      expect(del).toHaveBeenCalledWith('/files/delete', { params: { path: '/test/file.txt' } });
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
    it('uploadFile calls post with FormData', async () => {
      post.mockResolvedValue({ data: { success: true } });
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      await uploadFile(mockFile, '/dest', null, 'overwrite');

      expect(post).toHaveBeenCalledWith('/files/upload', expect.any(FormData), expect.any(Object));
      const formData = post.mock.calls[0][1];
      expect(formData.get('file')).toBe(mockFile);
      expect(formData.get('path')).toBe('/dest');
      expect(formData.get('onConflict')).toBe('overwrite');
    });

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
    it('moveFile calls put and handles progress if no operationId', async () => {
      put.mockResolvedValue({ data: { success: true } });
      get.mockResolvedValue({ data: [] }); // for getFileSize

      await moveFile('/src', '/dest');

      expect(put).toHaveBeenCalledWith('/files/move', {
        sourcePath: '/src',
        destinationPath: '/dest',
        onConflict: 'error'
      });
    });

    it('copyFile calls post', async () => {
      post.mockResolvedValue({ data: { success: true } });
      get.mockResolvedValue({ data: [] }); // for getFileSize

      await copyFile('/src', '/dest');

      expect(post).toHaveBeenCalledWith('/files/copy', {
        sourcePath: '/src',
        destinationPath: '/dest',
        onConflict: 'error'
      });
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
    it('batchDeleteFiles calls post', async () => {
      post.mockResolvedValue({ data: { success: true } });
      await batchDeleteFiles(['/p1', '/p2']);
      expect(post).toHaveBeenCalledWith('/files/batch-delete', { paths: ['/p1', '/p2'] });
    });

    it('batchMoveFiles calls post', async () => {
      post.mockResolvedValue({ data: { success: true } });
      const moves = [{ sourcePath: '/s1', destinationPath: '/d1' }];
      await batchMoveFiles(moves);
      expect(post).toHaveBeenCalledWith('/files/batch-move', { moves, onConflict: 'error' });
    });

    it('batchCopyFiles calls post', async () => {
      post.mockResolvedValue({ data: { success: true } });
      const copies = [{ sourcePath: '/s1', destinationPath: '/d1' }];
      await batchCopyFiles(copies);
      expect(post).toHaveBeenCalledWith('/files/batch-copy', { copies, onConflict: 'error' });
    });
  });
});
