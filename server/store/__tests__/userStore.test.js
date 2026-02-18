const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const userStore = require('../userStore');
const { resetTestStore, teardownTestStore } = require('../../test-utils');

describe('userStore', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('creates and finds a user', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hashedpassword',
      isAdmin: false
    };

    const created = await userStore.createUser(userData);
    expect(created.username).toBe(userData.username);
    expect(created.email).toBe(userData.email);
    expect(created.status).toBe('pending');
    expect(created.is_admin).toBe(0);

    const foundByUsername = await userStore.findByUsername(userData.username);
    expect(foundByUsername.id).toBe(created.id);

    const foundById = await userStore.findById(created.id);
    expect(foundById.username).toBe(userData.username);

    const foundByEmail = await userStore.findByEmail(userData.email);
    expect(foundByEmail.id).toBe(created.id);
  });

  it('fails to create duplicate user or email', async () => {
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hashedpassword'
    };

    await userStore.createUser(userData);

    // Duplicate username
    await expect(userStore.createUser({
      ...userData,
      email: 'other@example.com'
    })).rejects.toThrow(SERVER_ERROR_CODES.admin.usernameTaken);

    // Duplicate email
    await expect(userStore.createUser({
      ...userData,
      username: 'otheruser'
    })).rejects.toThrow(SERVER_ERROR_CODES.auth.emailTaken);
  });

  it('updates user status, email, and password', async () => {
    const created = await userStore.createUser({
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'oldhash'
    });

    await userStore.updateStatus(created.id, 'approved');
    let user = await userStore.findById(created.id);
    expect(user.status).toBe('approved');

    await userStore.updateEmail(created.id, 'new@example.com');
    user = await userStore.findById(created.id);
    expect(user.email).toBe('new@example.com');
    expect(await userStore.findByEmail('test@example.com')).toBeUndefined();
    expect(await userStore.findByEmail('new@example.com')).toBeDefined();

    await userStore.updatePassword(created.id, 'newhash');
    user = await userStore.findById(created.id);
    expect(user.password).toBe('newhash');
    expect(user.token_version).toBe(1);
  });

  it('deletes a user', async () => {
    const created = await userStore.createUser({
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hashedpassword'
    });

    await userStore.deleteUser(created.id);

    expect(await userStore.findById(created.id)).toBeUndefined();
    expect(await userStore.findByUsername('testuser')).toBeUndefined();
    expect(await userStore.findByEmail('test@example.com')).toBeUndefined();
  });

  it('lists all users and filters by status', async () => {
    await userStore.createUser({ username: 'u1', email: 'u1@ex.com', passwordHash: 'h', isAdmin: true });
    await userStore.createUser({ username: 'u2', email: 'u2@ex.com', passwordHash: 'h' });

    const all = await userStore.findAll();
    expect(all).toHaveLength(2);

    const approved = await userStore.findByStatus('approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].username).toBe('u1');

    const pending = await userStore.findByStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].username).toBe('u2');
  });
});
