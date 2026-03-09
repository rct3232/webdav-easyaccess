const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('permissionStore (postgresql) admin permission round-trip', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('preserves admin when granting and checking in postgresql mode', async () => {
    const state = {
      paths: [],
      files: [],
    };

    const upsertPath = (userId, folderPath, permission) => {
      const idx = state.paths.findIndex(
        (row) => row.user_id === Number(userId) && row.folder_path === folderPath
      );
      const row = {
        user_id: Number(userId),
        folder_path: folderPath,
        permission,
        updated_at: new Date(),
      };
      if (idx >= 0) state.paths[idx] = row;
      else state.paths.push(row);
    };

    const poolQuery = jest.fn(async (sql, params) => {
      const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes('FROM permissions_user_paths')) {
        const userId = Number(params[0]);
        return {
          rows: state.paths
            .filter((row) => row.user_id === userId)
            .map((row) => ({
              folder_path: row.folder_path,
              permission: row.permission,
              updated_at: row.updated_at,
            })),
        };
      }
      if (normalizedSql.includes('FROM permissions_user_files')) {
        const userId = Number(params[0]);
        return {
          rows: state.files
            .filter((row) => row.user_id === userId)
            .map((row) => ({
              file_path: row.file_path,
              permission: row.permission,
              updated_at: row.updated_at,
            })),
        };
      }
      throw new Error(`Unexpected pool query: ${normalizedSql}`);
    });

    const txQuery = jest.fn(async (sql, params) => {
      const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
      if (normalizedSql.startsWith('DELETE FROM permissions_user_paths')) {
        const userId = Number(params[0]);
        state.paths = state.paths.filter((row) => row.user_id !== userId);
        return { rowCount: 1 };
      }
      if (normalizedSql.startsWith('DELETE FROM permissions_user_files')) {
        const userId = Number(params[0]);
        state.files = state.files.filter((row) => row.user_id !== userId);
        return { rowCount: 1 };
      }
      if (normalizedSql.startsWith('INSERT INTO permissions_user_paths')) {
        upsertPath(params[0], params[1], params[2]);
        return { rowCount: 1 };
      }
      if (normalizedSql.startsWith('INSERT INTO permissions_user_files')) {
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected tx query: ${normalizedSql}`);
    });

    jest.doMock('../storage', () => ({
      getBackend: () => 'postgresql',
      getPgPool: () => ({ query: poolQuery }),
      withTransaction: async (callback) => callback({ query: txQuery }),
      ensureDir: jest.fn(),
      exists: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
    }));
    jest.doMock('../locks', () => ({
      withLock: async (_lockName, fn) => fn(),
    }));
    jest.doMock('../permissionExistenceIndex', () => ({
      invalidateExistenceIndexForAclMutation: jest.fn(),
    }));
    jest.doMock('../userStore', () => ({
      findById: jest.fn(),
    }));

    let permissionStore;
    jest.isolateModules(() => {
      permissionStore = require('../permissionStore');
    });

    await permissionStore.grant(77, '/team/home', PERMISSIONS.ADMIN);
    const doc = await permissionStore.getPermissionDoc(77);

    expect(doc.permissions['/team/home']).toBe(PERMISSIONS.ADMIN);
    await expect(
      permissionStore.checkPermission(77, '/team/home', PERMISSIONS.ADMIN)
    ).resolves.toBe(true);
  });
});
