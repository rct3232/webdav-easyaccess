'use strict';

const originalEnv = { ...process.env };

describe('blobstore factory', () => {
  let createBlobStore;
  let resolveS3Config;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Default S3 env vars for tests that need them
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('createBlobStore', () => {
    it('returns S3BlobStore when WEA_FILE_STORAGE=s3', () => {
      process.env.WEA_FILE_STORAGE = 's3';

      ({ createBlobStore } = require('../index'));
      const store = createBlobStore();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('S3BlobStore');
    });

    it('returns NoOpBlobStore when WEA_FILE_STORAGE=webdav', () => {
      process.env.WEA_FILE_STORAGE = 'webdav';

      ({ createBlobStore } = require('../index'));
      const store = createBlobStore();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('NoOpBlobStore');
    });

    it('defaults to S3BlobStore when WEA_FILE_STORAGE is empty or undefined', () => {
      delete process.env.WEA_FILE_STORAGE;

      ({ createBlobStore } = require('../index'));
      const store = createBlobStore();

      expect(store.constructor.name).toBe('S3BlobStore');
    });
  });

  describe('resolveS3Config', () => {
    it('returns valid config with all required env vars', () => {
      ({ resolveS3Config } = require('../index'));
      const config = resolveS3Config();

      expect(config.bucket).toBe('test-bucket');
      expect(config.region).toBe('us-east-1');
      expect(config.credentials.accessKeyId).toBe('test-key');
      expect(config.credentials.secretAccessKey).toBe('test-secret');
    });

    it('includes endpoint when S3_ENDPOINT is present', () => {
      process.env.S3_ENDPOINT = 'http://localhost:9000';

      ({ resolveS3Config } = require('../index'));
      const config = resolveS3Config();

      expect(config.endpoint).toBe('http://localhost:9000');
    });

    it('excludes endpoint when S3_ENDPOINT is absent', () => {
      delete process.env.S3_ENDPOINT;

      ({ resolveS3Config } = require('../index'));
      const config = resolveS3Config();

      expect(config.endpoint).toBeUndefined();
    });

    it('throws clear error listing missing keys when required env vars are absent', () => {
      // Only set AWS_REGION, leave S3_BUCKET and credentials unset
      delete process.env.S3_BUCKET;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      ({ resolveS3Config } = require('../index'));

      expect(() => resolveS3Config()).toThrow(/missing.*required/i);
    });
  });
});
