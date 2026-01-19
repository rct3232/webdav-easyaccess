/**
 * Unit tests for Permission model
 * Tests all permission operations and access control logic
 */

const Permission = require('../Permission');
const User = require('../User');
const {
  setupTestStore,
  resetTestStore,
  teardownTestStore,
  createTestUser
} = require('../../test-utils');

describe('Permission Model', () => {
  let testUser1;
  let testUser2;

  beforeAll(async () => {
    await setupTestStore();
  });

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    testUser1 = await createTestUser({ username: 'user1', email: 'user1@example.com' });
    testUser2 = await createTestUser({ username: 'user2', email: 'user2@example.com' });
  });

  describe('grant', () => {
    it('should grant read permission', async () => {
      const result = await Permission.grant(testUser1.id, '/folder', 'read');

      expect(result).toBeDefined();
      expect(result.userId).toBe(testUser1.id);
      expect(result.folderPath).toBe('/folder');
      expect(result.permission).toBe('read');
    });

    it('should grant write permission', async () => {
      const result = await Permission.grant(testUser1.id, '/folder', 'write');

      expect(result.permission).toBe('write');
    });

    it('should replace existing permission', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      const result = await Permission.grant(testUser1.id, '/folder', 'write');

      expect(result.permission).toBe('write');

      const permissions = await Permission.getUserPermissions(testUser1.id);
      expect(permissions).toHaveLength(1);
      expect(permissions[0].permission).toBe('write');
    });

    it('should allow multiple permissions for different folders', async () => {
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser1.id, '/folder2', 'write');

      const permissions = await Permission.getUserPermissions(testUser1.id);
      expect(permissions).toHaveLength(2);
    });

    it('should allow different users to have permissions on same folder', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      await Permission.grant(testUser2.id, '/folder', 'write');

      const user1Perms = await Permission.getUserPermissions(testUser1.id);
      const user2Perms = await Permission.getUserPermissions(testUser2.id);

      expect(user1Perms).toHaveLength(1);
      expect(user2Perms).toHaveLength(1);
      expect(user1Perms[0].permission).toBe('read');
      expect(user2Perms[0].permission).toBe('write');
    });
  });

  describe('revoke', () => {
    it('should revoke permission', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      const result = await Permission.revoke(testUser1.id, '/folder');

      expect(result.success).toBe(true);

      const permissions = await Permission.getUserPermissions(testUser1.id);
      expect(permissions).toHaveLength(0);
    });

    it('should not error when revoking non-existent permission', async () => {
      const result = await Permission.revoke(testUser1.id, '/nonexistent');
      expect(result.success).toBe(true);
    });

    it('should only revoke specific user-folder combination', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      await Permission.grant(testUser2.id, '/folder', 'write');
      await Permission.grant(testUser1.id, '/other', 'read');

      await Permission.revoke(testUser1.id, '/folder');

      const user1Perms = await Permission.getUserPermissions(testUser1.id);
      const user2Perms = await Permission.getUserPermissions(testUser2.id);

      expect(user1Perms).toHaveLength(1);
      expect(user1Perms[0].folder_path).toBe('/other');
      expect(user2Perms).toHaveLength(1);
    });
  });

  describe('revokeAllUserPermissions', () => {
    it('should revoke all permissions for a user', async () => {
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser1.id, '/folder2', 'write');
      await Permission.grant(testUser1.id, '/folder3', 'admin');

      const result = await Permission.revokeAllUserPermissions(testUser1.id);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);

      const permissions = await Permission.getUserPermissions(testUser1.id);
      expect(permissions).toHaveLength(0);
    });

    it('should not affect other users permissions', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      await Permission.grant(testUser2.id, '/folder', 'write');

      await Permission.revokeAllUserPermissions(testUser1.id);

      const user2Perms = await Permission.getUserPermissions(testUser2.id);
      expect(user2Perms).toHaveLength(1);
    });

    it('should return 0 deletedCount for user with no permissions', async () => {
      const result = await Permission.revokeAllUserPermissions(testUser1.id);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
    });
  });

  describe('getUserPermissions', () => {
    it('should get all permissions for a user', async () => {
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser1.id, '/folder2', 'write');

      const permissions = await Permission.getUserPermissions(testUser1.id);

      expect(permissions).toHaveLength(2);
      expect(permissions[0].folder_path).toBeDefined();
      expect(permissions[0].permission).toBeDefined();
    });

    it('should return empty array for user with no permissions', async () => {
      const permissions = await Permission.getUserPermissions(testUser1.id);
      expect(permissions).toEqual([]);
    });

    it('should only return permissions for specified user', async () => {
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser2.id, '/folder2', 'write');

      const user1Perms = await Permission.getUserPermissions(testUser1.id);

      expect(user1Perms).toHaveLength(1);
      expect(user1Perms[0].folder_path).toBe('/folder1');
    });
  });

  describe('checkPermission', () => {
    beforeEach(async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
    });

    it('should return true for exact permission match', async () => {
      const hasPermission = await Permission.checkPermission(testUser1.id, '/folder', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should return false for insufficient permission', async () => {
      const hasPermission = await Permission.checkPermission(testUser1.id, '/folder', 'write');
      expect(hasPermission).toBe(false);
    });

    it('should return false for non-existent permission', async () => {
      const hasPermission = await Permission.checkPermission(testUser1.id, '/other', 'read');
      expect(hasPermission).toBe(false);
    });

    it('should support permission hierarchy: write includes read', async () => {
      await Permission.grant(testUser2.id, '/folder', 'write');

      const hasRead = await Permission.checkPermission(testUser2.id, '/folder', 'read');
      const hasWrite = await Permission.checkPermission(testUser2.id, '/folder', 'write');

      expect(hasRead).toBe(true);
      expect(hasWrite).toBe(true);
    });

    it('should support permission hierarchy: admin includes all', async () => {
      await Permission.grant(testUser2.id, '/folder', 'admin');

      const hasRead = await Permission.checkPermission(testUser2.id, '/folder', 'read');
      const hasWrite = await Permission.checkPermission(testUser2.id, '/folder', 'write');
      const hasAdmin = await Permission.checkPermission(testUser2.id, '/folder', 'admin');

      expect(hasRead).toBe(true);
      expect(hasWrite).toBe(true);
      expect(hasAdmin).toBe(true);
    });

    it('should return false for user without any permissions', async () => {
      const hasPermission = await Permission.checkPermission(testUser2.id, '/folder', 'read');
      expect(hasPermission).toBe(false);
    });
  });

  describe('getFolderPermissions', () => {
    it('should get all users with permission for a folder', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');
      await Permission.grant(testUser2.id, '/folder', 'write');

      const permissions = await Permission.getFolderPermissions('/folder');

      expect(permissions).toHaveLength(2);
      expect(permissions[0].username).toBeDefined();
      expect(permissions[0].email).toBeDefined();
      expect(permissions[0].permission).toBeDefined();
    });

    it('should return empty array for folder with no permissions', async () => {
      const permissions = await Permission.getFolderPermissions('/empty');
      expect(permissions).toEqual([]);
    });

    it('should include user details in results', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');

      const permissions = await Permission.getFolderPermissions('/folder');

      expect(permissions[0].id).toBe(testUser1.id);
      expect(permissions[0].username).toBe('user1');
      expect(permissions[0].email).toBe('user1@example.com');
      expect(permissions[0].is_admin).toBeDefined();
    });

    it('should only return permissions for specified folder', async () => {
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser2.id, '/folder2', 'write');

      const permissions = await Permission.getFolderPermissions('/folder1');

      expect(permissions).toHaveLength(1);
      expect(permissions[0].username).toBe('user1');
    });
  });

  describe('hasPermissionsInPath', () => {
    it('should find permissions in exact path', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');

      const permissions = await Permission.hasPermissionsInPath('/folder');

      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions[0].folder_path).toBe('/folder');
    });

    it('should find permissions in subfolders', async () => {
      await Permission.grant(testUser1.id, '/folder/sub1', 'read');
      await Permission.grant(testUser2.id, '/folder/sub2', 'write');

      const permissions = await Permission.hasPermissionsInPath('/folder');

      expect(permissions.length).toBeGreaterThanOrEqual(2);
    });

    it('should normalize paths with trailing slash', async () => {
      await Permission.grant(testUser1.id, '/folder/', 'read');

      const permissions = await Permission.hasPermissionsInPath('/folder');

      expect(permissions.length).toBeGreaterThan(0);
    });

    it('should handle root path', async () => {
      await Permission.grant(testUser1.id, '/', 'read');
      await Permission.grant(testUser2.id, '/folder', 'write');

      const permissions = await Permission.hasPermissionsInPath('/');

      expect(permissions.length).toBeGreaterThanOrEqual(1);
    });

    it('should not include parent path permissions', async () => {
      await Permission.grant(testUser1.id, '/parent', 'read');

      const permissions = await Permission.hasPermissionsInPath('/parent/child');

      // Should not find parent permission when searching for child path
      const parentPerms = permissions.filter(p => p.folder_path === '/parent');
      expect(parentPerms).toHaveLength(0);
    });

    it('should include user details', async () => {
      await Permission.grant(testUser1.id, '/folder', 'read');

      const permissions = await Permission.hasPermissionsInPath('/folder');

      expect(permissions[0].username).toBe('user1');
      expect(permissions[0].email).toBe('user1@example.com');
      expect(permissions[0].permission).toBe('read');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete permission lifecycle', async () => {
      // Grant permission
      await Permission.grant(testUser1.id, '/project', 'read');
      let hasRead = await Permission.checkPermission(testUser1.id, '/project', 'read');
      expect(hasRead).toBe(true);

      // Upgrade permission
      await Permission.grant(testUser1.id, '/project', 'write');
      let hasWrite = await Permission.checkPermission(testUser1.id, '/project', 'write');
      expect(hasWrite).toBe(true);

      // Check folder permissions
      let folderPerms = await Permission.getFolderPermissions('/project');
      expect(folderPerms).toHaveLength(1);
      expect(folderPerms[0].permission).toBe('write');

      // Revoke permission
      await Permission.revoke(testUser1.id, '/project');
      hasRead = await Permission.checkPermission(testUser1.id, '/project', 'read');
      expect(hasRead).toBe(false);
    });

    it('should handle multiple users and folders', async () => {
      // Setup complex permission structure
      await Permission.grant(testUser1.id, '/folder1', 'read');
      await Permission.grant(testUser1.id, '/folder2', 'write');
      await Permission.grant(testUser2.id, '/folder1', 'write');
      await Permission.grant(testUser2.id, '/folder3', 'admin');

      // Verify user1 permissions
      const user1Perms = await Permission.getUserPermissions(testUser1.id);
      expect(user1Perms).toHaveLength(2);

      // Verify user2 permissions
      const user2Perms = await Permission.getUserPermissions(testUser2.id);
      expect(user2Perms).toHaveLength(2);

      // Verify folder1 has both users
      const folder1Perms = await Permission.getFolderPermissions('/folder1');
      expect(folder1Perms).toHaveLength(2);

      // Cleanup user1
      await Permission.revokeAllUserPermissions(testUser1.id);
      const remainingPerms = await Permission.getUserPermissions(testUser1.id);
      expect(remainingPerms).toHaveLength(0);

      // Verify user2 still has permissions
      const user2RemainingPerms = await Permission.getUserPermissions(testUser2.id);
      expect(user2RemainingPerms).toHaveLength(2);
    });
  });
});

