'use strict';

/**
 * Shared service mock factories for server unit tests.
 * Consolidates inline service mocks per TESTING_STRATEGY.md "Shared factories"
 * policy. Each factory returns a fresh set of jest.fn() stubs; per-test behavior
 * is supplied via overrides.
 * @see docs/TESTING_STRATEGY.md
 */

function createFileNodeServiceMock(overrides = {}) {
  const defaults = {
    getNode: jest.fn().mockImplementation(async (nodeId) => ({ id: nodeId, name: `file_${nodeId}.txt` })),
    createFile: jest.fn().mockResolvedValue({ id: 10 }),
    createDirectory: jest.fn().mockResolvedValue({ id: 20 }),
    renameNode: jest.fn().mockResolvedValue(true),
    moveNode: jest.fn().mockResolvedValue(true),
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    listDirectory: jest.fn().mockResolvedValue([]),
    getNodePath: jest.fn().mockResolvedValue('/some/path'),
    resolvePath: jest.fn().mockResolvedValue({ id: 10, name: 'test.txt', type: 'file' }),
    getDescendantIds: jest.fn().mockResolvedValue([]),
    withTx: jest.fn().mockImplementation(async (fn) => fn()),
    getNodeIdByName: jest.fn().mockResolvedValue(null),
    updateSyncStatus: jest.fn().mockResolvedValue(true),
    copyFile: jest.fn().mockResolvedValue({ nodeId: 20 }),
  };
  return { ...defaults, ...overrides };
}

function createAclServiceMock(overrides = {}) {
  const defaults = {
    checkFilePermission: jest.fn().mockResolvedValue(true),
    checkFolderPermission: jest.fn().mockResolvedValue(true),
    checkPermission: jest.fn().mockResolvedValue(true),
    canWriteFolder: jest.fn().mockReturnValue(true),
    canWriteFile: jest.fn().mockReturnValue(true),
    isSharePrincipal: jest.fn().mockReturnValue(false),
    isAdminUser: jest.fn().mockReturnValue(false),
  };
  return { ...defaults, ...overrides };
}

function createBlobStorageServiceMock(overrides = {}) {
  const defaults = {
    uploadFile: jest.fn().mockResolvedValue({ nodeId: 10 }),
    downloadBlob: jest.fn().mockResolvedValue(Buffer.from('content')),
    overwriteBlob: jest.fn().mockResolvedValue(true),
    uploadToWebdav: jest.fn().mockResolvedValue(true),
    prepareUpload: jest.fn().mockResolvedValue({ s3Key: 'key-1' }),
    completeUpload: jest.fn().mockResolvedValue(true),
    deleteBlob: jest.fn().mockResolvedValue(true),
    getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
    duplicateBlob: jest.fn().mockResolvedValue('key-copy'),
    linkObject: jest.fn().mockResolvedValue(true),
    countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
    ensureExclusiveBlob: jest.fn().mockResolvedValue('key-exclusive'),
    downloadBlobWebdav: jest.fn().mockResolvedValue(null),
  };
  return { ...defaults, ...overrides };
}

/**
 * Deterministic Map-backed in-memory blob store.
 * Mirrors the blobstore adapter contract (docs/spec/server/store/blobstore.md):
 * listOrphanedKeys validates a Date cutoff and only returns keys uploaded before it.
 */
function createInMemoryBlobStore(overrides = {}) {
  const data = new Map();
  const uploadedAt = new Map();

  const store = {
    store: data,
    uploadBlob: jest.fn((key, buffer) => {
      data.set(key, Buffer.from(buffer));
      uploadedAt.set(key, Date.now());
    }),
    downloadBlob: jest.fn((key) => {
      const buf = data.get(key);
      return buf ? Promise.resolve(buf) : Promise.resolve(null);
    }),
    deleteBlob: jest.fn((key) => {
      data.delete(key);
      uploadedAt.delete(key);
      return Promise.resolve();
    }),
    copyBlob: jest.fn((src, dst) => {
      const buf = data.get(src);
      if (buf) {
        data.set(dst, Buffer.from(buf));
        uploadedAt.set(dst, Date.now());
      }
      return Promise.resolve();
    }),
    headBlob: jest.fn((key) => {
      const buf = data.get(key);
      if (!buf) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ contentLength: buf.length, contentType: 'application/octet-stream' });
    }),
    listOrphanedKeys: jest.fn((olderThan) => {
      if (!(olderThan instanceof Date)) {
        return Promise.reject(new TypeError('olderThan must be a Date'));
      }
      const cutoff = olderThan.getTime();
      const keys = [];
      uploadedAt.forEach((ts, key) => {
        if (ts < cutoff) {
          keys.push(key);
        }
      });
      return Promise.resolve(keys);
    }),
  };

  return { ...store, ...overrides };
}

module.exports = {
  createFileNodeServiceMock,
  createAclServiceMock,
  createBlobStorageServiceMock,
  createInMemoryBlobStore,
};
