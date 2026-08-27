/**
 * Shared store mock factories for server tests.
 *
 * Follows the createXMock(overrides) pattern used by testing/mocks/webdavMock.js
 * and the "Shared factories" policy in docs/TESTING_STRATEGY.md.
 *
 * Defaults are deterministic and contract-shaped: they mirror the exported
 * surface of the real modules (server/store/storage.js, server/store/userStore.js,
 * server/domains/permissions/stores/permissionStore.js, server/infrastructure/lockManager.js).
 * Override only the behavior a given scenario needs.
 */

function createUserStoreMock(overrides = {}) {
  return {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    findByStatus: jest.fn(),
    createUser: jest.fn(),
    updateStatus: jest.fn(),
    updateEmail: jest.fn(),
    updatePassword: jest.fn(),
    deleteUser: jest.fn(),
    ...overrides,
  };
}

function createStorageMock(overrides = {}) {
  return {
    getBackend: () => 'sqlite',
    isSqliteBackend: () => true,
    getPgPool: jest.fn(),
    withTransaction: jest.fn(),
    closePgPool: jest.fn(),
    getSqliteConnection: jest.fn(),
    sqliteQuery: jest.fn(),
    sqliteRun: jest.fn(),
    withSqliteTransaction: jest.fn(),
    closeSqliteDb: jest.fn(),
    ...overrides,
  };
}

function createPermissionStoreMock(overrides = {}) {
  return {
    grant: jest.fn(),
    revoke: jest.fn(),
    checkPermission: jest.fn(),
    getFilePermission: jest.fn(),
    getUserPermissions: jest.fn(),
    checkSharePermission: jest.fn(),
    grantSharePermission: jest.fn(),
    revokeSharePermission: jest.fn(),
    revokeAllUserPermissions: jest.fn(),
    deleteUserPermissionsFile: jest.fn(),
    checkPermissions: jest.fn(),
    getFolderPermissions: jest.fn(),
    hasPermissionsInPath: jest.fn(),
    getEffectivePermission: jest.fn(),
    grantFilePermission: jest.fn(),
    revokeFilePermission: jest.fn(),
    getUserFilePermissions: jest.fn(),
    getPathEffectivePermission: jest.fn(),
    ...overrides,
  };
}

function createLockManagerMock(overrides = {}) {
  return {
    withLock: async (_name, fn) => fn(),
    acquireLock: jest.fn(),
    ...overrides,
  };
}

module.exports = {
  createUserStoreMock,
  createStorageMock,
  createPermissionStoreMock,
  createLockManagerMock,
};
