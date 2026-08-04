/**
 * buildPermissionDiff tests.
 * @see docs/spec/client/utils/buildPermissionDiff.md
 */
import { buildPermissionDiff } from '../buildPermissionDiff';

describe('buildPermissionDiff', () => {
  it('initial empty -> grants mirror current; no revokes', () => {
    const initial = new Map();
    const current = new Map([
      [1, new Map([['u1', 'read']])],
      [2, new Map([['u2', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual(
      expect.arrayContaining([
        { userId: 'u1', nodeId: 1, permission: 'read' },
        { userId: 'u2', nodeId: 2, permission: 'write' },
      ])
    );
    expect(permissionsToGrant).toHaveLength(2);
  });

  it('node empty -> revokes everything from initial; no grants', () => {
    const initial = new Map([
      [1, new Map([['u1', 'read'], ['u2', 'write']])],
      [2, new Map([['u3', 'read']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: new Map(),
    });

    expect(permissionsToGrant).toEqual([]);
    expect(permissionsToRevoke).toHaveLength(3);
    expect(permissionsToRevoke).toEqual(
      expect.arrayContaining([
        { userId: 'u1', nodeId: 1 },
        { userId: 'u2', nodeId: 1 },
        { userId: 'u3', nodeId: 2 },
      ])
    );
  });

  it('removed user assignment -> revoke that user only', () => {
    const initial = new Map([
      [1, new Map([['u1', 'read'], ['u2', 'write']])],
    ]);
    const current = new Map([
      [1, new Map([['u1', 'read']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: current,
    });

    expect(permissionsToRevoke).toEqual([{ userId: 'u2', nodeId: 1 }]);
    expect(permissionsToGrant).toEqual([{ userId: 'u1', nodeId: 1, permission: 'read' }]);
  });

  it('permission change -> grant new permission; no revoke', () => {
    const initial = new Map([
      [1, new Map([['u1', 'read']])],
    ]);
    const current = new Map([
      [1, new Map([['u1', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual([{ userId: 'u1', nodeId: 1, permission: 'write' }]);
  });

  it('extra user assignment -> grant; no revoke', () => {
    const initial = new Map([
      [1, new Map([['u1', 'read']])],
    ]);
    const current = new Map([
      [1, new Map([['u1', 'read'], ['u2', 'write']])],
    ]);

    const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: current,
    });

    expect(permissionsToRevoke).toEqual([]);
    expect(permissionsToGrant).toEqual(
      expect.arrayContaining([
        { userId: 'u1', nodeId: 1, permission: 'read' },
        { userId: 'u2', nodeId: 1, permission: 'write' },
      ])
    );
    expect(permissionsToGrant).toHaveLength(2);
  });

  it('nodeIds are canonical integers in output', () => {
    const initial = new Map([
      [10, new Map([['u1', 'read']])],
    ]);
    const current = new Map();

    const { permissionsToRevoke } = buildPermissionDiff({
      initialNodePermissions: initial,
      nodePermissions: current,
    });

    expect(permissionsToRevoke).toEqual([{ userId: 'u1', nodeId: 10 }]);
  });
});
