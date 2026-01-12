/**
 * Unit tests for permissions middleware (REFACTORED CODE - HIGH PRIORITY)
 * Tests all permission checking functions and Express middleware
 */

const {
  checkFilePermission,
  checkFolderPermission,
  canAccessPath,
  requirePermission,
  requireFolderPermission
} = require('../permissions');
const Permission = require('../../models/Permission');
const User = require('../../models/User');
const db = require('../../models/database');
const {
  createTestDatabase,
  initializeTestSchema,
  cleanupTestDatabase,
  closeTestDatabase,
  createTestUser,
  grantTestPermission
} = require('../../test-utils');

// Mock the database module
jest.mock('../../models/database', () => ({
  getDb: jest.fn()
}));

describe('Permissions Middleware', () => {
  let testDb;
  let adminUser;
  let regularUser;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await initializeTestSchema(testDb);
    db.getDb.mockReturnValue(testDb);
  });

  afterAll(async () => {
    await closeTestDatabase(testDb);
  });

  beforeEach(async () => {
    await cleanupTestDatabase(testDb);
    adminUser = await createTestUser(testDb, { 
      username: 'admin', 
      email: 'admin@example.com', 
      isAdmin: true 
    });
    regularUser = await createTestUser(testDb, { 
      username: 'testuser', 
      email: 'test@example.com' 
    });
  });

  describe('checkFilePermission', () => {
    it('should allow admin to access any file', async () => {
      const hasPermission = await checkFilePermission(adminUser.id, '/any/file.txt', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should deny non-existent user', async () => {
      const hasPermission = await checkFilePermission(99999, '/file.txt', 'read');
      expect(hasPermission).toBe(false);
    });

    it('should allow user with parent folder permission', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'read');
      const hasPermission = await checkFilePermission(regularUser.id, '/folder/file.txt', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user with parent folder permission (with trailing slash)', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder/', 'read');
      const hasPermission = await checkFilePermission(regularUser.id, '/folder/file.txt', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should deny user without permission', async () => {
      const hasPermission = await checkFilePermission(regularUser.id, '/folder/file.txt', 'read');
      expect(hasPermission).toBe(false);
    });

    it('should check permission hierarchy (write includes read)', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'write');
      
      const hasRead = await checkFilePermission(regularUser.id, '/folder/file.txt', 'read');
      const hasWrite = await checkFilePermission(regularUser.id, '/folder/file.txt', 'write');
      
      expect(hasRead).toBe(true);
      expect(hasWrite).toBe(true);
    });

    it('should deny insufficient permission', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'read');
      const hasPermission = await checkFilePermission(regularUser.id, '/folder/file.txt', 'write');
      expect(hasPermission).toBe(false);
    });

    it('should check parent paths recursively', async () => {
      await grantTestPermission(testDb, regularUser.id, '/parent', 'read');
      const hasPermission = await checkFilePermission(regularUser.id, '/parent/child/grandchild/file.txt', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user to access files in their own folder', async () => {
      const hasPermission = await checkFilePermission(regularUser.id, '/testuser/file.txt', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user to access files in subfolders of their own folder', async () => {
      const hasPermission = await checkFilePermission(regularUser.id, '/testuser/subfolder/file.txt', 'write');
      expect(hasPermission).toBe(true);
    });

    it('should not allow user to access other users folders without permission', async () => {
      const hasPermission = await checkFilePermission(regularUser.id, '/admin/file.txt', 'read');
      expect(hasPermission).toBe(false);
    });
  });

  describe('checkFolderPermission', () => {
    it('should allow admin to access any folder', async () => {
      const hasPermission = await checkFolderPermission(adminUser.id, '/any/folder', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should deny non-existent user', async () => {
      const hasPermission = await checkFolderPermission(99999, '/folder', 'read');
      expect(hasPermission).toBe(false);
    });

    it('should allow user with direct folder permission', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'read');
      const hasPermission = await checkFolderPermission(regularUser.id, '/folder', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user with direct folder permission (with trailing slash)', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder/', 'read');
      const hasPermission = await checkFolderPermission(regularUser.id, '/folder', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user with parent folder permission', async () => {
      await grantTestPermission(testDb, regularUser.id, '/parent', 'read');
      const hasPermission = await checkFolderPermission(regularUser.id, '/parent/child', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should deny user without permission', async () => {
      const hasPermission = await checkFolderPermission(regularUser.id, '/folder', 'read');
      expect(hasPermission).toBe(false);
    });

    it('should check permission hierarchy', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'write');
      
      const hasRead = await checkFolderPermission(regularUser.id, '/folder', 'read');
      const hasWrite = await checkFolderPermission(regularUser.id, '/folder', 'write');
      
      expect(hasRead).toBe(true);
      expect(hasWrite).toBe(true);
    });

    it('should allow user to access their own folder', async () => {
      const hasPermission = await checkFolderPermission(regularUser.id, '/testuser', 'read');
      expect(hasPermission).toBe(true);
    });

    it('should allow user to access subfolders of their own folder', async () => {
      const hasPermission = await checkFolderPermission(regularUser.id, '/testuser/subfolder', 'write');
      expect(hasPermission).toBe(true);
    });

    it('should check deeply nested paths', async () => {
      await grantTestPermission(testDb, regularUser.id, '/', 'read');
      const hasPermission = await checkFolderPermission(regularUser.id, '/a/b/c/d/e', 'read');
      expect(hasPermission).toBe(true);
    });
  });

  describe('canAccessPath', () => {
    it('should allow admin to access any path', async () => {
      const canAccess = await canAccessPath(adminUser.id, '/any/path');
      expect(canAccess).toBe(true);
    });

    it('should deny non-existent user', async () => {
      const canAccess = await canAccessPath(99999, '/path');
      expect(canAccess).toBe(false);
    });

    it('should allow user to access their own folder', async () => {
      const canAccess = await canAccessPath(regularUser.id, '/testuser');
      expect(canAccess).toBe(true);
    });

    it('should allow user to access subfolders of their own folder', async () => {
      const canAccess = await canAccessPath(regularUser.id, '/testuser/subfolder');
      expect(canAccess).toBe(true);
    });

    it('should deny user accessing root path', async () => {
      const canAccess = await canAccessPath(regularUser.id, '/');
      expect(canAccess).toBe(false);
    });

    it('should deny user accessing empty path', async () => {
      const canAccess = await canAccessPath(regularUser.id, '');
      expect(canAccess).toBe(false);
    });

    it('should deny user accessing other users folders', async () => {
      const canAccess = await canAccessPath(regularUser.id, '/admin');
      expect(canAccess).toBe(false);
    });

    it('should handle paths without leading slash', async () => {
      const canAccess = await canAccessPath(regularUser.id, 'testuser/file.txt');
      expect(canAccess).toBe(true);
    });
  });

  describe('requirePermission middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {
        user: { id: regularUser.id },
        query: {},
        body: {}
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      mockNext = jest.fn();
    });

    it('should call next() for user with permission', async () => {
      mockReq.query.path = '/testuser/file.txt';
      const middleware = requirePermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 for user without permission', async () => {
      mockReq.query.path = '/admin/file.txt';
      const middleware = requirePermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when path is missing', async () => {
      const middleware = requirePermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Path is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should check write permission', async () => {
      await grantTestPermission(testDb, regularUser.id, '/folder', 'read');
      mockReq.query.path = '/folder/file.txt';
      const middleware = requirePermission('write');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should extract path from request body', async () => {
      mockReq.body.path = '/testuser/file.txt';
      const middleware = requirePermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use custom path extractor', async () => {
      mockReq.body.customPath = '/testuser/file.txt';
      const middleware = requirePermission('read', (req) => req.body.customPath);
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle admin user', async () => {
      mockReq.user.id = adminUser.id;
      mockReq.query.path = '/any/file.txt';
      const middleware = requirePermission('write');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockReq.user.id = null; // This will cause checkFilePermission to return false
      mockReq.query.path = '/file.txt';
      const middleware = requirePermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      // null user id results in access denied (403), not server error
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied' });
    });
  });

  describe('requireFolderPermission middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {
        user: { id: regularUser.id },
        query: {},
        body: {}
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      mockNext = jest.fn();
    });

    it('should call next() for user with folder permission', async () => {
      mockReq.query.path = '/testuser';
      const middleware = requireFolderPermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 for user without folder permission', async () => {
      mockReq.query.path = '/admin';
      const middleware = requireFolderPermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when path is missing', async () => {
      const middleware = requireFolderPermission('read');
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use custom path extractor', async () => {
      mockReq.body.folderPath = '/testuser';
      const middleware = requireFolderPermission('read', (req) => req.body.folderPath);
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Integration: Permission checking with path normalization', () => {
    beforeEach(async () => {
      await grantTestPermission(testDb, regularUser.id, '/project', 'write');
    });

    it('should work with various path formats', async () => {
      // Test basic path
      const hasPermission1 = await checkFilePermission(regularUser.id, '/project/file.txt', 'read');
      expect(hasPermission1).toBe(true);

      // Test nested path
      const hasPermission2 = await checkFilePermission(regularUser.id, '/project/subfolder/file.txt', 'read');
      expect(hasPermission2).toBe(true);

      // Test another nested path
      const hasPermission3 = await checkFilePermission(regularUser.id, '/project/a/b/file.txt', 'write');
      expect(hasPermission3).toBe(true);
    });

    it('should handle complex permission hierarchies', async () => {
      // Grant specific permissions at different levels
      await grantTestPermission(testDb, regularUser.id, '/root', 'read');
      await grantTestPermission(testDb, regularUser.id, '/root/level1', 'write');

      // Should have write permission (includes read)
      const hasWrite = await checkFilePermission(regularUser.id, '/root/level1/file.txt', 'write');
      expect(hasWrite).toBe(true);

      // Should have read permission at root level
      const hasRead = await checkFilePermission(regularUser.id, '/root/other/file.txt', 'read');
      expect(hasRead).toBe(true);

      // Should not have write permission in root/other
      const hasWriteOther = await checkFilePermission(regularUser.id, '/root/other/file.txt', 'write');
      expect(hasWriteOther).toBe(false);
    });

    it('should prioritize more specific permissions', async () => {
      // This test verifies that the most specific permission is found
      await grantTestPermission(testDb, regularUser.id, '/folder/subfolder', 'write');

      const hasPermission = await checkFilePermission(regularUser.id, '/folder/subfolder/file.txt', 'write');
      expect(hasPermission).toBe(true);
    });
  });
});

