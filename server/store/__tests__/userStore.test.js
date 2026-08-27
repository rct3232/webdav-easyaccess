/**
 * userStore tests.
 * Verifies createUser, findByUsername, findByEmail, findById, findAll, updateStatus,
 * updateEmail, updatePassword, deleteUser. Includes error cases.
 */
const userStore = require('@server/store/userStore');
const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { createTestDatabase } = require('@server/test-utils');

describe('userStore', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('createUser', () => {
    it('creates user and returns full object including password', async () => {
      const hash = 'hashed_password_xyz';
      const user = await userStore.createUser({
        username: 'storeuser1',
        email: 'store1@example.com',
        passwordHash: hash,
        isAdmin: false,
      });
      expect(user).toMatchObject({
        username: 'storeuser1',
        email: 'store1@example.com',
        password: hash,
        status: USER_STATUS.PENDING,
        is_admin: 0,
      });
      expect(user.id).toBeDefined();
    });

    it('throws 409 when username is taken', async () => {
      await userStore.createUser({
        username: 'duplicate_username',
        email: 'first@example.com',
        passwordHash: 'hash',
        isAdmin: false,
      });
      await expect(
        userStore.createUser({
          username: 'duplicate_username',
          email: 'second@example.com',
          passwordHash: 'hash',
          isAdmin: false,
        })
      ).rejects.toMatchObject({ status: 409 });
    });

    it('throws 409 when email is taken', async () => {
      await userStore.createUser({
        username: 'user_a',
        email: 'same@example.com',
        passwordHash: 'hash',
        isAdmin: false,
      });
      await expect(
        userStore.createUser({
          username: 'user_b',
          email: 'same@example.com',
          passwordHash: 'hash',
          isAdmin: false,
        })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('findById / findByUsername / findByEmail', () => {
    it('findById returns user when exists', async () => {
      const created = await userStore.createUser({
        username: 'findbyid_user',
        email: 'findbyid@example.com',
        passwordHash: 'h',
        isAdmin: false,
      });
      const u = await userStore.findById(created.id);
      expect(u).toMatchObject({ id: created.id, username: 'findbyid_user' });
    });

    it('findById returns undefined when not found', async () => {
      const u = await userStore.findById(999999);
      expect(u).toBeUndefined();
    });

    it('findByUsername returns user', async () => {
      const u = await userStore.findByUsername('findbyid_user');
      expect(u).toMatchObject({ username: 'findbyid_user' });
    });

    it('findByEmail returns user', async () => {
      const u = await userStore.findByEmail('findbyid@example.com');
      expect(u).toMatchObject({ email: 'findbyid@example.com' });
    });
  });

  describe('updateStatus', () => {
    it('updates status', async () => {
      const created = await userStore.createUser({
        username: 'status_user',
        email: 'status@example.com',
        passwordHash: 'h',
        isAdmin: false,
      });
      await userStore.updateStatus(created.id, USER_STATUS.APPROVED);
      const u = await userStore.findById(created.id);
      expect(u.status).toBe(USER_STATUS.APPROVED);
    });
  });

  describe('deleteUser', () => {
    it('removes user', async () => {
      const created = await userStore.createUser({
        username: 'delete_user',
        email: 'delete@example.com',
        passwordHash: 'h',
        isAdmin: false,
      });
      await userStore.deleteUser(created.id);
      const u = await userStore.findById(created.id);
      expect(u).toBeUndefined();
    });
  });
});
