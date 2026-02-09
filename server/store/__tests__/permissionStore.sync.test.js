const Permission = require('../../models/Permission');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { resetTestStore, teardownTestStore, createTestUser } = require('../../test-utils');

function permsToMap(permsArray) {
  const out = new Map();
  for (const p of permsArray) {
    out.set(normalizePath(p.folder_path), p.permission);
  }
  return out;
}

describe('permissionStore sync helpers', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('rewrites permissions for a prefix across all users (merge stronger on conflict)', async () => {
    const u1 = await createTestUser({ username: 'u1', email: 'u1@example.com' });
    const u2 = await createTestUser({ username: 'u2', email: 'u2@example.com' });

    await Permission.grant(u1.id, '/a', 'write');
    await Permission.grant(u1.id, '/a/c', 'read');
    await Permission.grant(u1.id, '/a/c/d', 'read');

    await Permission.grant(u2.id, '/a/c', 'write');
    await Permission.grant(u2.id, '/1/a/c', 'read'); // will be upgraded to write after rewrite

    const result = await Permission.rewritePermissionsForAllUsers([{ fromPrefix: '/a/c', toPrefix: '/1/a/c' }]);
    expect(result.success).toBe(true);
    expect(result.rewrittenUsers).toBeGreaterThanOrEqual(1);

    const u1Perms = permsToMap(await Permission.getUserPermissions(u1.id));
    expect(u1Perms.get('/a/c')).toBeUndefined();
    expect(u1Perms.get('/1/a/c')).toBe('read');
    expect(u1Perms.get('/1/a/c/d')).toBe('read');

    const u2Perms = permsToMap(await Permission.getUserPermissions(u2.id));
    expect(u2Perms.get('/a/c')).toBeUndefined();
    expect(u2Perms.get('/1/a/c')).toBe('write');
  });

  it('rewrite can exclude subtrees (keeps ACL on skipped prefixes)', async () => {
    const u1 = await createTestUser({ username: 'u1', email: 'u1@example.com' });

    await Permission.grant(u1.id, '/a', 'write');
    await Permission.grant(u1.id, '/a/b', 'read'); // should stay under /a/b
    await Permission.grant(u1.id, '/a/c', 'write'); // should move under /1/a/c

    await Permission.rewritePermissionsForAllUsers([{ fromPrefix: '/a', toPrefix: '/1/a' }], { excludePrefixes: ['/a/b'] });

    const u1Perms = permsToMap(await Permission.getUserPermissions(u1.id));
    expect(u1Perms.get('/a')).toBeUndefined();
    expect(u1Perms.get('/1/a')).toBe('write');

    expect(u1Perms.get('/a/b')).toBe('read');
    expect(u1Perms.get('/1/a/b')).toBeUndefined();

    expect(u1Perms.get('/a/c')).toBeUndefined();
    expect(u1Perms.get('/1/a/c')).toBe('write');
  });

  it('partial move can duplicate exact root ACL while rewriting descendants', async () => {
    const u1 = await createTestUser({ username: 'u1', email: 'u1@example.com' });

    // Root write + nested read (nested will be excluded)
    await Permission.grant(u1.id, '/a', 'write');
    await Permission.grant(u1.id, '/a/b', 'read');
    await Permission.grant(u1.id, '/a/c', 'write');

    await Permission.rewritePermissionsForAllUsers(
      [{ fromPrefix: '/a', toPrefix: '/1/a' }],
      { excludePrefixes: ['/a/b'], duplicateExactMatches: true }
    );

    const u1Perms = permsToMap(await Permission.getUserPermissions(u1.id));

    // Exact root is kept and also granted at destination
    expect(u1Perms.get('/a')).toBe('write');
    expect(u1Perms.get('/1/a')).toBe('write');

    // Excluded subtree stays
    expect(u1Perms.get('/a/b')).toBe('read');
    expect(u1Perms.get('/1/a/b')).toBeUndefined();

    // Other descendants rewrite
    expect(u1Perms.get('/a/c')).toBeUndefined();
    expect(u1Perms.get('/1/a/c')).toBe('write');
  });

  it('revokes permissions under prefixes across all users', async () => {
    const u1 = await createTestUser({ username: 'u1', email: 'u1@example.com' });
    const u2 = await createTestUser({ username: 'u2', email: 'u2@example.com' });

    await Permission.grant(u1.id, '/a', 'read');
    await Permission.grant(u1.id, '/a/c', 'write');
    await Permission.grant(u2.id, '/a/b', 'read');
    await Permission.grant(u2.id, '/x', 'read');

    const result = await Permission.revokePermissionsPrefixForAllUsers(['/a']);
    expect(result.success).toBe(true);
    expect(result.revokedUsers).toBeGreaterThanOrEqual(1);

    const u1Perms = permsToMap(await Permission.getUserPermissions(u1.id));
    expect(u1Perms.get('/a')).toBeUndefined();
    expect(u1Perms.get('/a/c')).toBeUndefined();

    const u2Perms = permsToMap(await Permission.getUserPermissions(u2.id));
    expect(u2Perms.get('/a/b')).toBeUndefined();
    expect(u2Perms.get('/x')).toBe('read');
  });
});

