/**
 * permissionStore tests.
 * Verifies grant, revoke, getUserPermissions, checkPermission, getPermissionDoc, checkPermissionSync.
 */
const permissionStore = require('../permissionStore');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../test-utils');

describe('permissionStore', () => {
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

  describe('grant / revoke / getUserPermissions', () => {
    it('grants permission and getUserPermissions returns it', async () => {
      await permissionStore.grant(userId, '/store-perm-test', PERMISSIONS.READ);
      const perms = await permissionStore.getUserPermissions(userId);
      expect(perms).toContainEqual({
        folder_path: '/store-perm-test',
        permission: PERMISSIONS.READ,
      });
    });

    it('revokes permission', async () => {
      await permissionStore.grant(userId, '/revoke-store-test', PERMISSIONS.WRITE);
      await permissionStore.revoke(userId, '/revoke-store-test');
      const perms = await permissionStore.getUserPermissions(userId);
      expect(perms.some((p) => p.folder_path === '/revoke-store-test')).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('returns true when user has permission', async () => {
      await permissionStore.grant(userId, '/check-path', PERMISSIONS.WRITE);
      const ok = await permissionStore.checkPermission(userId, '/check-path', PERMISSIONS.READ);
      expect(ok).toBe(true);
    });

    it('returns false when user has no permission', async () => {
      const ok = await permissionStore.checkPermission(userId, '/no-perm-path', PERMISSIONS.READ);
      expect(ok).toBe(false);
    });
  });

  describe('getPermissionDoc / checkPermissionSync', () => {
    it('checkPermissionSync returns true when doc has path', async () => {
      await permissionStore.grant(userId, '/sync-store-test', PERMISSIONS.ADMIN);
      const doc = await permissionStore.getPermissionDoc(userId);
      const ok = permissionStore.checkPermissionSync(doc, '/sync-store-test', PERMISSIONS.READ);
      expect(ok).toBe(true);
    });
  });

  describe('revokeAllUserPermissions', () => {
    it('removes all permissions', async () => {
      await permissionStore.grant(userId, '/all1', PERMISSIONS.READ);
      await permissionStore.grant(userId, '/all2', PERMISSIONS.WRITE);
      const result = await permissionStore.revokeAllUserPermissions(userId);
      expect(result.success).toBe(true);
      const perms = await permissionStore.getUserPermissions(userId);
      expect(perms.filter((p) => p.folder_path === '/all1' || p.folder_path === '/all2')).toHaveLength(0);
    });
  });
});
