/**
 * shareLinkStore tests.
 * Verifies createShareLink, getShareLink, getUserShareLinks, updateShareLink, deleteShareLink,
 * incrementDownloadCount, isLinkExpired against the real SQLite-backed store (nodeId contract).
 */
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createStorageMock } = require('@testing/mocks/storeMocks');
const shareLinkStore = require('../../../store/shareLinkStore');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
} = require('../../../test-utils');

function createPostgresqlShareLinkStorageMock() {
  const rows = new Map();
  let createdAtSeq = 0;

  const toRow = (link) => ({
    token: link.token,
    file_node_id: link.fileNodeId,
    created_by: link.createdBy,
    created_at: link.createdAt,
    expires_at: link.expiresAt,
    download_count: link.downloadCount,
  });

  const query = jest.fn(async (sql, params = []) => {
    if (sql.includes('SELECT *') && sql.includes('FROM share_links') && sql.includes('WHERE token = $1')) {
      const token = String(params[0]);
      const link = rows.get(token);
      return { rows: link ? [toRow(link)] : [], rowCount: link ? 1 : 0 };
    }

    if (sql.includes('INSERT INTO share_links') && sql.includes('RETURNING *')) {
      const [tokenRaw, fileNodeId, createdBy, expiresAt] = params;
      const token = String(tokenRaw);
      if (!rows.has(token)) {
        rows.set(token, {
          token,
          fileNodeId: Number(fileNodeId),
          createdBy: Number(createdBy),
          createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, createdAtSeq++)).toISOString(),
          expiresAt: expiresAt || null,
          downloadCount: 0,
        });
      }
      return { rows: [toRow(rows.get(token))], rowCount: 1 };
    }

    if (sql.includes('SELECT *') && sql.includes('FROM share_links') && sql.includes('WHERE created_by = $1')) {
      const createdBy = Number(params[0]);
      const ordered = Array.from(rows.values())
        .filter((link) => Number(link.createdBy) === createdBy)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(toRow);
      return { rows: ordered, rowCount: ordered.length };
    }

    if (sql.includes('UPDATE share_links') && sql.includes('SET download_count = download_count + 1')) {
      const token = String(params[0]);
      const current = rows.get(token);
      if (!current) return { rows: [], rowCount: 0 };
      current.downloadCount += 1;
      rows.set(token, current);
      return { rows: [toRow(current)], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM share_links') && sql.includes('WHERE token = $1')) {
      const token = String(params[0]);
      const existed = rows.delete(token);
      return { rows: [], rowCount: existed ? 1 : 0 };
    }

    throw new Error(`Unexpected SQL in shareLinkStore test mock: ${sql}`);
  });

  return createStorageMock({
    state: { rows },
    getBackend: () => 'postgresql',
    isSqliteBackend: () => false,
    getPgPool: () => ({ query }),
    withTransaction: async (callback) => callback({ query }),
  });
}

function loadShareLinkStoreWithStorageMock(storageMock) {
  let isolatedStore;
  jest.isolateModules(() => {
    jest.doMock('../../../store/storage', () => storageMock);
    isolatedStore = require('../../../store/shareLinkStore');
  });
  jest.dontMock('../../../store/storage');
  return isolatedStore;
}

describe('shareLinkStore', () => {
  let dbCleanup;
  let userId;
  let fileNodeId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const { user } = await createAuthenticatedTestUser();
    userId = user.id;
    const node = await createTestFileNode({ name: 'store-fixture.pdf' });
    fileNodeId = node.nodeId;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('createShareLink / getShareLink', () => {
    it('creates and retrieves link by token with nodeId', async () => {
      const link = await shareLinkStore.createShareLink({
        token: 'test-token-abc',
        fileNodeId,
        createdBy: userId,
        expiresInDays: 7,
      });
      expect(link).toMatchObject({
        token: 'test-token-abc',
        nodeId: fileNodeId,
        createdBy: userId,
        downloadCount: 0,
      });
      expect(link.filePath).toBeUndefined();

      const retrieved = await shareLinkStore.getShareLink('test-token-abc');
      expect(retrieved).toMatchObject({
        token: 'test-token-abc',
        nodeId: fileNodeId,
        createdBy: userId,
      });
    });

    it('getShareLink returns null for unknown token', async () => {
      const link = await shareLinkStore.getShareLink('nonexistent-token-xyz');
      expect(link).toBeNull();
    });
  });

  describe('getUserShareLinks', () => {
    it('returns links created by user', async () => {
      await shareLinkStore.createShareLink({
        token: 'user-link-1',
        fileNodeId,
        createdBy: userId,
        expiresInDays: 7,
      });
      const links = await shareLinkStore.getUserShareLinks(userId);
      expect(links.some((l) => l.token === 'user-link-1')).toBe(true);
      expect(links.every((l) => l.createdBy === userId)).toBe(true);
    });
  });

  describe('updateShareLink', () => {
    it('updates downloadCount without touching file_node_id', async () => {
      await shareLinkStore.createShareLink({
        token: 'update-token',
        fileNodeId,
        createdBy: userId,
        expiresInDays: 7,
      });
      const updated = await shareLinkStore.updateShareLink('update-token', {
        downloadCount: 5,
      });
      expect(updated.downloadCount).toBe(5);
      expect(updated.nodeId).toBe(fileNodeId);
    });

    it('rejects with 404 shareLinkNotFound for unknown token', async () => {
      await expect(
        shareLinkStore.updateShareLink('unknown-token-xyz', { downloadCount: 1 })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound,
      });
    });
  });

  describe('incrementDownloadCount', () => {
    it('increments count', async () => {
      await shareLinkStore.createShareLink({
        token: 'inc-token',
        fileNodeId,
        createdBy: userId,
        expiresInDays: 7,
      });
      const after = await shareLinkStore.incrementDownloadCount('inc-token');
      expect(after.downloadCount).toBe(1);
    });
  });

  describe('isLinkExpired', () => {
    it('returns false when expiresAt is null', () => {
      expect(shareLinkStore.isLinkExpired({ expiresAt: null })).toBe(false);
    });

    it('returns true when expiresAt is in past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      expect(shareLinkStore.isLinkExpired({ expiresAt: past.toISOString() })).toBe(true);
    });

    it('returns false when expiresAt is in future', () => {
      const future = new Date();
      future.setDate(future.getDate() + 1);
      expect(shareLinkStore.isLinkExpired({ expiresAt: future.toISOString() })).toBe(false);
    });
  });

  describe('deleteShareLink', () => {
    it('removes link', async () => {
      await shareLinkStore.createShareLink({
        token: 'delete-token',
        fileNodeId,
        createdBy: userId,
        expiresInDays: 7,
      });
      await shareLinkStore.deleteShareLink('delete-token');
      const link = await shareLinkStore.getShareLink('delete-token');
      expect(link).toBeNull();
    });
  });

  describe('postgresql concurrency regression', () => {
    it('preserves all concurrent incrementDownloadCount updates', async () => {
      const storageMock = createPostgresqlShareLinkStorageMock();
      const isolatedStore = loadShareLinkStoreWithStorageMock(storageMock);

      await isolatedStore.createShareLink({
        token: 'pg-concurrency-token',
        fileNodeId: 42,
        createdBy: 777,
        expiresInDays: 7,
      });

      const attempts = 24;
      await Promise.all(
        Array.from({ length: attempts }, () => isolatedStore.incrementDownloadCount('pg-concurrency-token'))
      );

      const finalLink = await isolatedStore.getShareLink('pg-concurrency-token');
      expect(finalLink.downloadCount).toBe(attempts);
    });
  });
});
