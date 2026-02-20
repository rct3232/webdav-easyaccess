/**
 * Permission model tests.
 * Verifies grant, revoke, checkPermission, getUserPermissions, checkPermissionSync.
 */
const Permission = require('../Permission');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../test-utils');

describe('Permission model', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('grant / revoke / getUserPermissions', () => {
    it('grants permission and getUserPermissions returns it', async () => {
      const { user } = await createAuthenticatedTestUser();
      await Permission.grant(user.id, '/shared', PERMISSIONS.READ);
      const perms = await Permission.getUserPermissions(user.id);
      expect(perms).toContainEqual({ folder_path: '/shared', permission: PERMISSIONS.READ });
    });

    it('revokes permission and getUserPermissions no longer includes it', async () => {
      const { user } = await createAuthenticatedTestUser();
      await Permission.grant(user.id, '/revoke-test', PERMISSIONS.WRITE);
      let perms = await Permission.getUserPermissions(user.id);
      expect(perms.some((p) => p.folder_path === '/revoke-test')).toBe(true);

      await Permission.revoke(user.id, '/revoke-test');
      perms = await Permission.getUserPermissions(user.id);
      expect(perms.some((p) => p.folder_path === '/revoke-test')).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('returns true when user has sufficient permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      await Permission.grant(user.id, '/docs', PERMISSIONS.WRITE);
      const ok = await Permission.checkPermission(user.id, '/docs', PERMISSIONS.READ);
      expect(ok).toBe(true);
    });

    it('returns false when user has no permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      const ok = await Permission.checkPermission(user.id, '/other/path', PERMISSIONS.READ);
      expect(ok).toBe(false);
    });

    it('returns false when user has read but needs write', async () => {
      const { user } = await createAuthenticatedTestUser();
      await Permission.grant(user.id, '/read-only', PERMISSIONS.READ);
      const ok = await Permission.checkPermission(user.id, '/read-only', PERMISSIONS.WRITE);
      expect(ok).toBe(false);
    });
  });

  describe('checkPermissionSync', () => {
    it('returns true when doc contains matching permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      await Permission.grant(user.id, '/sync-test', PERMISSIONS.ADMIN);
      const doc = await Permission.getPermissionDoc(user.id);
      const ok = Permission.checkPermissionSync(doc, '/sync-test', PERMISSIONS.READ);
      expect(ok).toBe(true);
    });

    it('returns false when doc has no permission for path', async () => {
      const { user } = await createAuthenticatedTestUser();
      const doc = await Permission.getPermissionDoc(user.id);
      const ok = Permission.checkPermissionSync(doc, '/nonexistent', PERMISSIONS.READ);
      expect(ok).toBe(false);
    });
  });
});
