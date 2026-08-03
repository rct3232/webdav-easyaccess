'use strict';

function createAdapterMock(overrides = {}) {
  return {
    putFileContents: jest.fn().mockResolvedValue(undefined),
    getFileContents: jest.fn().mockResolvedValue(Buffer.from('file content')),
    deleteFile: jest.fn().mockResolvedValue({ success: true }),
    getFileMetadata: jest.fn().mockResolvedValue({
      size: 12,
      lastmod: '2024-01-01T00:00:00.000Z',
      mime: 'text/plain',
    }),
    ...overrides,
  };
}

describe('WebdavBlobStore', () => {
  let adapterMock;
  let WebdavBlobStore;

  beforeEach(() => {
    jest.resetModules();
    adapterMock = createAdapterMock();
    WebdavBlobStore = require('../WebdavBlobStore');
  });

  describe('uploadBlob', () => {
    it('uploads buffer to WebDAV path via putFileContents successfully', async () => {
      const store = new WebdavBlobStore(adapterMock);
      const data = Buffer.from('hello world');

      await store.uploadBlob('/remote/path/file.txt', data);

      expect(adapterMock.putFileContents).toHaveBeenCalledWith('/remote/path/file.txt', data);
    });

    it('throws descriptive error for empty/null/undefined filepath', async () => {
      const store = new WebdavBlobStore(adapterMock);

      await expect(store.uploadBlob('', Buffer.from('data'))).rejects.toThrow();
      await expect(store.uploadBlob(null, Buffer.from('data'))).rejects.toThrow();
      await expect(store.uploadBlob(undefined, Buffer.from('data'))).rejects.toThrow();
    });

    it('throws descriptive error for null or empty buffer', async () => {
      const store = new WebdavBlobStore(adapterMock);

      await expect(store.uploadBlob('/some/path.txt', null)).rejects.toThrow();
      await expect(store.uploadBlob('/some/path.txt', undefined)).rejects.toThrow();
      await expect(store.uploadBlob('/some/path.txt', Buffer.from(''))).rejects.toThrow();
    });

    it('propagates WebDAV server errors with original message', async () => {
      adapterMock.putFileContents.mockRejectedValue(Object.assign(new Error('Server error: 503 Service Unavailable'), { status: 503 }));

      const store = new WebdavBlobStore(adapterMock);

      await expect(store.uploadBlob('/remote/path/file.txt', Buffer.from('data'))).rejects.toThrow();
    });
  });

  describe('downloadBlob', () => {
    it('retrieves content and returns Buffer', async () => {
      const originalData = Buffer.from('test file data');
      adapterMock.getFileContents.mockResolvedValue(originalData);

      const store = new WebdavBlobStore(adapterMock);
      const result = await store.downloadBlob('/remote/path/file.txt');

      expect(adapterMock.getFileContents).toHaveBeenCalledWith('/remote/path/file.txt');
      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(originalData);
    });

    it('returns null for 404 (file not found)', async () => {
      adapterMock.getFileContents.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      const store = new WebdavBlobStore(adapterMock);
      const result = await store.downloadBlob('/remote/missing.txt');

      expect(result).toBeNull();
    });

    it('throws on non-404 HTTP errors', async () => {
      adapterMock.getFileContents.mockRejectedValue(Object.assign(new Error('Internal Server Error'), { status: 500 }));

      const store = new WebdavBlobStore(adapterMock);

      await expect(store.downloadBlob('/remote/path/file.txt')).rejects.toThrow();
    });
  });

  describe('deleteBlob', () => {
    it('deletes resource successfully', async () => {
      const store = new WebdavBlobStore(adapterMock);

      await store.deleteBlob('/remote/path/file.txt');

      expect(adapterMock.deleteFile).toHaveBeenCalledWith('/remote/path/file.txt', { isDirectory: false });
    });

    it('is idempotent for already-deleted resources (404 -> no throw)', async () => {
      adapterMock.deleteFile.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      const store = new WebdavBlobStore(adapterMock);

      await expect(store.deleteBlob('/remote/already-gone.txt')).resolves.not.toThrow();
    });

    it('propagates server errors', async () => {
      adapterMock.deleteFile.mockRejectedValue(Object.assign(new Error('Internal Server Error'), { status: 500 }));

      const store = new WebdavBlobStore(adapterMock);

      await expect(store.deleteBlob('/remote/path/file.txt')).rejects.toThrow();
    });
  });

  describe('headBlob', () => {
    it('returns { contentLength, contentType } mapping mime->contentType', async () => {
      adapterMock.getFileMetadata.mockResolvedValue({
        size: 42,
        lastmod: '2024-06-15T10:30:00.000Z',
        mime: 'image/png',
      });

      const store = new WebdavBlobStore(adapterMock);
      const meta = await store.headBlob('/remote/path/image.png');

      expect(adapterMock.getFileMetadata).toHaveBeenCalledWith('/remote/path/image.png');
      expect(meta.contentLength).toBe(42);
      expect(meta.contentType).toBe('image/png');
    });

    it('returns null for 404', async () => {
      adapterMock.getFileMetadata.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      const store = new WebdavBlobStore(adapterMock);
      const result = await store.headBlob('/remote/missing.txt');

      expect(result).toBeNull();
    });

    it('throws on non-404 HTTP errors', async () => {
      adapterMock.getFileMetadata.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { status: 502 }));

      const store = new WebdavBlobStore(adapterMock);

      await expect(store.headBlob('/remote/path/file.txt')).rejects.toThrow();
    });
  });
});