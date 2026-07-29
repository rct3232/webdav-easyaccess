/**
 * shareLinkStore tests.
 * Verifies createShareLink, getShareLink, getUserShareLinks, updateShareLink, deleteShareLink,
 * incrementDownloadCount, isLinkExpired.
 */
const shareLinkStore = require('../../../store/shareLinkStore');
const { createTestDatabase, createAuthenticatedTestUser } = require('../../../test-utils');

function tokenFromShareLinkPath(filePath) {
  const match = String(filePath || '').match(/\/\.wea\/share-links\/(.+)\.json$/);
  return match ? match[1] : null;
}

function createFsShareLinkStorageMock() {
  const links = new Map();
  return {
    state: { links },
    getBackend: () => 'fs',
    ensureDirSafe: jest.fn(async () => {}),
    ensureDir: jest.fn(async () => {}),
    exists: jest.fn(async (filePath) => links.has(tokenFromShareLinkPath(filePath))),
    readFile: jest.fn(async (filePath) => {
      const token = tokenFromShareLinkPath(filePath);
      const link = links.get(token);
      if (!link) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return Buffer.from(JSON.stringify(link));
    }),
    writeFile: jest.fn(async (filePath, payload) => {
      const token = tokenFromShareLinkPath(filePath);
      links.set(token, JSON.parse(String(payload)));
    }),
    deletePath: jest.fn(async (filePath) => {
      links.delete(tokenFromShareLinkPath(filePath));
    }),
    listDir: jest.fn(async () =>
      Array.from(links.keys()).map((token) => ({ basename: `${token}.json`, type: 'file' }))
    ),
  };
}

function createPostgresqlShareLinkStorageMock() {
  const rows = new Map();
  let createdAtSeq = 0;

  const toRow = (link) => ({
    token: link.token,
    file_path: link.filePath,
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
      const [tokenRaw, filePath, createdBy, expiresAt] = params;
      const token = String(tokenRaw);
      if (!rows.has(token)) {
        rows.set(token, {
          token,
          filePath,
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

    if (sql.includes('UPDATE share_links') && sql.includes('SET file_path = $2')) {
      const token = String(params[0]);
      const current = rows.get(token);
      if (!current) return { rows: [], rowCount: 0 };
      current.filePath = params[1];
      current.expiresAt = params[2] || null;
      current.downloadCount = Number(params[3] || 0);
      rows.set(token, current);
      return { rows: [toRow(current)], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM share_links') && sql.includes('WHERE token = $1')) {
      const token = String(params[0]);
      const existed = rows.delete(token);
      return { rows: [], rowCount: existed ? 1 : 0 };
    }

    if (sql.includes('UPDATE share_links') && sql.includes('SET download_count = download_count + 1')) {
      const token = String(params[0]);
      const current = rows.get(token);
      if (!current) return { rows: [], rowCount: 0 };
      current.downloadCount += 1;
      rows.set(token, current);
      return { rows: [toRow(current)], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in shareLinkStore test mock: ${sql}`);
  });

  return {
    state: { rows },
    getBackend: () => 'postgresql',
    getPgPool: () => ({ query }),
    withTransaction: async (callback) => callback({ query }),
  };
}

function loadShareLinkStoreWithStorageMock(storageMock) {
  // Directly instantiate the appropriate metadata adapter with mocked storage.
  const backend = storageMock.getBackend();

  let AdapterModulePath;
  if (backend === 'postgresql') {
    AdapterModulePath = '../../../infrastructure/adapters/metadata/PostgresqlMetadataAdapter';
  } else if (backend === 'sqlite') {
    AdapterModulePath = '../../../infrastructure/adapters/metadata/SqliteMetadataAdapter';
  } else {
    AdapterModulePath = '../../../infrastructure/adapters/metadata/FsJsonMetadataAdapter';
  }

  let adapter;
  jest.isolateModules(() => {
    // Mock storage at the path relative to this test file (resolves to server/store/storage.js)
    jest.doMock('../../../store/storage', () => storageMock);
    const AdapterFactory = require(AdapterModulePath);
    adapter = AdapterFactory();
  });
  jest.dontMock('../../../store/storage');

  return adapter;
}

function projectShareLink(link) {
  if (!link) return null;
  return {
    token: link.token,
    filePath: link.filePath,
    createdBy: Number(link.createdBy),
    downloadCount: Number(link.downloadCount),
    hasExpiresAt: Boolean(link.expiresAt),
  };
}

describe('shareLinkStore', () => {
  let dbCleanup;
  let userId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const { user } = await createAuthenticatedTestUser();
    userId = user.id;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('createShareLink / getShareLink', () => {
    it('creates and retrieves link by token', async () => {
      const link = await shareLinkStore.createShareLink({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      expect(link).toMatchObject({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
        createdBy: userId,
        downloadCount: 0,
      });

      const retrieved = await shareLinkStore.getShareLink('test-token-abc');
      expect(retrieved).toMatchObject({
        token: 'test-token-abc',
        filePath: '/docs/store-link.pdf',
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
        filePath: '/a.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      const links = await shareLinkStore.getUserShareLinks(userId);
      expect(links.some((l) => l.token === 'user-link-1')).toBe(true);
    });
  });

  describe('updateShareLink', () => {
    it('updates link', async () => {
      await shareLinkStore.createShareLink({
        token: 'update-token',
        filePath: '/x.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      const updated = await shareLinkStore.updateShareLink('update-token', {
        downloadCount: 5,
      });
      expect(updated.downloadCount).toBe(5);
    });
  });

  describe('incrementDownloadCount', () => {
    it('increments count', async () => {
      await shareLinkStore.createShareLink({
        token: 'inc-token',
        filePath: '/inc.pdf',
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
  });

  describe('deleteShareLink', () => {
    it('removes link', async () => {
      await shareLinkStore.createShareLink({
        token: 'delete-token',
        filePath: '/del.pdf',
        createdBy: userId,
        expiresInDays: 7,
      });
      await shareLinkStore.deleteShareLink('delete-token');
      const link = await shareLinkStore.getShareLink('delete-token');
      expect(link).toBeNull();
    });
  });

  describe('backend parity (fs vs postgresql)', () => {
    async function runSharedScenario(backend) {
      const storageMock = backend === 'postgresql'
        ? createPostgresqlShareLinkStorageMock()
        : createFsShareLinkStorageMock();
      const isolatedStore = loadShareLinkStoreWithStorageMock(storageMock);

      await isolatedStore.createShareLink({
        token: 'parity-token-a',
        filePath: '/parity/a.txt',
        createdBy: 101,
        expiresInDays: 2,
      });
      await isolatedStore.createShareLink({
        token: 'parity-token-b',
        filePath: '/parity/b.txt',
        createdBy: 101,
        expiresInDays: 5,
      });
      await isolatedStore.createShareLink({
        token: 'parity-token-c',
        filePath: '/parity/c.txt',
        createdBy: 202,
        expiresInDays: 7,
      });

      const fetchedA = await isolatedStore.getShareLink('parity-token-a');
      const linksByUser = await isolatedStore.getUserShareLinks(101);
      const updatedA = await isolatedStore.updateShareLink('parity-token-a', {
        filePath: '/parity/a-updated.txt',
        downloadCount: 3,
      });
      const incrementedA = await isolatedStore.incrementDownloadCount('parity-token-a');
      const unknown = await isolatedStore.getShareLink('parity-unknown');
      await isolatedStore.deleteShareLink('parity-token-b');
      const deleted = await isolatedStore.getShareLink('parity-token-b');

      return {
        fetchedA: projectShareLink(fetchedA),
        user101Tokens: linksByUser.map((link) => link.token),
        updatedA: projectShareLink(updatedA),
        incrementedA: projectShareLink(incrementedA),
        unknown,
        deleted,
      };
    }

    it('keeps observable behavior aligned for fs and postgresql backends', async () => {
      const fsResult = await runSharedScenario('fs');
      const pgResult = await runSharedScenario('postgresql');

      expect(fsResult.fetchedA).toEqual(pgResult.fetchedA);
      expect([...fsResult.user101Tokens].sort()).toEqual([...pgResult.user101Tokens].sort());
      expect(fsResult.updatedA).toEqual(pgResult.updatedA);
      expect(fsResult.incrementedA).toEqual(pgResult.incrementedA);
      expect(fsResult.unknown).toBeNull();
      expect(pgResult.unknown).toBeNull();
      expect(fsResult.deleted).toBeNull();
      expect(pgResult.deleted).toBeNull();
    });
  });

  describe('postgresql concurrency regression', () => {
    it('preserves all concurrent incrementDownloadCount updates', async () => {
      const storageMock = createPostgresqlShareLinkStorageMock();
      const isolatedStore = loadShareLinkStoreWithStorageMock(storageMock);

      await isolatedStore.createShareLink({
        token: 'pg-concurrency-token',
        filePath: '/race/shared.pdf',
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
