'use strict';

/**
 * Trash channel service tests (DEF-16 P3 — restore / purge / empty).
 * @see docs/spec/server/services/fileService.md §4.1
 *
 * Real sqlite store + fake blob store; aclService is a controlled stub so the
 * perm gates are deterministic. Storage modes are covered separately: S3
 * (zero physical I/O on trash/restore, eager per-row blob deletes on purge)
 * and WebDAV (MOVE to /.wea-trash/<id> on trash, MOVE back on restore,
 * trash-path delete on purge).
 */
const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFakeBlobStore } = require('../../testing/mocks/fakeBlobStore');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../../service/fileNodeService');
const { createTrashService } = require('../trashService');
const { buildTrashPath } = require('../webdavRemoteOps');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');

const ADMIN_USER = { id: 1, is_admin: true };

function createAclStub({ write = true, folderWrite = true } = {}) {
  return {
    isAdminUser: jest.fn((user) => Boolean(user && user.is_admin)),
    checkFilePermission: jest.fn(async () => write),
    checkFolderPermission: jest.fn(async () => folderWrite),
  };
}

describe('createTrashService', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let aclStub;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
    // Real user rows so the permission/share FK seeds in the purge tests hold.
    await dbRun(
      `INSERT INTO users (id, username, email, email_hash, password, status, is_admin, token_version)
       VALUES (?, 'trash-svc-u1', 'u1@trash-svc.test', 'h1', 'pw', 'approved', 0, 0)`,
      [1]
    );
    await dbRun(
      `INSERT INTO users (id, username, email, email_hash, password, status, is_admin, token_version)
       VALUES (?, 'trash-svc-u2', 'u2@trash-svc.test', 'h2', 'pw', 'approved', 0, 0)`,
      [2]
    );
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createFakeBlobStore();
    // WebDAV-faithful moveBlob: a collection MOVE relocates the source entry
    // AND everything under it (flat in-memory store keyed by full path).
    blobStore.moveBlob = jest.fn(async (from, to) => {
      const matching = blobStore
        .listKeys()
        .filter((key) => key === from || key.startsWith(`${from}/`));
      if (matching.length === 0) {
        throw new Error('404 - source not found');
      }
      for (const key of matching) {
        await blobStore.uploadBlob(to + key.slice(from.length), blobStore.getBuffer(key));
        await blobStore.deleteBlob(key);
      }
    });
    aclStub = createAclStub();
    // deleteBlob as a jest.fn so purge/restore remote-delete assertions work.
    const nativeDelete = blobStore.deleteBlob.bind(blobStore);
    blobStore.deleteBlob = jest.fn(async (key) => nativeDelete(key));
    // Collection-aware headBlob: a WebDAV PROPFIND on a collection path finds
    // it when the moved tree holds children under it (the trash MOVE parks a
    // FOLDER's content at /.wea-trash/<id>/... without a direct entry).
    const nativeHead = blobStore.headBlob.bind(blobStore);
    blobStore.headBlob = jest.fn(async (key) => {
      const direct = await nativeHead(key);
      if (direct != null) return direct;
      const hasChildren = blobStore
        .listKeys()
        .some((key2) => key2 === `${key}/` || key2.startsWith(`${key}/`));
      return hasChildren ? { contentLength: 0, contentType: null } : null;
    });
  });

  function makeService(fileStorageMode, aclOverrides) {
    return createTrashService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode,
      aclService: aclOverrides ? createAclStub(aclOverrides) : aclStub,
    });
  }

  async function seedUserHome(username) {
    // The aclService is a stub in these tests, so no permission row is needed;
    // the home folder is a plain root-level directory.
    return await fileNodeService.createDirectory(null, username);
  }

  async function seedS3File(parentId, name, content) {
    const file = await fileNodeService.createFile(parentId, name);
    const s3Key = `key-${name}-${file.id}`;
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'active')`,
      [file.id, s3Key]
    );
    await dbRun(
      `INSERT INTO filecache (file_node_id, size, mime_type, content_hash) VALUES (?, ?, 'text/plain', NULL)`,
      [file.id, content.length]
    );
    await blobStore.uploadBlob(s3Key, Buffer.from(content));
    return { node: file, s3Key, content: Buffer.from(content) };
  }

  async function seedWebdavFile(parentId, name, content) {
    const file = await fileNodeService.createFile(parentId, name);
    const displayPath = await fileNodeService.getNodePath(file.id);
    await blobStore.uploadBlob(displayPath, Buffer.from(content));
    return { node: file, displayPath, content: Buffer.from(content) };
  }

  async function trashNode(nodeId) {
    const descendantIds = await fileNodeService.getDescendantIds(nodeId);
    await fileNodesStore.markSubtreeDeleted([...new Set([nodeId, ...descendantIds])]);
  }

  async function getNodeRow(id) {
    const res = await dbQuery(
      'SELECT id, name, parent_id, deleted_at FROM file_nodes WHERE id = ?',
      [id]
    );
    return res.rows[0] || null;
  }

  async function countRows(sql, params) {
    const res = await dbQuery(sql, params);
    return res.rows.length;
  }

  describe('resolveRestoreName', () => {
    it('returns the name unchanged when no live sibling conflicts', async () => {
      const home = await seedUserHome(`svc-rn-free-${Date.now()}`);
      const svc = makeService('s3');
      await expect(svc.resolveRestoreName(home.id, 'report.txt')).resolves.toBe('report.txt');
    });

    it('suffixes name (2).ext against a live sibling and keeps counting', async () => {
      const home = await seedUserHome(`svc-rn-conflict-${Date.now()}`);
      await fileNodeService.createFile(home.id, 'report.txt');
      await fileNodeService.createFile(home.id, 'report (2).txt');
      const svc = makeService('s3');
      await expect(svc.resolveRestoreName(home.id, 'report.txt')).resolves.toBe('report (3).txt');
    });

    it('handles extensionless names and claims co-restored names', async () => {
      const home = await seedUserHome(`svc-rn-noext-${Date.now()}`);
      await fileNodeService.createFile(home.id, 'notes');
      const svc = makeService('s3');
      await expect(svc.resolveRestoreName(home.id, 'notes')).resolves.toBe('notes (2)');
      await expect(svc.resolveRestoreName(home.id, 'notes', ['notes (2)'])).resolves.toBe(
        'notes (3)'
      );
    });
  });

  describe('restoreNode — S3 mode', () => {
    it('restores a trashed file in place and round-trips the content byte-identically', async () => {
      const home = await seedUserHome(`svc-restore-file-${Date.now()}`);
      const file = await seedS3File(home.id, 'roundtrip.txt', 'restore me exactly');
      await trashNode(file.node.id);
      expect((await getNodeRow(file.node.id)).deleted_at).not.toBeNull();

      const svc = makeService('s3');
      const result = await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      expect(result.messageCode).toBe(SERVER_MESSAGE_CODES.files.trashRestored);
      expect(result.nodeId).toBe(file.node.id);
      expect(result.restoredNodes).toEqual([file.node.id]);
      expect(result.finalPath).toBe(`/${home.name}/roundtrip.txt`);
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();

      // S3 content round-trip: the stable UUID key never moved; the blob is
      // byte-identical and the object_map row is still active.
      const objectRow = await dbQuery(
        "SELECT s3_key, status FROM object_map WHERE file_node_id = ? AND status = 'active'",
        [file.node.id]
      );
      expect(objectRow.rows).toHaveLength(1);
      expect(Buffer.from(blobStore.getBuffer(objectRow.rows[0].s3_key))).toEqual(file.content);
    });

    it('auto-restores trashed ancestors deepest-chain-first while their siblings stay trashed', async () => {
      const home = await seedUserHome(`svc-restore-chain-${Date.now()}`);
      const parentA = await fileNodeService.createDirectory(home.id, 'parent-a');
      const parentB = await fileNodeService.createDirectory(home.id, 'parent-b');
      const child = await fileNodeService.createDirectory(parentA.id, 'child');
      const file = await seedS3File(child.id, 'nested.txt', 'nested content');

      // Trash parentA (marks parentA + child + file) and a sibling folder.
      await trashNode(parentA.id);
      await trashNode(parentB.id);

      const svc = makeService('s3');
      const result = await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      // Windows-style path recreation: the chain (topmost ancestor → target)
      // and the target's subtree all come back.
      expect(result.restoredNodes).toEqual(
        expect.arrayContaining([parentA.id, child.id, file.node.id])
      );
      expect(result.restoredNodes).not.toContain(parentB.id);
      expect(result.finalPath).toBe(`/${home.name}/parent-a/child/nested.txt`);

      expect((await getNodeRow(parentA.id)).deleted_at).toBeNull();
      expect((await getNodeRow(child.id)).deleted_at).toBeNull();
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();
      // Siblings of the restored ancestors stay trashed.
      expect((await getNodeRow(parentB.id)).deleted_at).not.toBeNull();
    });

    it('renames the restored node when a LIVE sibling holds the name', async () => {
      const home = await seedUserHome(`svc-restore-suffix-${Date.now()}`);
      const file = await seedS3File(home.id, 'dup.txt', 'suffix me');
      await trashNode(file.node.id);
      await fileNodeService.createFile(home.id, 'dup.txt');

      const svc = makeService('s3');
      const result = await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      expect(result.finalPath).toBe(`/${home.name}/dup (2).txt`);
      expect((await getNodeRow(file.node.id)).name).toBe('dup (2).txt');
    });

    it('restores the SUBTREE of a trashed folder (every descendant untrashed)', async () => {
      const home = await seedUserHome(`svc-restore-folder-${Date.now()}`);
      const folder = await fileNodeService.createDirectory(home.id, 'folder');
      const inner = await fileNodeService.createDirectory(folder.id, 'inner');
      const file = await seedS3File(inner.id, 'deep.txt', 'deep content');

      await trashNode(folder.id);

      const svc = makeService('s3');
      const result = await svc.restoreNode(1, folder.id, { id: 1, is_admin: false });

      expect(result.restoredNodes).toEqual(
        expect.arrayContaining([folder.id, inner.id, file.node.id])
      );
      expect((await getNodeRow(folder.id)).deleted_at).toBeNull();
      expect((await getNodeRow(inner.id)).deleted_at).toBeNull();
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();
    });

    it('refuses a live node with 409 files.notTrashed and an unknown node with 404', async () => {
      const home = await seedUserHome(`svc-restore-live-${Date.now()}`);
      const file = await seedS3File(home.id, 'alive.txt', 'still live');
      const svc = makeService('s3');

      await expect(
        svc.restoreNode(1, file.node.id, { id: 1, is_admin: false })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.files.notTrashed,
      });
      await expect(svc.restoreNode(1, 99999999, { id: 1, is_admin: false })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('gates on write permission for the node and the first live parent (403); admin bypasses', async () => {
      const home = await seedUserHome(`svc-restore-perm-${Date.now()}`);
      const parent = await fileNodeService.createDirectory(home.id, 'perm-parent');
      const file = await seedS3File(parent.id, 'locked.txt', 'locked');
      await trashNode(file.node.id);

      // No write perm on the node → 403.
      const deniedNode = makeService('s3', { write: false, folderWrite: true });
      await expect(
        deniedNode.restoreNode(2, file.node.id, { id: 2, is_admin: false })
      ).rejects.toMatchObject({ status: 403 });

      // Write on the node but NOT on the live parent (move-dest precedent) → 403.
      const deniedParent = makeService('s3', { write: true, folderWrite: false });
      await expect(
        deniedParent.restoreNode(2, file.node.id, { id: 2, is_admin: false })
      ).rejects.toMatchObject({ status: 403 });
      expect((await getNodeRow(file.node.id)).deleted_at).not.toBeNull();

      // Admin bypasses both gates.
      const adminResult = await makeService('s3').restoreNode(1, file.node.id, ADMIN_USER);
      expect(adminResult.restoredNodes).toContain(file.node.id);
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();
    });
  });

  describe('restoreNode — WebDAV mode', () => {
    it('moves the trash entry back to the display path (no delete)', async () => {
      const home = await seedUserHome(`svc-wrestore-${Date.now()}`);
      const file = await seedWebdavFile(home.id, 'moved.txt', 'webdav round trip');

      // Simulate the P2 trash MOVE: the blob is parked at /.wea-trash/<id>.
      await trashNode(file.node.id);
      await blobStore.moveBlob(file.displayPath, buildTrashPath(file.node.id));
      blobStore.moveBlob.mockClear();
      blobStore.deleteBlob.mockClear();

      const svc = makeService('webdav');
      const result = await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      expect(result.finalPath).toBe(`/${home.name}/moved.txt`);
      expect(blobStore.moveBlob).toHaveBeenCalledWith(
        buildTrashPath(file.node.id),
        `/${home.name}/moved.txt`
      );
      // The only remote delete is the MOVE's own source removal (a real
      // WebDAV MOVE deletes the source entry) — no purge happened.
      expect(blobStore.deleteBlob.mock.calls.map((call) => call[0])).toEqual([
        buildTrashPath(file.node.id),
      ]);

      // Content round-trip byte-identical at the original display path.
      expect(Buffer.from(blobStore.getBuffer(`/${home.name}/moved.txt`))).toEqual(file.content);
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();
    });

    it('suffixes the move-back target against a live sibling collision', async () => {
      const home = await seedUserHome(`svc-wrestore-suffix-${Date.now()}`);
      const file = await seedWebdavFile(home.id, 'clash.txt', 'collision content');
      await trashNode(file.node.id);
      await blobStore.moveBlob(file.displayPath, buildTrashPath(file.node.id));
      // A live sibling takes the free name while the file is trashed.
      await fileNodeService.createFile(home.id, 'clash.txt');
      await blobStore.uploadBlob(`/${home.name}/clash.txt`, Buffer.from('live sibling'));

      const svc = makeService('webdav');
      await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      expect((await getNodeRow(file.node.id)).name).toBe('clash (2).txt');
      expect(blobStore.moveBlob).toHaveBeenCalledWith(
        buildTrashPath(file.node.id),
        `/${home.name}/clash (2).txt`
      );
      expect(Buffer.from(blobStore.getBuffer(`/${home.name}/clash (2).txt`))).toEqual(file.content);
    });

    it('restore of a nested file relies on the topmost ancestor collection move (covered leaf: no individual move)', async () => {
      const home = await seedUserHome(`svc-wrestore-nested-${Date.now()}`);
      const parent = await fileNodeService.createDirectory(home.id, 'wparent');
      const file = await seedWebdavFile(parent.id, 'inner.txt', 'nested webdav');

      await trashNode(parent.id); // marks parent + file; the collection move parks both
      await blobStore.moveBlob(`/${home.name}/wparent`, buildTrashPath(parent.id));
      blobStore.moveBlob.mockClear();
      blobStore.deleteBlob.mockClear();

      const svc = makeService('webdav');
      const result = await svc.restoreNode(1, file.node.id, { id: 1, is_admin: false });

      // The TOPMOST trashed ancestor (the folder) owns the collection entry:
      // one MOVE brings the whole subtree back, then the covered leaf needs
      // no individual move (its content came back with the collection).
      expect(blobStore.moveBlob).toHaveBeenCalledWith(
        buildTrashPath(parent.id),
        `/${home.name}/wparent`
      );
      expect(blobStore.moveBlob).toHaveBeenCalledTimes(1);
      expect(result.finalPath).toBe(`/${home.name}/wparent/inner.txt`);
      expect(Buffer.from(blobStore.getBuffer(`/${home.name}/wparent/inner.txt`))).toEqual(
        file.content
      );
      expect((await getNodeRow(parent.id)).deleted_at).toBeNull();
      expect((await getNodeRow(file.node.id)).deleted_at).toBeNull();
    });
  });

  describe('purgeTrashedNode', () => {
    it('S3 mode: purges the subtree physically — object_map rows + blobs gone (version rows too), FK cascade removes permission/share rows', async () => {
      const home = await seedUserHome(`svc-purge-s3-${Date.now()}`);
      const file = await seedS3File(home.id, 'purge-me.txt', 'purge content');
      const historyKey = `history-key-${file.node.id}`;
      // A managed history row (a prior overwrite version) + its blob.
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 2, 'history')`,
        [file.node.id, historyKey]
      );
      await blobStore.uploadBlob(historyKey, Buffer.from('old version'));
      // A permission row + share link that FK-cascade at purge time.
      await dbRun(
        `INSERT INTO permissions_user_files (user_id, file_node_id, permission, updated_at)
         VALUES (2, ?, 'read', datetime('now'))`,
        [file.node.id]
      );
      await dbRun(
        `INSERT INTO share_links (token, file_node_id, created_by, created_at, download_count)
         VALUES ('purge-tok', ?, 1, datetime('now'), 0)`,
        [file.node.id]
      );
      await trashNode(file.node.id);

      const svc = makeService('s3');
      const result = await svc.purgeTrashedNode(1, file.node.id, { id: 1, is_admin: false });

      expect(result.messageCode).toBe(SERVER_MESSAGE_CODES.files.trashPurged);
      expect(result.purgedNodes).toBe(1);
      expect(result.deletedBlobs).toBe(2); // active + history blobs (version rows die WITH the trash)
      expect(blobStore.getBuffer(file.s3Key)).toBeUndefined();
      expect(blobStore.getBuffer(historyKey)).toBeUndefined();
      // DB rows: node, object_map, closure, permission + share gone.
      expect(await getNodeRow(file.node.id)).toBeNull();
      expect(
        await countRows('SELECT id FROM object_map WHERE file_node_id = ?', [file.node.id])
      ).toBe(0);
      expect(
        await countRows('SELECT file_node_id FROM permissions_user_files WHERE file_node_id = ?', [
          file.node.id,
        ])
      ).toBe(0);
      expect(
        await countRows('SELECT file_node_id FROM share_links WHERE file_node_id = ?', [
          file.node.id,
        ])
      ).toBe(0);
      expect(
        await countRows('SELECT descendant_id FROM node_ancestors WHERE descendant_id = ?', [
          file.node.id,
        ])
      ).toBe(0);
    });

    it('refuses a live node with 409 files.notTrashed and gates on write permission (403)', async () => {
      const home = await seedUserHome(`svc-purge-gate-${Date.now()}`);
      const file = await seedS3File(home.id, 'live-purge.txt', 'do not purge');
      const svc = makeService('s3');

      await expect(
        svc.purgeTrashedNode(1, file.node.id, { id: 1, is_admin: false })
      ).rejects.toMatchObject({ status: 409, errorCode: SERVER_ERROR_CODES.files.notTrashed });
      expect(await getNodeRow(file.node.id)).not.toBeNull();

      const denied = makeService('s3', { write: false });
      await trashNode(file.node.id);
      await expect(
        denied.purgeTrashedNode(2, file.node.id, { id: 2, is_admin: false })
      ).rejects.toMatchObject({ status: 403 });
      expect(await getNodeRow(file.node.id)).not.toBeNull();
    });

    it('WebDAV mode: purges a topmost trashed node at its own trash path', async () => {
      const home = await seedUserHome(`svc-purge-top-${Date.now()}`);
      const file = await seedWebdavFile(home.id, 'top.txt', 'top purge');
      await trashNode(file.node.id);
      await blobStore.moveBlob(file.displayPath, buildTrashPath(file.node.id));
      blobStore.deleteBlob.mockClear();

      const svc = makeService('webdav');
      await svc.purgeTrashedNode(1, file.node.id, ADMIN_USER);

      expect(blobStore.deleteBlob).toHaveBeenCalledWith(buildTrashPath(file.node.id));
      expect(await getNodeRow(file.node.id)).toBeNull();
    });

    it('WebDAV mode: purges a trashed node nested under a still-trashed ancestor via the covered trash path', async () => {
      const home = await seedUserHome(`svc-purge-nested-${Date.now()}`);
      const parent = await fileNodeService.createDirectory(home.id, 'trash-parent');
      const file = await seedWebdavFile(parent.id, 'nested-purge.txt', 'nested purge');

      // Trash the PARENT (marks parent + file; content parked under the
      // parent's trash collection), then purge the nested FILE.
      await trashNode(parent.id);
      await blobStore.moveBlob(`/${home.name}/trash-parent`, buildTrashPath(parent.id));
      blobStore.deleteBlob.mockClear();

      const svc = makeService('webdav');
      await svc.purgeTrashedNode(1, file.node.id, ADMIN_USER);

      expect(blobStore.deleteBlob).toHaveBeenCalledWith(
        `${buildTrashPath(parent.id)}/nested-purge.txt`
      );
      // The file's own trash path is attempted too (missing here — swallowed).
      expect(blobStore.deleteBlob).toHaveBeenCalledWith(buildTrashPath(file.node.id));
      expect(await getNodeRow(file.node.id)).toBeNull();
      // The parent stays trashed.
      expect((await getNodeRow(parent.id)).deleted_at).not.toBeNull();
    });
  });

  describe('purgeNode — shared core + emptyTrash', () => {
    it('removes a LIVE node via the display-path remote cleanup (admin route path)', async () => {
      const home = await seedUserHome(`svc-purge-live-${Date.now()}`);
      const file = await seedWebdavFile(home.id, 'live-purge.txt', 'live purge');
      blobStore.deleteBlob.mockClear();

      const svc = makeService('webdav');
      await svc.purgeNode(file.node.id);

      expect(blobStore.deleteBlob).toHaveBeenCalledWith(file.displayPath);
      expect(await getNodeRow(file.node.id)).toBeNull();
    });

    it('emptyTrash purges every TOPMOST trashed root; nested trashed children die with their root', async () => {
      const home = await seedUserHome(`svc-empty-${Date.now()}`);
      const folderA = await fileNodeService.createDirectory(home.id, 'empty-a');
      const fileA = await seedS3File(folderA.id, 'in-a.txt', 'inside a');
      const folderB = await fileNodeService.createDirectory(home.id, 'empty-b');
      const fileB = await seedS3File(folderB.id, 'in-b.txt', 'inside b');

      await trashNode(folderA.id);
      await trashNode(folderB.id);

      // Expected counts are computed over the FULL caller-visible topmost set
      // (the suite shares one DB — residue trashed roots from earlier tests
      // are legitimately purged too, so the expectations are derived, not
      // hardcoded).
      const topmost = await fileNodesStore.getTopmostTrashedNodes();
      const topmostIds = new Set(topmost.map((root) => root.id));
      let expectedNodes = 0;
      let expectedBlobs = 0;
      for (const root of topmost) {
        const subtree = await fileNodesStore.getDescendants(root.id);
        expectedNodes += subtree.length;
        const objectRows = await fileNodesStore.getObjectMapBySubtree(root.id);
        expectedBlobs += objectRows.filter((row) => row.s3_key).length;
      }
      expect(topmostIds.has(folderA.id)).toBe(true);
      expect(topmostIds.has(folderB.id)).toBe(true);

      const svc = makeService('s3');
      const result = await svc.emptyTrash();

      expect(result.purgedNodes).toBe(expectedNodes);
      expect(result.purgedBlobs).toBe(expectedBlobs);
      expect(result.errors).toEqual([]);
      expect(await getNodeRow(folderA.id)).toBeNull();
      expect(await getNodeRow(folderB.id)).toBeNull();
      expect(await getNodeRow(fileA.node.id)).toBeNull();
      expect(await getNodeRow(fileB.node.id)).toBeNull();
      expect(blobStore.getBuffer(fileA.s3Key)).toBeUndefined();
      expect(blobStore.getBuffer(fileB.s3Key)).toBeUndefined();
      expect(await fileNodesStore.getTopmostTrashedNodes()).toEqual([]);
    });
  });
});
