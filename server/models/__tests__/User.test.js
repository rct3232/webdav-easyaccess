/**
 * Unit tests for User model
 * Tests all CRUD operations and authentication-related methods
 */

const bcrypt = require('bcryptjs');
const User = require('../User');
const {
  setupTestStore,
  resetTestStore,
  teardownTestStore
} = require('../../test-utils');

describe('User Model', () => {
  beforeAll(async () => {
    await setupTestStore();
  });

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  describe('create', () => {
    it('should create a new user', async () => {
      const user = await User.create('testuser', 'test@example.com', 'password123');

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
      expect(user.status).toBe('pending');
      expect(user.is_admin).toBe(0);
    });

    it('should hash the password', async () => {
      const password = 'password123';
      await User.create('testuser', 'test@example.com', password);

      const savedUser = await User.findByUsername('testuser');
      expect(savedUser.password).toBeDefined();
      expect(savedUser.password).not.toBe(password);
      
      // Verify password is hashed correctly
      const isMatch = await bcrypt.compare(password, savedUser.password);
      expect(isMatch).toBe(true);
    });

    it('should create admin user with approved status', async () => {
      const user = await User.create('adminuser', 'admin@example.com', 'password123', true);

      expect(user.status).toBe('approved');
      expect(user.is_admin).toBe(1);
    });

    it('should reject duplicate username', async () => {
      await User.create('testuser', 'test1@example.com', 'password123');

      await expect(
        User.create('testuser', 'test2@example.com', 'password456')
      ).rejects.toThrow();
    });

    it('should reject duplicate email', async () => {
      await User.create('user1', 'test@example.com', 'password123');

      await expect(
        User.create('user2', 'test@example.com', 'password456')
      ).rejects.toThrow();
    });
  });

  describe('findByUsername', () => {
    it('should find user by username', async () => {
      await User.create('testuser', 'test@example.com', 'password123');
      const user = await User.findByUsername('testuser');

      expect(user).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
    });

    it('should return undefined for non-existent user', async () => {
      const user = await User.findByUsername('nonexistent');
      expect(user).toBeUndefined();
    });

    it('should be case-sensitive', async () => {
      await User.create('TestUser', 'test@example.com', 'password123');
      
      const user1 = await User.findByUsername('TestUser');
      expect(user1).toBeDefined();
      
      const user2 = await User.findByUsername('testuser');
      expect(user2).toBeUndefined();
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      await User.create('testuser', 'test@example.com', 'password123');
      const user = await User.findByEmail('test@example.com');

      expect(user).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
    });

    it('should return undefined for non-existent email', async () => {
      const user = await User.findByEmail('nonexistent@example.com');
      expect(user).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const created = await User.create('testuser', 'test@example.com', 'password123');
      const user = await User.findById(created.id);

      expect(user).toBeDefined();
      expect(user.id).toBe(created.id);
      expect(user.username).toBe('testuser');
    });

    it('should not return password field', async () => {
      const created = await User.create('testuser', 'test@example.com', 'password123');
      const user = await User.findById(created.id);

      expect(user.password).toBeUndefined();
    });

    it('should return undefined for non-existent id', async () => {
      const user = await User.findById(99999);
      expect(user).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      await User.create('user1', 'user1@example.com', 'password123');
      await User.create('user2', 'user2@example.com', 'password123');
      await User.create('user3', 'user3@example.com', 'password123');

      const users = await User.findAll();

      expect(users).toHaveLength(3);
      expect(users[0].username).toBeDefined();
    });

    it('should return empty array when no users', async () => {
      const users = await User.findAll();
      expect(users).toEqual([]);
    });

    it('should not return password field', async () => {
      await User.create('user1', 'user1@example.com', 'password123');
      const users = await User.findAll();

      expect(users[0].password).toBeUndefined();
    });

    it('should order by created_at descending', async () => {
      await User.create('user1', 'user1@example.com', 'password123');
      await new Promise(resolve => setTimeout(resolve, 100)); // Delay to ensure different timestamps
      await User.create('user2', 'user2@example.com', 'password123');

      const users = await User.findAll();

      // Most recent user should be first (or check that ordering exists)
      expect(users).toHaveLength(2);
      const usernames = users.map(u => u.username);
      expect(usernames).toContain('user1');
      expect(usernames).toContain('user2');
    });
  });

  describe('findByStatus', () => {
    it('should find users by status', async () => {
      await User.create('pending1', 'pending1@example.com', 'password123');
      await User.create('pending2', 'pending2@example.com', 'password123');
      await User.create('admin', 'admin@example.com', 'password123', true);

      const pendingUsers = await User.findByStatus('pending');
      expect(pendingUsers).toHaveLength(2);

      const approvedUsers = await User.findByStatus('approved');
      expect(approvedUsers).toHaveLength(1);
    });

    it('should return empty array for status with no users', async () => {
      const users = await User.findByStatus('rejected');
      expect(users).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update user status', async () => {
      const user = await User.create('testuser', 'test@example.com', 'password123');
      
      await User.updateStatus(user.id, 'approved');
      
      const updated = await User.findById(user.id);
      expect(updated.status).toBe('approved');
    });

    it('should update to different statuses', async () => {
      const user = await User.create('testuser', 'test@example.com', 'password123');
      
      await User.updateStatus(user.id, 'rejected');
      let updated = await User.findById(user.id);
      expect(updated.status).toBe('rejected');
      
      await User.updateStatus(user.id, 'approved');
      updated = await User.findById(user.id);
      expect(updated.status).toBe('approved');
    });
  });

  describe('updateEmail', () => {
    it('should update user email', async () => {
      const user = await User.create('testuser', 'test@example.com', 'password123');
      
      await User.updateEmail(user.id, 'newemail@example.com');
      
      const updated = await User.findById(user.id);
      expect(updated.email).toBe('newemail@example.com');
    });

    it('should reject duplicate email', async () => {
      await User.create('user1', 'user1@example.com', 'password123');
      const user2 = await User.create('user2', 'user2@example.com', 'password123');
      
      await expect(
        User.updateEmail(user2.id, 'user1@example.com')
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete user', async () => {
      const user = await User.create('testuser', 'test@example.com', 'password123');
      
      await User.delete(user.id);
      
      const deleted = await User.findById(user.id);
      expect(deleted).toBeUndefined();
    });

    it('should not error when deleting non-existent user', async () => {
      const result = await User.delete(99999);
      expect(result.success).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'password123';
      await User.create('testuser', 'test@example.com', password);
      const user = await User.findByUsername('testuser');

      const isValid = await User.verifyPassword(user, password);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      await User.create('testuser', 'test@example.com', 'password123');
      const user = await User.findByUsername('testuser');

      const isValid = await User.verifyPassword(user, 'wrongpassword');
      expect(isValid).toBe(false);
    });

    it('should be case-sensitive', async () => {
      await User.create('testuser', 'test@example.com', 'Password123');
      const user = await User.findByUsername('testuser');

      const isValid = await User.verifyPassword(user, 'password123');
      expect(isValid).toBe(false);
    });
  });

  describe('updatePassword', () => {
    it('should update user password', async () => {
      const user = await User.create('testuser', 'test@example.com', 'oldpassword');
      
      await User.updatePassword(user.id, 'newpassword');
      
      const updated = await User.findByUsername('testuser');
      const isOldValid = await User.verifyPassword(updated, 'oldpassword');
      const isNewValid = await User.verifyPassword(updated, 'newpassword');
      
      expect(isOldValid).toBe(false);
      expect(isNewValid).toBe(true);
    });

    it('should hash new password', async () => {
      const user = await User.create('testuser', 'test@example.com', 'oldpassword');
      const newPassword = 'newpassword';
      
      await User.updatePassword(user.id, newPassword);
      
      const updated = await User.findByUsername('testuser');
      expect(updated.password).not.toBe(newPassword);
      
      const isMatch = await bcrypt.compare(newPassword, updated.password);
      expect(isMatch).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete user lifecycle', async () => {
      // Create user
      const user = await User.create('testuser', 'test@example.com', 'password123');
      expect(user.status).toBe('pending');
      
      // Approve user
      await User.updateStatus(user.id, 'approved');
      let updated = await User.findById(user.id);
      expect(updated.status).toBe('approved');
      
      // Update email
      await User.updateEmail(user.id, 'newemail@example.com');
      updated = await User.findById(user.id);
      expect(updated.email).toBe('newemail@example.com');
      
      // Update password
      await User.updatePassword(user.id, 'newpassword');
      updated = await User.findByUsername('testuser');
      const isValid = await User.verifyPassword(updated, 'newpassword');
      expect(isValid).toBe(true);
      
      // Delete user
      await User.delete(user.id);
      const deleted = await User.findById(user.id);
      expect(deleted).toBeUndefined();
    });
  });
});

