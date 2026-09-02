/**
 * User model tests.
 * Verifies create, findByUsername, findByEmail, findById, findAll, findByStatus,
 * updateStatus, updateEmail, delete, verifyPassword, updatePassword.
 */
const User = require('../User');
const {
  createTestDatabase,
  createTestUser,
  getFullTestUser,
  USER_STATUS,
} = require('../../test-utils');

describe('User model', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('create', () => {
    it('creates a user and returns id, username, email, status, is_admin (no password)', async () => {
      const result = await User.create('alice', 'alice@example.com', 'pass123', false);
      expect(result).toMatchObject({
        username: 'alice',
        email: 'alice@example.com',
        status: USER_STATUS.PENDING,
        is_admin: 0,
      });
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('number');
      expect(result).not.toHaveProperty('password');
    });

    it('creates admin user with approved status', async () => {
      const result = await User.create('admin1', 'admin1@example.com', 'adminpass', true);
      expect(result).toMatchObject({
        username: 'admin1',
        email: 'admin1@example.com',
        status: USER_STATUS.APPROVED,
        is_admin: 1,
      });
    });
  });

  describe('findByUsername', () => {
    it('returns user when username exists', async () => {
      await createTestUser({ username: 'bob', email: 'bob@example.com' });
      const user = await User.findByUsername('bob');
      expect(user).toMatchObject({ username: 'bob', email: 'bob@example.com' });
    });

    it('returns undefined when username does not exist', async () => {
      const user = await User.findByUsername('nonexistent-user-xyz');
      expect(user).toBeUndefined();
    });
  });

  describe('findByEmail', () => {
    it('returns user when email exists', async () => {
      await createTestUser({ username: 'carol', email: 'carol@example.com' });
      const user = await User.findByEmail('carol@example.com');
      expect(user).toMatchObject({ username: 'carol', email: 'carol@example.com' });
    });

    it('returns undefined when email does not exist', async () => {
      const user = await User.findByEmail('nobody@example.com');
      expect(user).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns user without password when id exists', async () => {
      const created = await createTestUser({ username: 'dave', email: 'dave@example.com' });
      const user = await User.findById(created.id);
      expect(user).toMatchObject({ id: created.id, username: 'dave', email: 'dave@example.com' });
      expect(user).not.toHaveProperty('password');
    });

    it('returns undefined when id does not exist', async () => {
      const user = await User.findById(999999);
      expect(user).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('returns all users without password field', async () => {
      await createTestUser({ username: 'eve', email: 'eve@example.com' });
      const users = await User.findAll();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      users.forEach((u) => {
        expect(u).not.toHaveProperty('password');
        expect(u).toHaveProperty('id');
        expect(u).toHaveProperty('username');
      });
    });
  });

  describe('findByStatus', () => {
    it('returns users with given status', async () => {
      const created = await createTestUser({
        username: 'frank',
        email: 'frank@example.com',
        status: USER_STATUS.APPROVED,
      });
      const users = await User.findByStatus(USER_STATUS.APPROVED);
      const found = users.find((u) => u.id === created.id);
      expect(found).toBeDefined();
      expect(found.status).toBe(USER_STATUS.APPROVED);
    });
  });

  describe('updateStatus', () => {
    it('updates user status', async () => {
      const created = await createTestUser({ username: 'grace', email: 'grace@example.com' });
      await User.updateStatus(created.id, USER_STATUS.APPROVED);
      const user = await User.findById(created.id);
      expect(user.status).toBe(USER_STATUS.APPROVED);
    });
  });

  describe('updateEmail', () => {
    it('updates user email', async () => {
      const created = await createTestUser({ username: 'henry', email: 'henry@example.com' });
      await User.updateEmail(created.id, 'henry.new@example.com');
      const user = await User.findById(created.id);
      expect(user.email).toBe('henry.new@example.com');
    });
  });

  describe('delete', () => {
    it('removes user so findById returns undefined', async () => {
      const created = await createTestUser({ username: 'ian', email: 'ian@example.com' });
      await User.delete(created.id);
      const user = await User.findById(created.id);
      expect(user).toBeUndefined();
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      const created = await createTestUser({
        username: 'jane',
        email: 'jane@example.com',
        password: 'secret123',
      });
      const full = await getFullTestUser(created.id);
      expect(full).toBeDefined();
      const ok = await User.verifyPassword(full, 'secret123');
      expect(ok).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const created = await createTestUser({
        username: 'kate',
        email: 'kate@example.com',
        password: 'secret123',
      });
      const full = await getFullTestUser(created.id);
      const ok = await User.verifyPassword(full, 'wrong');
      expect(ok).toBe(false);
    });
  });

  describe('updatePassword', () => {
    it('updates password so verifyPassword succeeds with new password', async () => {
      const created = await createTestUser({
        username: 'leo',
        email: 'leo@example.com',
        password: 'old',
      });
      await User.updatePassword(created.id, 'newpass');
      const full = await getFullTestUser(created.id);
      const okOld = await User.verifyPassword(full, 'old');
      const okNew = await User.verifyPassword(full, 'newpass');
      expect(okOld).toBe(false);
      expect(okNew).toBe(true);
    });
  });
});
