'use strict';

const { createTestDatabase } = require('../../../../test-utils');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createVersionsService } = require('../versionsService');
const { createInMemoryBlobStore } = require('@testing/mocks/serviceMocks');
const { createAclServiceMock } = require('@testing/mocks/serviceMocks');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');

describe('createVersionsService', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let aclService;
  let versionsService;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createInMemoryBlobStore();
    aclService = createAclServiceMock({ checkFilePermission: jest.fn().mockResolvedValue(true) });
    versionsService = createVersionsService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 's3',
      aclService,
    });
    seq += 1;
  });

  const unique = (prefix) => `${prefix}-${Date.now()}-${seq}`;

  /** Seed a node with an active v1 and a history v2 (restorable shape). */
  async function seedVersionedNode() {
    const name = unique('ver-node');
    const node = await fileNodeService.createFile(null, name);
    const keyV1 = unique('ver-v1');
    const keyV2 = unique('ver-v2');

    await fileNodesStore.upsertObjectMap(node.id, keyV1, 'pending');
    await fileNodesStore.activateObject(keyV1);
    await blobStore.uploadBlob(keyV1, Buffer.from('v1-content'));
    await fileNodeService.updateSyncStatus(node.id, 'active');

    // Overwrite: v1 demoted to history, v2 pending.
    await fileNodesStore.upsertObjectMap(node.id, keyV2, 'pending');
    await blobStore.uploadBlob(keyV2, Buffer.from('v2-content-longer'));
    await fileNodesStore.activateObject(keyV2);
    await fileNodesStore.upsertCache(node.id, 2, 'text/plain', null);

    return { node, name, keyV1, keyV2 };
  }

  describe('listVersions', () => {
    it('returns active + history rows newest first with sizes and isCurrent, stripping internals', async () => {
      const { node, keyV1 } = await seedVersionedNode();

      const result = await versionsService.listVersions('user-1', node.id, { is_admin: 0 });

      expect(result.nodeId).toBe(node.id);
      expect(result.currentVersionNumber).toBe(2);
      expect(result.versions).toHaveLength(2);
      expect(result.versions[0]).toMatchObject({
        versionNumber: 2,
        status: 'active',
        isCurrent: true,
        size: Buffer.from('v2-content-longer').length,
      });
      expect(result.versions[1]).toMatchObject({
        versionNumber: 1,
        status: 'history',
        isCurrent: false,
        size: Buffer.from('v1-content').length,
      });
      for (const v of result.versions) {
        expect(v.s3_key).toBeUndefined();
        expect(v.storage_backend).toBeUndefined();
        expect(v.id).toBeUndefined();
      }
      expect(keyV1).toBeDefined();
    });

    it('reports size null when the headBlob probe fails', async () => {
      const { node, keyV1 } = await seedVersionedNode();
      blobStore.headBlob = jest.fn((key) => {
        if (key === keyV1) return Promise.reject(new Error('probe boom'));
        return blobStore.store.has(key)
          ? Promise.resolve({ contentLength: 1, contentType: 'text/plain' })
          : Promise.resolve(null);
      });

      const result = await versionsService.listVersions('user-1', node.id, { is_admin: 0 });

      const v1 = result.versions.find((v) => v.versionNumber === 1);
      expect(v1.size).toBeNull();
    });

    it('404-masquerades when the caller has no read permission', async () => {
      const { node } = await seedVersionedNode();
      aclService.checkFilePermission.mockResolvedValue(false);

      await expect(
        versionsService.listVersions('user-1', node.id, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: SERVER_ERROR_CODES.files.notFound,
      });
    });

    it('admin bypass skips the permission check', async () => {
      const { node } = await seedVersionedNode();
      aclService.isAdminUser.mockReturnValue(true);
      aclService.checkFilePermission.mockClear();

      const result = await versionsService.listVersions('admin-1', node.id, { is_admin: 1 });

      expect(result.versions).toHaveLength(2);
      expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    });

    it('returns an empty list for a node without versions', async () => {
      const node = await fileNodeService.createFile(null, unique('ver-empty'));
      const result = await versionsService.listVersions('user-1', node.id, { is_admin: 0 });
      expect(result).toEqual({ nodeId: node.id, currentVersionNumber: null, versions: [] });
    });
  });

  describe('restoreVersion', () => {
    it('swaps history→active and active→history inside one TX without adding a row', async () => {
      const { node, keyV1, keyV2 } = await seedVersionedNode();
      const { dbQuery } = require('../../../../test-utils');
      const before = await dbQuery(
        'SELECT COUNT(*) AS count FROM object_map WHERE file_node_id = ?',
        [node.id]
      );

      const result = await versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result).toMatchObject({
        messageCode: SERVER_MESSAGE_CODES.files.versionRestored,
        nodeId: node.id,
        restoredVersionNumber: 1,
      });

      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(keyV1);
      const { rows } = await dbQuery(
        'SELECT s3_key, status FROM object_map WHERE file_node_id = ? ORDER BY version_number',
        [node.id]
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.s3_key, r.status]));
      expect(byKey[keyV1]).toBe('active');
      expect(byKey[keyV2]).toBe('history');
      expect(rows).toHaveLength(before.rows[0].count);

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
    });

    it('re-asserts the filecache from the blob HEAD metadata', async () => {
      const { node, keyV1 } = await seedVersionedNode();

      await versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      const cache = await fileNodesStore.getCache(node.id);
      expect(Number(cache.size)).toBe(Buffer.from('v1-content').length);
      expect(cache.mime_type).toBe('application/octet-stream');
      expect(cache.content_hash).toBeNull();
      expect(keyV1).toBeDefined();
    });

    it('evicts the cached thumbnail on restore', async () => {
      const { node } = await seedVersionedNode();
      const thumbnailService = require('../../../thumbnails/services/thumbnailService');
      thumbnailService.setCacheAdapter(
        require('../../../../infrastructure/adapters/cache').createCacheAdapter()
      );
      thumbnailService.setCachedThumbnail(node.id, Buffer.from('thumb'), 'png');
      expect(thumbnailService.getCachedThumbnail(node.id)).not.toBeNull();

      await versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(thumbnailService.getCachedThumbnail(node.id)).toBeNull();
    });

    it('refuses with 403 when the caller lacks write permission', async () => {
      const { node } = await seedVersionedNode();
      aclService.checkFilePermission.mockResolvedValue(false);

      await expect(
        versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 403,
        errorCode: SERVER_ERROR_CODES.files.permissionDenied,
      });
    });

    it('404 for an unknown version', async () => {
      const { node } = await seedVersionedNode();

      await expect(
        versionsService.restoreVersion('user-1', node.id, 99, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: SERVER_ERROR_CODES.files.versionNotFound,
      });
    });

    it('refuses with 409 in WebDAV storage mode', async () => {
      const { node } = await seedVersionedNode();
      const webdavService = createVersionsService({
        fileNodesStore,
        fileNodeService,
        blobStore,
        fileStorageMode: 'webdav',
        aclService,
      });

      await expect(
        webdavService.restoreVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.files.versionRestoreUnavailable,
      });
    });

    it('refuses with 409 when the node is stuck pending_upload', async () => {
      const { node } = await seedVersionedNode();
      await fileNodeService.updateSyncStatus(node.id, 'pending_upload');

      await expect(
        versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.files.versionRestoreUnavailable,
      });
    });

    it('refuses with 409 when the target version blob is missing', async () => {
      const { node, keyV1 } = await seedVersionedNode();
      await blobStore.deleteBlob(keyV1);

      await expect(
        versionsService.restoreVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.files.versionBlobMissing,
      });

      // Mutates nothing on refusal.
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).not.toBe(keyV1);
    });

    it('restoring the current version is an idempotent no-op', async () => {
      const { node, keyV2 } = await seedVersionedNode();

      const result = await versionsService.restoreVersion('user-1', node.id, 2, { is_admin: 0 });

      expect(result.alreadyCurrent).toBe(true);
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(keyV2);
    });
  });

  describe('downloadVersion', () => {
    it('returns the requested version buffer (history row included)', async () => {
      const { node, keyV1 } = await seedVersionedNode();

      const buffer = await versionsService.downloadVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(Buffer.compare(buffer, Buffer.from('v1-content'))).toBe(0);
      expect(keyV1).toBeDefined();
    });

    it('404-masquerades without read permission', async () => {
      const { node } = await seedVersionedNode();
      aclService.checkFilePermission.mockResolvedValue(false);

      await expect(
        versionsService.downloadVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('404 for an unknown version', async () => {
      const { node } = await seedVersionedNode();

      await expect(
        versionsService.downloadVersion('user-1', node.id, 42, { is_admin: 0 })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: SERVER_ERROR_CODES.files.versionNotFound,
      });
    });

    it('404 when the version blob is gone', async () => {
      const { node, keyV1 } = await seedVersionedNode();
      await blobStore.deleteBlob(keyV1);

      await expect(
        versionsService.downloadVersion('user-1', node.id, 1, { is_admin: 0 })
      ).rejects.toMatchObject({ status: 404, errorCode: SERVER_ERROR_CODES.files.notFound });
    });
  });
});
