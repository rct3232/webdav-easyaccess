'use strict';

/**
 * UserRepository L2 conformance (docs/spec/server/store/repository-contract.md).
 * Runs against the ACTIVE backend via createTestDatabase(): sqlite in the
 * default CI leg, real PostgreSQL under the WEA_TEST_PG_* adapter leg.
 */

const { createTestDatabase } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createUserRepository = require('@server/store/repositories/UserRepository');
const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');

describe('UserRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  const uniqueName = (prefix) => `${prefix}-${Date.now()}-${++seq}`;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createUserRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('create/find round-trips a user (domain-shaped row)', async () => {
    const username = uniqueName('conf-u');
    const created = await repo.createUser({
      username,
      email: `${username}@conf.test`,
      passwordHash: 'hash-1',
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.username).toBe(username);
    expect(created.email).toBe(`${username}@conf.test`);
    expect(created.status).toBe(USER_STATUS.PENDING);
    expect(created.is_admin).toBe(0);
    expect(typeof created.created_at).toBe('string');

    const byId = await repo.findById(created.id);
    expect(byId.username).toBe(username);

    const byName = await repo.findByUsername(username);
    expect(byName.id).toBe(created.id);

    const byEmail = await repo.findByEmail(`${username}@conf.test`);
    expect(byEmail.id).toBe(created.id);
  });

  it('normalises email case for hashing/lookup', async () => {
    const username = uniqueName('conf-mail');
    const created = await repo.createUser({
      username,
      email: `  ${username}@CONF.test `,
      passwordHash: 'h',
    });
    expect(created.email).toBe(`${username}@conf.test`);
    await expect(repo.findByEmail(`${username}@conf.test`.toUpperCase())).resolves.toBeDefined();
  });

  it('createUser rejects missing fields with 400', async () => {
    await expect(
      repo.createUser({ username: 'x', email: '', passwordHash: 'h' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('createUser raises 409 usernameTaken on duplicate username', async () => {
    const username = uniqueName('conf-dup');
    await repo.createUser({ username, email: `${username}-a@conf.test`, passwordHash: 'h' });
    await expect(
      repo.createUser({ username, email: `${username}-b@conf.test`, passwordHash: 'h' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('createUser raises 409 emailTaken on duplicate email (different username)', async () => {
    const username = uniqueName('conf-eml');
    await repo.createUser({ username, email: `${username}@conf.test`, passwordHash: 'h' });
    await expect(
      repo.createUser({
        username: `${username}-other`,
        email: `${username}@conf.test`,
        passwordHash: 'h',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('updateStatus changes the user status', async () => {
    const username = uniqueName('conf-st');
    const created = await repo.createUser({
      username,
      email: `${username}@conf.test`,
      passwordHash: 'h',
    });
    await repo.updateStatus(created.id, USER_STATUS.APPROVED);
    const after = await repo.findById(created.id);
    expect(after.status).toBe(USER_STATUS.APPROVED);
  });

  it('updateEmail rejects duplicate email of another user with 409', async () => {
    const a = uniqueName('conf-ue-a');
    const b = uniqueName('conf-ue-b');
    const userA = await repo.createUser({
      username: a,
      email: `${a}@conf.test`,
      passwordHash: 'h',
    });
    await repo.createUser({ username: b, email: `${b}@conf.test`, passwordHash: 'h' });

    await expect(repo.updateEmail(userA.id, `${b}@conf.test`)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('updateEmail raises 404 for a missing user', async () => {
    await expect(repo.updateEmail(99999999, 'someone@conf.test')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('updatePassword bumps token_version', async () => {
    const username = uniqueName('conf-pw');
    const created = await repo.createUser({
      username,
      email: `${username}@conf.test`,
      passwordHash: 'h1',
    });
    await repo.updatePassword(created.id, 'h2');
    const after = await repo.findById(created.id);
    expect(after.password).toBe('h2');
    expect(after.token_version).toBe(1);
  });

  it('deleteUser removes the row', async () => {
    const username = uniqueName('conf-del');
    const created = await repo.createUser({
      username,
      email: `${username}@conf.test`,
      passwordHash: 'h',
    });
    await repo.deleteUser(created.id);
    await expect(repo.findById(created.id)).resolves.toBeUndefined();
  });

  it('findAll/findByStatus return domain rows ordered by created_at desc', async () => {
    const a = uniqueName('conf-list-a');
    const b = uniqueName('conf-list-b');
    const first = await repo.createUser({
      username: a,
      email: `${a}@conf.test`,
      passwordHash: 'h',
    });
    const second = await repo.createUser({
      username: b,
      email: `${b}@conf.test`,
      passwordHash: 'h',
    });

    const all = await repo.findAll();
    const allIds = all.map((u) => u.id);
    expect(allIds.indexOf(second.id)).toBeLessThan(allIds.indexOf(first.id));

    const pending = await repo.findByStatus(USER_STATUS.PENDING);
    expect(pending.some((u) => u.id === second.id)).toBe(true);
  });
});
