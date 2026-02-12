const {
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  hasDirectFolderPermission,
} = require('../permissionPolicy');

const { resetTestStore, teardownTestStore, createTestUser, grantTestPermission } = require('../../test-utils');

describe('permissionPolicy', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('allows owner-folder writes without explicit permission', async () => {
    const alice = await createTestUser({ username: 'alice', email: 'alice@example.com' });

    expect(await canWriteFolder(alice, '/alice')).toBe(true);
    expect(await canWriteFolder(alice, '/alice/sub')).toBe(true);
    expect(await canWriteFileByParent(alice, '/alice/sub/file.txt')).toBe(true);
  });

  it('does not treat prefix-matching usernames as owner paths', async () => {
    const al = await createTestUser({ username: 'al', email: 'al@example.com' });

    expect(await canWriteFolder(al, '/alx')).toBe(false);
    expect(await canWriteFolder(al, '/alx/sub')).toBe(false);
    expect(await canReadFolder(al.id, '/alx')).toBe(false);
    expect(await canReadFile(al.id, '/alx/sub/file.txt')).toBe(false);
  });

  it('read checks are direct-only (no inheritance)', async () => {
    const bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
    await grantTestPermission(bob.id, '/shared', 'read');

    expect(await canReadFolder(bob.id, '/shared', 'read')).toBe(true);
    expect(await canReadFile(bob.id, '/shared/file.txt', 'read')).toBe(true);
    expect(await canReadFolder(bob.id, '/shared/sub', 'read')).toBe(false);
    expect(await canReadFile(bob.id, '/shared/sub/file.txt', 'read')).toBe(false);
  });

  it('write checks on shared folders are direct-only (no ancestor fallback)', async () => {
    const bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
    await grantTestPermission(bob.id, '/shared', 'write');

    expect(await canWriteFolder(bob, '/shared')).toBe(true);
    expect(await canWriteFolder(bob, '/shared/sub')).toBe(false);
  });

  it('file write checks require direct write on the parent folder', async () => {
    const bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
    await grantTestPermission(bob.id, '/shared', 'write');

    expect(await canWriteFileByParent(bob, '/shared/file.txt')).toBe(true);
    expect(await canWriteFileByParent(bob, '/shared/sub/file.txt')).toBe(false);
  });

  it('hasDirectFolderPermission supports both slash and no-slash keys', async () => {
    const bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
    await grantTestPermission(bob.id, '/folder/', 'write');

    expect(await hasDirectFolderPermission(bob.id, '/folder', 'read')).toBe(true);
    expect(await hasDirectFolderPermission(bob.id, '/folder', 'write')).toBe(true);
    expect(await hasDirectFolderPermission(bob.id, '/folder/', 'write')).toBe(true);
  });
});

