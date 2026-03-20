/**
 * buildPermissionDiff tests.
 * @see docs/spec/client/utils/buildPermissionDiff.md
 */
import { buildPermissionDiff } from '../buildPermissionDiff';

describe('buildPermissionDiff', () => {
  it('initial empty -> grants mirror current; no revokes', () => {
    const initial = new Map();
    const current = new Map([
      ['/a', new Map([['u1', 'read']])],
      ['/b', new Map([['u2', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual(
      expect.arrayContaining([
        { userId: 'u1', folderPath: '/a', permission: 'read' },
        { userId: 'u2', folderPath: '/b', permission: 'write' },
      ])
    );
    expect(permissionsToGrant).toHaveLength(2);
  });

  it('folder empty -> revokes everything from initial; no grants', () => {
    const initial = new Map([
      ['/a', new Map([['u1', 'read'], ['u2', 'write']])],
      ['/b', new Map([['u3', 'read']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: new Map(),
    });

    expect(permissionsToGrant).toEqual([]);
    expect(permissionsToRevoke).toHaveLength(3);
    expect(permissionsToRevoke).toEqual(
      expect.arrayContaining([
        { userId: 'u1', folderPath: '/a' },
        { userId: 'u2', folderPath: '/a' },
        { userId: 'u3', folderPath: '/b' },
      ])
    );
  });

  it('removed user assignment -> revoke that user only', () => {
    const initial = new Map([
      ['/a', new Map([['u1', 'read'], ['u2', 'write']])],
    ]);
    const current = new Map([
      ['/a', new Map([['u1', 'read']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: current,
    });

    expect(permissionsToRevoke).toEqual([{ userId: 'u2', folderPath: '/a' }]);
    expect(permissionsToGrant).toEqual([{ userId: 'u1', folderPath: '/a', permission: 'read' }]);
  });

  it('permission change -> grant new permission; no revoke', () => {
    const initial = new Map([
      ['/a', new Map([['u1', 'read']])],
    ]);
    const current = new Map([
      ['/a', new Map([['u1', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual([{ userId: 'u1', folderPath: '/a', permission: 'write' }]);
  });

  it('extra user assignment -> grant; no revoke', () => {
    const initial = new Map([
      ['/a', new Map([['u1', 'read']])],
    ]);
    const current = new Map([
      ['/a', new Map([['u1', 'read'], ['u2', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual(
      expect.arrayContaining([
        { userId: 'u1', folderPath: '/a', permission: 'read' },
        { userId: 'u2', folderPath: '/a', permission: 'write' },
      ])
    );
    expect(permissionsToGrant).toHaveLength(2);
  });

  it('normalizes folder paths in output', () => {
    const initial = new Map([
      ['/a//', new Map([['u1', 'read']])],
    ]);
    const current = new Map();

    const { permissionsToRevoke } = buildPermissionDiff({
      initialFolderPermissions: initial,
      folderPermissions: current,
    });

    expect(permissionsToRevoke).toEqual([{ userId: 'u1', folderPath: '/a' }]);
  });
});

