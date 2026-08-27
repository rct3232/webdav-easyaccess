'use strict';

const {
  createComposition,
  getComposition,
  __setCompositionForTests,
  resetComposition,
} = require('../composition');
const S3BlobStore = require('../../infrastructure/adapters/blobstore/S3BlobStore');
const WebdavBlobStore = require('../../infrastructure/adapters/blobstore/WebdavBlobStore');

const EXPECTED_MEMBERS = [
  'fileNodesStore',
  'blobStore',
  'fileNodeService',
  'blobStorageService',
  'uploadService',
  'aclService',
  'fileService',
  'batchOperationService',
  'downloadService',
  'gcService',
  'failSafeService',
];

/**
 * In-memory blob store double. Building a composition never touches the blob
 * store at construction time, so a plain fake keeps the test hermetic
 * (no real S3 or WebDAV network access).
 */
function createFakeBlobStore() {
  return {
    uploadBlob: jest.fn().mockResolvedValue(undefined),
    downloadBlob: jest.fn().mockResolvedValue(Buffer.alloc(0)),
    deleteBlob: jest.fn().mockResolvedValue(undefined),
    headBlob: jest.fn().mockResolvedValue({ contentLength: 0, contentType: 'text/plain' }),
    listOrphanedKeys: jest.fn().mockResolvedValue([]),
  };
}

describe('service/composition', () => {
  const ENV_KEYS = ['WEA_FILE_STORAGE', 'S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const savedEnv = {};

  beforeAll(() => {
    // The default (env-driven) composition resolves an S3BlobStore, which only
    // constructs a lazy S3Client. Dummy credentials keep createBlobStore() from
    // throwing on missing config without any network or real S3 access.
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.WEA_FILE_STORAGE = 's3';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  });

  afterEach(() => {
    resetComposition();
    process.env.WEA_FILE_STORAGE = 's3';
  });

  afterAll(() => {
    resetComposition();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('getComposition()', () => {
    it('returns a cached singleton: two calls yield the same object identity', () => {
      const first = getComposition();
      const second = getComposition();
      expect(first).toBe(second);
    });

    it('exposes all expected members', () => {
      const composition = getComposition();
      for (const member of EXPECTED_MEMBERS) {
        expect(composition).toHaveProperty(member);
        expect(composition[member]).toBeDefined();
      }
    });
  });

  describe('createComposition(overrides)', () => {
    it('builds a fresh composition with overridden members', () => {
      const singleton = getComposition();
      const fakeBlobStore = createFakeBlobStore();

      const overridden = createComposition({ blobStore: fakeBlobStore });

      expect(overridden).not.toBe(singleton);
      expect(overridden.blobStore).toBe(fakeBlobStore);
      for (const member of EXPECTED_MEMBERS) {
        expect(overridden).toHaveProperty(member);
      }
    });

    it('honors overrides.fileStorageMode when building the services', async () => {
      const overridden = createComposition({
        fileStorageMode: 'webdav',
        blobStore: createFakeBlobStore(),
      });

      // In WebDAV mode prepareUpload is a no-op returning null without DB access;
      // in S3 mode it would generate an s3Key via the fileNodesStore.
      await expect(overridden.blobStorageService.prepareUpload(123)).resolves.toBeNull();
    });

    it('does not mutate the shared singleton', () => {
      const singleton = getComposition();
      const fakeBlobStore = createFakeBlobStore();

      createComposition({ blobStore: fakeBlobStore });

      expect(getComposition()).toBe(singleton);
      expect(getComposition().blobStore).not.toBe(fakeBlobStore);
    });
  });

  describe('__setCompositionForTests(overrides)', () => {
    it('replaces members on the singleton; getComposition() reflects the override', () => {
      const fakeBlobStore = createFakeBlobStore();

      __setCompositionForTests({ blobStore: fakeBlobStore });
      const composition = getComposition();

      expect(composition.blobStore).toBe(fakeBlobStore);
      for (const member of EXPECTED_MEMBERS) {
        expect(composition).toHaveProperty(member);
        expect(composition[member]).toBeDefined();
      }
    });

    it('overrides the cached singleton even after getComposition() was called', () => {
      const before = getComposition();
      const fakeBlobStore = createFakeBlobStore();

      __setCompositionForTests({ blobStore: fakeBlobStore });
      const after = getComposition();

      expect(after).not.toBe(before);
      expect(after.blobStore).toBe(fakeBlobStore);
    });

    it('can be called before any getComposition() call', () => {
      resetComposition();
      const fakeBlobStore = createFakeBlobStore();

      __setCompositionForTests({ blobStore: fakeBlobStore });

      expect(getComposition().blobStore).toBe(fakeBlobStore);
    });
  });

  describe('resetComposition()', () => {
    it('clears the cached singleton; the next getComposition() returns a fresh instance', () => {
      const before = getComposition();

      resetComposition();
      const after = getComposition();

      expect(after).not.toBe(before);
    });

    it('restores env-based defaults after an override', () => {
      const fakeBlobStore = createFakeBlobStore();
      __setCompositionForTests({ fileStorageMode: 'webdav', blobStore: fakeBlobStore });
      expect(getComposition().blobStore).toBe(fakeBlobStore);

      resetComposition();
      const restored = getComposition();

      // The overridden blobStore is gone and the adapter reverts to the
      // environment default (WEA_FILE_STORAGE=s3 -> S3BlobStore).
      expect(restored).not.toBe(fakeBlobStore);
      expect(restored.blobStore).not.toBe(fakeBlobStore);
      expect(restored.blobStore).toBeInstanceOf(S3BlobStore);
    });

    it('rebuilds the default composition from the current WEA_FILE_STORAGE env', () => {
      process.env.WEA_FILE_STORAGE = 'webdav';
      resetComposition();
      expect(getComposition().blobStore).toBeInstanceOf(WebdavBlobStore);

      process.env.WEA_FILE_STORAGE = 's3';
      resetComposition();
      expect(getComposition().blobStore).toBeInstanceOf(S3BlobStore);
    });
  });
});
