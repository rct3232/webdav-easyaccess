'use strict';

const { createS3Mock } = require('../../../../testing/mocks/s3Mock');

let S3BlobStore;
let currentMockS3;

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});

beforeEach(() => {
  jest.resetModules();
  currentMockS3 = createS3Mock();
  const MockedS3Client = require('@aws-sdk/client-s3').S3Client;

  MockedS3Client.mockImplementation(() => ({
    send: async (command) => {
      const cmdName = command.constructor.name;
      if (cmdName === 'PutObjectCommand') return currentMockS3.putObject(command);
      if (cmdName === 'GetObjectCommand') return currentMockS3.getObject(command);
      if (cmdName === 'DeleteObjectCommand') return currentMockS3.deleteObject(command);
      if (cmdName === 'HeadObjectCommand') return currentMockS3.headObject(command);
      if (cmdName === 'CopyObjectCommand') return currentMockS3.copyObject(command);
      if (cmdName === 'ListObjectsV2Command') return currentMockS3.listObjectsV2(command);
      throw new Error(`Unknown command: ${cmdName}`);
    },
  }));

  S3BlobStore = require('../S3BlobStore');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('S3BlobStore', () => {
  const config = {
    bucket: 'test-bucket',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  };

  describe('uploadBlob', () => {
    it('puts object in store with correct Key, Body, and Bucket', async () => {
      const store = new S3BlobStore(config);
      const data = Buffer.from('hello');
      await store.uploadBlob('test-key', data);

      const stored = currentMockS3.getStore().get('test-key');
      expect(stored).toBeDefined();
      expect(stored.Body).toEqual(data);
    });

    it('throws descriptive error for empty key', async () => {
      const store = new S3BlobStore(config);
      await expect(store.uploadBlob('', Buffer.from('data'))).rejects.toThrow();
    });

    it('throws descriptive error for missing/empty buffer', async () => {
      const store = new S3BlobStore(config);
      await expect(store.uploadBlob('key', null)).rejects.toThrow();
      await expect(store.uploadBlob('key', Buffer.from(''))).rejects.toThrow();
    });
  });

  describe('downloadBlob', () => {
    it('retrieves object and returns Buffer', async () => {
      const originalData = Buffer.from('test content');
      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'my-key', Body: originalData });

      const store = new S3BlobStore(config);
      const result = await store.downloadBlob('my-key');

      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(originalData);
    });
  });

  describe('deleteBlob', () => {
    it('removes object from S3', async () => {
      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'del-key', Body: Buffer.from('x') });
      expect(currentMockS3.getStore().has('del-key')).toBe(true);

      const store = new S3BlobStore(config);
      await store.deleteBlob('del-key');

      expect(currentMockS3.getStore().has('del-key')).toBe(false);
    });

    it('handles missing key idempotently', async () => {
      const store = new S3BlobStore(config);
      await expect(store.deleteBlob('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('headBlob', () => {
    it('returns metadata with contentLength and contentType shape', async () => {
      currentMockS3.putObject({
        Bucket: 'test-bucket',
        Key: 'meta-key',
        Body: Buffer.from('abc'),
        ContentType: 'text/plain',
      });

      const store = new S3BlobStore(config);
      const meta = await store.headBlob('meta-key');

      expect(meta).toHaveProperty('contentLength');
      expect(meta).toHaveProperty('contentType');
    });

    it('throws NoSuchKey error for missing key', async () => {
      const store = new S3BlobStore(config);
      await expect(store.headBlob('missing')).rejects.toThrow();
    });
  });

  describe('listOrphanedKeys', () => {
    it('filters keys by olderThan threshold', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 86400000 * 10);
      const recentDate = new Date(now - 1000);

      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'old-file.txt', Body: Buffer.from('old') });
      currentMockS3.getStore().set('old-file.txt', {
        ...currentMockS3.getStore().get('old-file.txt'),
        LastModified: oldDate,
      });

      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'recent-file.txt', Body: Buffer.from('new') });
      currentMockS3.getStore().set('recent-file.txt', {
        ...currentMockS3.getStore().get('recent-file.txt'),
        LastModified: recentDate,
      });

      const store = new S3BlobStore(config);
      const cutoff = new Date(now - 86400000 * 5);
      const keys = await store.listOrphanedKeys(cutoff);

      expect(keys).toContain('old-file.txt');
      expect(keys).not.toContain('recent-file.txt');
    });

    it('handles pagination via IsTruncated', async () => {
      const oldDate = new Date(Date.now() - 86400000 * 20);

      for (let i = 0; i < 15; i++) {
        currentMockS3.putObject({ Bucket: 'test-bucket', Key: `page-key-${i}`, Body: Buffer.from('x') });
        currentMockS3.getStore().set(`page-key-${i}`, {
          ...currentMockS3.getStore().get(`page-key-${i}`),
          LastModified: oldDate,
        });
      }

      const store = new S3BlobStore(config);
      const keys = await store.listOrphanedKeys(new Date());

      expect(keys.length).toBeGreaterThan(0);
    });

    it('handles empty bucket with undefined Contents', async () => {
      const store = new S3BlobStore(config);
      const keys = await store.listOrphanedKeys(new Date());

      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBe(0);
    });
  });

  describe('copyBlob', () => {
    it('copies object to a new key via CopyObjectCommand', async () => {
      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'src-key', Body: Buffer.from('data'), ContentType: 'text/plain' });

      const store = new S3BlobStore(config);
      await store.copyBlob('src-key', 'dest-key');

      const dest = currentMockS3.getStore().get('dest-key');
      expect(dest).toBeDefined();
      expect(dest.Body).toEqual(Buffer.from('data'));
    });

    it('throws clear error when source key is missing (NoSuchKey)', async () => {
      const store = new S3BlobStore(config);
      await expect(store.copyBlob('missing-src', 'dest-key')).rejects.toThrow(/source key not found/i);
    });
  });
});
