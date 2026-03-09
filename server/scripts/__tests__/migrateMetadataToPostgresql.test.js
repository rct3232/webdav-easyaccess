const {
  parseArgs,
  canonicalizePath,
  normalizePermission,
  normalizeRequestPermission,
  normalizeUserStatus,
  normalizeRequestStatus,
  normalizeTargetType,
  buildExpectedCounts,
  buildPermissionValueCounts,
} = require('../migrateMetadataToPostgresql');

describe('migrateMetadataToPostgresql script helpers', () => {
  it('parses cli args for apply mode and options', () => {
    const options = parseArgs([
      '--source-backend=fs',
      '--apply',
      '--report-file=./report.json',
      '--fs-dir=./tmp-meta',
    ]);

    expect(options).toEqual({
      sourceBackend: 'fs',
      mode: 'apply',
      reportFile: './report.json',
      fsDir: './tmp-meta',
      help: false,
    });
  });

  it('canonicalizes non-root paths by removing trailing slash', () => {
    expect(canonicalizePath('/a/b/')).toBe('/a/b');
    expect(canonicalizePath('/')).toBe('/');
  });

  it('normalizes permissions and request/status values', () => {
    expect(normalizePermission('admin')).toBe('admin');
    expect(normalizePermission('read')).toBe('read');
    expect(normalizePermission('invalid')).toBeNull();
    expect(normalizeRequestPermission('admin')).toBeNull();
    expect(normalizeRequestPermission('write')).toBe('write');

    expect(normalizeUserStatus('APPROVED')).toBe('approved');
    expect(normalizeUserStatus('unknown')).toBe('pending');

    expect(normalizeRequestStatus('rejected')).toBe('rejected');
    expect(normalizeRequestStatus('bad')).toBeNull();
  });

  it('resolves target type from explicit value or file presence', () => {
    expect(normalizeTargetType('folder', true)).toBe('folder');
    expect(normalizeTargetType(null, true)).toBe('file');
    expect(normalizeTargetType(null, false)).toBe('folder');
  });

  it('builds expected counts from snapshot object', () => {
    const counts = buildExpectedCounts({
      users: [1, 2],
      settings: [1],
      permissionsUserPaths: [1],
      permissionsUserFiles: [1, 2, 3],
      permissionsShares: [],
      shareLinks: [1],
      recentFiles: [1, 2],
      permissionRequests: [1],
    });

    expect(counts).toEqual({
      users: 2,
      settings: 1,
      permissions_user_paths: 1,
      permissions_user_files: 3,
      permissions_shares: 0,
      share_links: 1,
      recent_files: 2,
      permission_requests: 1,
    });
  });

  it('builds permission value counts including admin entries', () => {
    const counts = buildPermissionValueCounts({
      permissionsUserPaths: [{ permission: 'admin' }, { permission: 'write' }],
      permissionsUserFiles: [{ permission: 'read' }, { permission: 'admin' }],
      permissionsShares: [{ permission: 'admin' }],
      permissionRequests: [{ requested_permission: 'write' }, { requested_permission: 'read' }],
    });

    expect(counts).toEqual({
      permissions_user_paths: { read: 0, write: 1, admin: 1 },
      permissions_user_files: { read: 1, write: 0, admin: 1 },
      permissions_shares: { read: 0, write: 0, admin: 1 },
      permission_requests_requested_permission: { read: 1, write: 1, admin: 0 },
    });
  });
});
