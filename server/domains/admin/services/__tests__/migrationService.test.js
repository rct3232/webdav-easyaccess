'use strict';

const crypto = require('crypto');
const net = require('net');
const http = require('http');

process.env.WEA_STORAGE_BACKEND = process.env.WEA_STORAGE_BACKEND || 'sqlite';

const {
  createTestDatabase,
  createTestUser,
  createUserRootNode,
  createTestFileNode,
  dbQuery,
  dbRun,
} = require('@server/test-utils');
const { createFakeBlobStore } = require('@testing/mocks/fakeBlobStore');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const lockManager = require('@server/infrastructure/lockManager');
const { sha256HexLower } = require('@server/utils/hash');
const { createMigrationService } = require('../migrationService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let fileNodesStore;
let fileNodeService;
let buildDestBlobStore;
let dbCleanup;

function makeService(srcBlobStore, fileStorageMode = 'webdav') {
  return createMigrationService({
    srcBlobStore,
    fileNodesStore,
    fileNodeService,
    buildDestBlobStore,
    lockManager,
    fileStorageMode,
  });
}

async function resetDb() {
  await dbRun('DELETE FROM node_ancestors');
  await dbRun('DELETE FROM object_map');
  await dbRun('DELETE FROM filecache');
  await dbRun('DELETE FROM file_nodes');
  await dbRun('DELETE FROM locks');
  await dbRun('DELETE FROM users');
}

async function createUserTree() {
  const username = `mig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await createTestUser({ username });
  const { nodeId: rootNodeId } = await createUserRootNode({ userId: user.id });
  return { user, rootNodeId, rootPath: `/${username}` };
}

async function insertObjectMapAndCache({ nodeId, s3Key, backend, buf }) {
  await dbRun(
    `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
     VALUES (?, ?, ?, 1, 'active')`,
    [nodeId, backend === 's3' ? s3Key : null, backend]
  );
  await dbRun(
    `INSERT INTO filecache (file_node_id, size, mime_type, content_hash)
     VALUES (?, ?, 'text/plain', ?)`,
    [nodeId, buf.length, sha256HexLower(buf)]
  );
}

async function activateNode(nodeId) {
  await dbRun('UPDATE file_nodes SET sync_status = ? WHERE id = ?', ['active', nodeId]);
}

async function seedWebdavFile({ parentId, name, content, srcStore }) {
  const fileResult = await createTestFileNode({ name, type: 'file', parentId });
  await activateNode(fileResult.nodeId);
  const buf = Buffer.from(content);
  await insertObjectMapAndCache({ nodeId: fileResult.nodeId, s3Key: null, backend: 'webdav', buf });
  await srcStore.uploadBlob(fileResult.path, buf);
  return { nodeId: fileResult.nodeId, path: fileResult.path };
}

// A webdav-native file as produced by the app: sync_status stays
// 'pending_upload' and no object_map row is created (the blob lives at the
// node's display path).
async function seedWebdavNativeFile({ parentId, name, content, srcStore }) {
  const fileResult = await createTestFileNode({ name, type: 'file', parentId });
  const buf = Buffer.from(content);
  await srcStore.uploadBlob(fileResult.path, buf);
  return { nodeId: fileResult.nodeId, path: fileResult.path };
}

async function seedS3File({ parentId, name, content, srcStore }) {
  const fileResult = await createTestFileNode({ name, type: 'file', parentId });
  await activateNode(fileResult.nodeId);
  const s3Key = crypto.randomUUID();
  const buf = Buffer.from(content);
  await insertObjectMapAndCache({ nodeId: fileResult.nodeId, s3Key, backend: 's3', buf });
  await srcStore.uploadBlob(s3Key, buf);
  return { nodeId: fileResult.nodeId, s3Key, path: fileResult.path };
}

async function getActiveObjectRow(nodeId) {
  const res = await dbQuery(
    'SELECT s3_key, storage_backend, status FROM object_map WHERE file_node_id = ? AND status = ?',
    [nodeId, 'active']
  );
  return res.rows[0] || null;
}

describe('createMigrationService', () => {
  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });

    // Defense in depth: any accidental network attempt fails the suite.
    jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('network disabled in migration tests');
    });
    jest.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('network disabled in migration tests');
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await dbCleanup();
  });

  beforeEach(async () => {
    await resetDb();
    buildDestBlobStore = () => ({ blobStore: createFakeBlobStore(), summary: 'fake destination' });
  });

  it('webdav→s3: flat UUID keys only, object_map flipped to s3, hashes match, filecache hash set', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const docs = await createTestFileNode({
      name: 'docs',
      type: 'directory',
      parentId: rootNodeId,
    });
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });
    const f2 = await seedWebdavFile({
      parentId: docs.nodeId,
      name: 'b.txt',
      content: 'beta-beta',
      srcStore: src,
    });
    const f3 = await seedWebdavFile({
      parentId: docs.nodeId,
      name: 'c.txt',
      content: 'gamma',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });

    expect(result).toEqual({ copied: 3, skipped: 0, failed: 0, errors: [], dryRun: false });

    const keys = dst.listKeys();
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).toMatch(UUID_RE);
      expect(key).not.toContain('/');
    }
    expect(dst.listDirectories()).toHaveLength(0);

    const srcHashes = Array.from(src.hashAll().values()).sort();
    const dstHashes = Array.from(dst.hashAll().values()).sort();
    expect(dstHashes).toEqual(srcHashes);

    for (const file of [f1, f2, f3]) {
      const row = await getActiveObjectRow(file.nodeId);
      expect(row.storage_backend).toBe('s3');
      expect(row.s3_key).toMatch(UUID_RE);
    }

    const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
      f1.nodeId,
    ]);
    expect(cache.rows[0].content_hash).toBe(sha256HexLower('alpha'));
  });

  it('webdav source: pending_upload node with no object_map is enumerated, copied to s3, and set active', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const native = await seedWebdavNativeFile({
      parentId: rootNodeId,
      name: 'native.txt',
      content: 'native-content',
      srcStore: src,
    });

    const pendingRow = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [
      native.nodeId,
    ]);
    expect(pendingRow.rows[0].sync_status).toBe('pending_upload');
    const noObjectMap = await dbQuery('SELECT id FROM object_map WHERE file_node_id = ?', [
      native.nodeId,
    ]);
    expect(noObjectMap.rows).toHaveLength(0);

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });

    expect(result).toEqual({ copied: 1, skipped: 0, failed: 0, errors: [], dryRun: false });
    expect(dst.count()).toBe(1);
    const key = dst.listKeys()[0];
    expect(key).toMatch(UUID_RE);
    expect(dst.getBuffer(key).toString()).toBe('native-content');

    const row = await getActiveObjectRow(native.nodeId);
    expect(row).not.toBeNull();
    expect(row.storage_backend).toBe('s3');
    expect(row.s3_key).toBe(key);
    expect(row.status).toBe('active');

    const activeRow = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [
      native.nodeId,
    ]);
    expect(activeRow.rows[0].sync_status).toBe('active');
  });

  it('webdav source: orphaned_node file nodes are excluded from the snapshot', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavNativeFile({
      parentId: rootNodeId,
      name: 'ok.txt',
      content: 'ok',
      srcStore: src,
    });
    const orphan = await createTestFileNode({
      name: 'stuck.txt',
      type: 'file',
      parentId: rootNodeId,
    });
    await dbRun('UPDATE file_nodes SET sync_status = ? WHERE id = ?', [
      'orphaned_node',
      orphan.nodeId,
    ]);
    await src.uploadBlob(orphan.path, Buffer.from('orphan-blob'));

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });

    expect(result.copied).toBe(1);
    expect(result.failed).toBe(0);
    expect(dst.count()).toBe(1);
    expect(dst.listKeys()).toHaveLength(1);
    const row = await getActiveObjectRow(orphan.nodeId);
    expect(row).toBeNull();
    expect(
      (await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [orphan.nodeId])).rows[0]
        .sync_status
    ).toBe('orphaned_node');
  });

  it('webdav source resume: node with preserved active s3_key is skipped on rerun, re-copied when force', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const first = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });
    expect(first.copied).toBe(1);

    await src.uploadBlob(f1.path, Buffer.from('alpha-changed'));

    const second = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(dst.count()).toBe(1);

    const third = await service.run({ destConfig: { type: 's3' }, mode: 'apply', force: true });
    expect(third.copied).toBe(1);
    expect(third.skipped).toBe(0);
    expect(dst.count()).toBe(2);
    expect(dst.getBuffer(dst.listKeys()[1]).toString()).toBe('alpha-changed');
  });

  it('s3 source snapshot unchanged: pending_upload node with no object_map is not enumerated', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const pending = await createTestFileNode({
      name: 'native.txt',
      type: 'file',
      parentId: rootNodeId,
    });
    await src.uploadBlob(pending.path, Buffer.from('should-not-copy'));
    await seedS3File({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    const result = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });

    expect(result.copied).toBe(1);
    expect(dst.writtenPaths()).not.toContain(pending.path);
    const pendingRow = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [
      pending.nodeId,
    ]);
    expect(pendingRow.rows[0].sync_status).toBe('pending_upload');
  });

  it('webdav→s3: zero-byte source files are copied, not failed', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const empty = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'empty.txt',
      content: '',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });

    expect(result).toEqual({ copied: 1, skipped: 0, failed: 0, errors: [], dryRun: false });
    expect(dst.count()).toBe(1);
    const key = dst.listKeys()[0];
    expect(dst.getBuffer(key).length).toBe(0);
    const row = await getActiveObjectRow(empty.nodeId);
    expect(row.storage_backend).toBe('s3');
    expect(row.s3_key).toMatch(UUID_RE);
  });

  it('s3→webdav: dest paths preserve the tree, ancestor dirs recorded, object_map flipped to webdav', async () => {
    const { rootNodeId, rootPath } = await createUserTree();
    const src = createFakeBlobStore();
    const docs = await createTestFileNode({
      name: 'docs',
      type: 'directory',
      parentId: rootNodeId,
    });
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });
    const f2 = await seedS3File({
      parentId: docs.nodeId,
      name: 'b.txt',
      content: 'beta',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    const result = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });

    expect(result.copied).toBe(2);
    expect(result.dryRun).toBe(false);

    const written = dst.writtenPaths();
    expect(written).toContain(`${rootPath}/a.txt`);
    expect(written).toContain(`${rootPath}/docs/b.txt`);

    const dirs = dst.listDirectories();
    expect(dirs).toContain(rootPath);
    expect(dirs).toContain(`${rootPath}/docs`);

    for (const file of [f1, f2]) {
      const row = await getActiveObjectRow(file.nodeId);
      expect(row.storage_backend).toBe('webdav');
      expect(row.s3_key).toBe(file.s3Key);
    }
  });

  it('s3→webdav inline flip: storage_backend=webdav while s3_key is preserved', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });
    const f2 = await seedS3File({
      parentId: rootNodeId,
      name: 'b.txt',
      content: 'beta',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    const result = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });
    expect(result.copied).toBe(2);

    for (const file of [f1, f2]) {
      const row = await getActiveObjectRow(file.nodeId);
      expect(row.storage_backend).toBe('webdav');
      expect(row.s3_key).not.toBeNull();
      expect(row.s3_key).toBe(file.s3Key);
    }
  });

  it('s3→webdav re-run skips already-flipped nodes (resume always on)', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    const first = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });
    expect(first.copied).toBe(1);
    expect((await getActiveObjectRow(f1.nodeId)).storage_backend).toBe('webdav');

    const second = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(dst.count()).toBe(1);
  });

  it('s3→webdav dry-run writes nothing and never flips storage_backend', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    const result = await service.run({ destConfig: { type: 'webdav' }, mode: 'dry-run' });

    expect(result.dryRun).toBe(true);
    expect(result.copied).toBe(0);
    expect(dst.count()).toBe(0);

    const row = await getActiveObjectRow(f1.nodeId);
    expect(row.storage_backend).toBe('s3');
    expect(row.s3_key).toBe(f1.s3Key);
  });

  it('dry-run writes nothing, leaves DB untouched, returns dryRun:true', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });
    const f2 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'b.txt',
      content: 'beta',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({
      direction: 'webdav-to-s3',
      destConfig: { type: 's3' },
      mode: 'dry-run',
    });

    expect(result.dryRun).toBe(true);
    expect(result.copied).toBe(0);
    expect(dst.count()).toBe(0);

    const expectedHashes = {
      [f1.nodeId]: sha256HexLower('alpha'),
      [f2.nodeId]: sha256HexLower('beta'),
    };
    for (const file of [f1, f2]) {
      const row = await getActiveObjectRow(file.nodeId);
      expect(row.storage_backend).toBe('webdav');
      expect(row.s3_key).toBeNull();
      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        file.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(expectedHashes[file.nodeId]);
    }
  });

  it('webdav source rejects a webdav destination before any work', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 'webdav');

    await expect(
      service.run({
        destConfig: { type: 'webdav', url: 'http://dav', username: 'u', password: 'p' },
        mode: 'apply',
      })
    ).rejects.toThrow('Destination type mismatch: expected s3 for direction webdav-to-s3');

    expect(dst.count()).toBe(0);
    const row = await getActiveObjectRow(f1.nodeId);
    expect(row.storage_backend).toBe('webdav');
    expect(row.s3_key).toBeNull();
  });

  it('s3 source rejects an s3 destination before any work', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src, 's3');

    await expect(
      service.run({
        destConfig: { type: 's3', bucket: 'b', accessKey: 'ak', secretKey: 'sk' },
        mode: 'apply',
      })
    ).rejects.toThrow('Destination type mismatch: expected webdav for direction s3-to-webdav');

    expect(dst.count()).toBe(0);
    const row = await getActiveObjectRow(f1.nodeId);
    expect(row.storage_backend).toBe('s3');
    expect(row.s3_key).toBe(f1.s3Key);
  });

  it('apply aborts with no writes when the internal dry pass (dest probe) fails', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore({
      headBlob: async () => {
        throw new Error('probe failed: destination unreachable');
      },
    });
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    await expect(service.run({ destConfig: { type: 's3' }, mode: 'apply' })).rejects.toThrow(
      'destination unreachable'
    );

    expect(dst.count()).toBe(0);
    const row = await getActiveObjectRow(f1.nodeId);
    expect(row.storage_backend).toBe('webdav');
    expect(row.s3_key).toBeNull();
  });

  it('dry-run tolerates a NotFound probe response from S3 (minio $metadata 404)', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavFile({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });

    const notFound = Object.assign(new Error('UnknownError'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    const dst = createFakeBlobStore({
      headBlob: async () => {
        throw notFound;
      },
    });
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({
      destConfig: { type: 's3' },
      mode: 'dry-run',
    });

    expect(result.dryRun).toBe(true);
    expect(dst.count()).toBe(0);
  });

  it('resume: completed nodes skipped, failed nodes copied, no duplicates', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavFile({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });
    await seedWebdavFile({ parentId: rootNodeId, name: 'b.txt', content: 'beta', srcStore: src });
    await seedWebdavFile({ parentId: rootNodeId, name: 'c.txt', content: 'gamma', srcStore: src });

    const dst = createFakeBlobStore();
    const realUpload = dst.uploadBlob;
    let failUploads = 2;
    dst.uploadBlob = async (key, buf) => {
      if (failUploads > 0) {
        failUploads -= 1;
        throw new Error('injected upload failure');
      }
      return realUpload(key, buf);
    };
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const first = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });
    expect(first.copied).toBe(1);
    expect(first.failed).toBe(2);

    failUploads = 0;
    const second = await service.run({
      destConfig: { type: 's3' },
      mode: 'apply',
    });
    expect(second.copied).toBe(2);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);

    expect(dst.count()).toBe(3);
    const keys = dst.listKeys();
    expect(new Set(keys).size).toBe(3);
  });

  it('idempotent: full rerun with resume copies nothing', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavFile({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });
    await seedWebdavFile({ parentId: rootNodeId, name: 'b.txt', content: 'beta', srcStore: src });
    await seedWebdavFile({ parentId: rootNodeId, name: 'c.txt', content: 'gamma', srcStore: src });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const first = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });
    expect(first.copied).toBe(3);

    const second = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(3);
    expect(dst.count()).toBe(3);
  });

  it('error isolation: missing source blob fails one node, others copied, run continues', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });
    const f2 = await seedWebdavFile({
      parentId: rootNodeId,
      name: 'b.txt',
      content: 'beta',
      srcStore: src,
    });
    await src.deleteBlob(f2.path);

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const result = await service.run({ destConfig: { type: 's3' }, mode: 'apply' });

    expect(result.copied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe(f2.nodeId);
    expect(result.errors[0].path).toBe(f2.path);
    expect(result.errors[0].error).toMatch(/not found/i);

    expect(dst.count()).toBe(1);
    expect((await getActiveObjectRow(f1.nodeId)).storage_backend).toBe('s3');
    const f2row = await getActiveObjectRow(f2.nodeId);
    expect(f2row.storage_backend).toBe('webdav');
    expect(f2row.s3_key).toBeNull();
  });

  it('partial-blob safety (s3→webdav): size mismatch is not treated as complete on resume', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    const f1 = await seedS3File({
      parentId: rootNodeId,
      name: 'a.txt',
      content: 'alpha',
      srcStore: src,
    });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 'webdav fake' });
    const service = makeService(src, 's3');

    // Simulate a crashed run that left a truncated destination blob before the flip.
    await dst.uploadBlob(f1.path, Buffer.from('partial'));

    const result = await service.run({ destConfig: { type: 'webdav' }, mode: 'apply' });
    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(dst.getBuffer(f1.path).toString()).toBe('alpha');
  });

  it('exclusive lock: concurrent run is rejected with "migration already in progress"', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavFile({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });
    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const held = await lockManager.acquireLock('migration:blobs', {
      ttlMs: 60 * 1000,
      waitMs: 1000,
    });
    try {
      await expect(service.run({ destConfig: { type: 's3' }, mode: 'apply' })).rejects.toThrow(
        'migration already in progress'
      );
    } finally {
      await held.release();
    }
  });

  it('onProgress is called after each node with the documented shape', async () => {
    const { rootNodeId } = await createUserTree();
    const src = createFakeBlobStore();
    await seedWebdavFile({ parentId: rootNodeId, name: 'a.txt', content: 'alpha', srcStore: src });
    await seedWebdavFile({ parentId: rootNodeId, name: 'b.txt', content: 'beta', srcStore: src });

    const dst = createFakeBlobStore();
    buildDestBlobStore = () => ({ blobStore: dst, summary: 's3 fake' });
    const service = makeService(src);

    const progressCalls = [];
    const result = await service.run({
      destConfig: { type: 's3' },
      mode: 'apply',
      onProgress: (progress) => progressCalls.push(progress),
    });

    expect(result.copied).toBe(2);
    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toMatchObject({ total: 2, done: 1, copied: 1, skipped: 0, failed: 0 });
    expect(progressCalls[0].current.nodeId).toBeDefined();
    expect(progressCalls[1]).toMatchObject({ total: 2, done: 2, copied: 2 });
  });
});
