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

    const upsertPath = (userId, fileNodeId, permission) => {
      const idx = state.paths.findIndex(
        (row) => row.user_id === Number(userId) && row.file_node_id === fileNodeId
      );
      const row = {
        user_id: Number(userId),
        file_node_id: fileNodeId,
        permission,
        updated_at: new Date(),
      };
      if (idx >= 0) state.paths[idx] = row;
      else state.paths.push(row);
    };

    const poolQuery = jest.fn(async (sql, params) => {
      const s = String(sql);
      // checkPermission / ancestor traversal via node_ancestors JOIN — no rows means false
      if (s.includes('node_ancestors')) {
        return { rows: [] };
      }
      if (s.includes('permissions_user_paths')) {
        const userId = Number(params[0]);
        return {
          rows: state.paths
            .filter((row) => row.user_id === userId)
            .map((row) => ({
              file_node_id: row.file_node_id,
              permission: row.permission,
              updated_at: row.updated_at,
            })),
        };
      }
      if (s.includes('permissions_user_files')) {
        const userId = Number(params[0]);
        return {
          rows: state.files
            .filter((row) => row.user_id === userId)
            .map((row) => ({
              file_node_id: row.file_node_id,
              permission: row.permission,
              updated_at: row.updated_at,
            })),
        };
      }
      throw new Error(`Unexpected pool query: ${s}`);
    });

    const txQuery = jest.fn(async (sql, params) => {
      const s = String(sql);
      if (s.includes('DELETE FROM permissions_user_paths')) {
        const userId = Number(params[0]);
        state.paths = state.paths.filter((row) => row.user_id !== userId);
        return { rowCount: 1 };
      }
      if (s.includes('DELETE FROM permissions_user_files')) {
        const userId = Number(params[0]);
        state.files = state.files.filter((row) => row.user_id !== userId);
        return { rowCount: 1 };
      }
      if (s.includes('INSERT INTO permissions_user_paths')) {
        upsertPath(params[0], params[1], params[2]);
        return { rowCount: 1 };
      }
      if (s.includes('INSERT INTO permissions_user_files')) {
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected tx query: ${s}`);
    });

    jest.doMock('../../../../store/storage', () => {
      const { createStorageMock } = require('@testing/mocks/storeMocks');
      return createStorageMock({
        getBackend: () => 'postgresql',
        isSqliteBackend: () => false,
        getPgPool: () => ({ query: poolQuery }),
        withTransaction: async (callback) => callback({ query: txQuery }),
        ensureDir: jest.fn(),
        exists: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
      });
    });
    jest.doMock('../../../../infrastructure/lockManager', () => {
      const { createLockManagerMock } = require('@testing/mocks/storeMocks');
      return createLockManagerMock();
    });
    jest.doMock('../permissionExistenceIndex', () => ({
      invalidateExistenceIndexForAclMutation: jest.fn(),
    }));
    jest.doMock('../../../../store/userStore', () => {
      const { createUserStoreMock } = require('@testing/mocks/storeMocks');
      return createUserStoreMock();
    });

    let permissionStore;
    jest.isolateModules(() => {
      permissionStore = require('../permissionStore');
    });

    const testNodeId = 42;
    await permissionStore.grant(77, testNodeId, PERMISSIONS.ADMIN);
    const perms = await permissionStore.getUserPermissions(77);

    expect(perms).toEqual([
      expect.objectContaining({ file_node_id: testNodeId, permission: PERMISSIONS.ADMIN }),
    ]);
  });
});
