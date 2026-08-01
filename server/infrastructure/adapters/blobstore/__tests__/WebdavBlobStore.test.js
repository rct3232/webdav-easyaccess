'use strict';

const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');

let mockWebdav;

jest.mock('../../../../utils/webdav', () => {
  return mockWebdav;
});

beforeEach(() => {
  jest.resetModules();
  mockWebdav = createWebdavMock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WebdavBlobStore', () => {
  let WebdavBlobStore;

  const config = {
    baseUrl: 'https://webdav.example.com',
    username: 'test-user',
    password: 'test-pass',
  };

  beforeEach(() => {
    mockWebdav.putFileContents.mockResolvedValue({ success: true });
    mockWebdav.getFileContents.mockResolvedValue(Buffer.from('file content'));
    mockWebdav.deleteFile.mockResolvedValue({ success: true });
    mockWebdav.getFileMetadata.mockResolvedValue({ size: 12, lastmod: '2024-01-01T00:00:00.000Z', mime: 'text/plain' });

    WebdavBlobStore = require('../WebdavBlobStore');
  });

  describe('uploadToWebdav', () => {
    it('uploads buffer to WebDAV path successfully', async () => {
      const store = new WebdavBlobStore(config);
      const data = Buffer.from('hello world');

      await store.uploadToWebdav('/remote/path/file.txt', data);

      expect(mockWebdav.putFileContents).toHaveBeenCalledWith('/remote/path/file.txt', data);
    });

    it('throws descriptive error for empty path', async () => {
      const store = new WebdavBlobStore(config);

      await expect(store.uploadToWebdav('', Buffer.from('data'))).rejects.toThrow();
      await expect(store.uploadToWebdav(null, Buffer.from('data'))).rejects.toThrow();
      await expect(store.uploadToWebdav(undefined, Buffer.from('data'))).rejects.toThrow();
    });

    it('throws descriptive error for null/empty buffer', async () => {
      const store = new WebdavBlobStore(config);

      await expect(store.uploadToWebdav('/some/path.txt', null)).rejects.toThrow();
      await expect(store.uploadToWebdav('/some/path.txt', undefined)).rejects.toThrow();
      await expect(store.uploadToWebdav('/some/path.txt', Buffer.from(''))).rejects.toThrow();
    });

    it('propagates WebDAV server errors with original message', async () => {
      const store = new WebdavBlobStore(config);
      const serverError = new Error('Server error: 503 Service Unavailable');
      serverError.status = 503;
      mockWebdav.putFileContents.mockRejectedValue(serverError);

      await expect(store.uploadToWebdav('/remote/path/file.txt', Buffer.from('data'))).rejects.toThrow();
    });
  });

  describe('downloadFromWebdav', () => {
    it('retrieves content and returns Buffer', async () => {
      const originalData = Buffer.from('test file data');
      mockWebdav.getFileContents.mockResolvedValue(originalData);

      const store = new WebdavBlobStore(config);
      const result = await store.downloadFromWebdav('/remote/path/file.txt');

      expect(mockWebdav.getFileContents).toHaveBeenCalledWith('/remote/path/file.txt');
      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(originalData);
    });

    it('returns null for 404 (file not found)', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.status = 404;
      mockWebdav.getFileContents.mockRejectedValue(notFoundError);

      const store = new WebdavBlobStore(config);
      const result = await store.downloadFromWebdav('/remote/missing.txt');

      expect(result).toBeNull();
    });

    it('throws on non-404 HTTP errors', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.status = 500;
      mockWebdav.getFileContents.mockRejectedValue(serverError);

      const store = new WebdavBlobStore(config);

      await expect(store.downloadFromWebdav('/remote/path/file.txt')).rejects.toThrow();
    });
  });

  describe('deleteOnWebdav', () => {
    it('deletes resource successfully', async () => {
      const store = new WebdavBlobStore(config);

      await store.deleteOnWebdav('/remote/path/file.txt');

      expect(mockWebdav.deleteFile).toHaveBeenCalledWith('/remote/path/file.txt');
    });

    it('is idempotent for already-deleted resources (404 -> no throw)', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.status = 404;
      mockWebdav.deleteFile.mockRejectedValue(notFoundError);

      const store = new WebdavBlobStore(config);

      await expect(store.deleteOnWebdav('/remote/already-gone.txt')).resolves.not.toThrow();
    });

    it('propagates server errors', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.status = 500;
      mockWebdav.deleteFile.mockRejectedValue(serverError);

      const store = new WebdavBlobStore(config);

      await expect(store.deleteOnWebdav('/remote/path/file.txt')).rejects.toThrow();
    });
  });

  describe('headOnWebdav', () => {
    it('returns { contentLength, contentType } metadata object', async () => {
      mockWebdav.getFileMetadata.mockResolvedValue({
        size: 42,
        lastmod: '2024-06-15T10:30:00.000Z',
        mime: 'image/png',
      });

      const store = new WebdavBlobStore(config);
      const meta = await store.headOnWebdav('/remote/path/image.png');

      expect(mockWebdav.getFileMetadata).toHaveBeenCalledWith('/remote/path/image.png');
      expect(meta).toHaveProperty('contentLength', 42);
      expect(meta).toHaveProperty('contentType', 'image/png');
    });

    it('returns null for 404', async () => {
      const notFoundError = new Error('File not found: /remote/missing.txt');
      notFoundError.status = 404;
      mockWebdav.getFileMetadata.mockRejectedValue(notFoundError);

      const store = new WebdavBlobStore(config);
      const result = await store.headOnWebdav('/remote/missing.txt');

      expect(result).toBeNull();
    });

    it('throws on non-404 HTTP errors', async () => {
      const serverError = new Error('Bad Gateway');
      serverError.status = 502;
      mockWebdav.getFileMetadata.mockRejectedValue(serverError);

      const store = new WebdavBlobStore(config);

      await expect(store.headOnWebdav('/remote/path/file.txt')).rejects.toThrow();
    });
  });
});
