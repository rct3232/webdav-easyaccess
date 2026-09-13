/**
 * userUtils tests: getUserBaseFolder, filterOutUserOwnFolders
 */
import { getUserBaseFolder, filterOutUserOwnFolders } from '../userUtils';

describe('getUserBaseFolder', () => {
  it('returns /username for user with username', () => {
    expect(getUserBaseFolder({ username: 'alice' })).toBe('/alice');
  });

  it('returns empty path for null/undefined user', () => {
    expect(getUserBaseFolder(null)).toBe('/');
    expect(getUserBaseFolder(undefined)).toBe('/');
  });

  it('returns empty path for user without username', () => {
    expect(getUserBaseFolder({})).toBe('/');
  });
});

describe('filterOutUserOwnFolders', () => {
  const user = { id: 'u1', username: 'alice', rootNodeId: 10 };
  const permissions = [
    { nodeId: 10, permission: 'admin' },
    { nodeId: 20, permission: 'read' },
    { nodeId: 30, permission: 'write' },
  ];

  it('excludes user own folders', () => {
    const result = filterOutUserOwnFolders(permissions, user);
    expect(result).toEqual([
      { nodeId: 20, permission: 'read' },
      { nodeId: 30, permission: 'write' },
    ]);
  });

  it('returns empty array when no permissions', () => {
    expect(filterOutUserOwnFolders([], user)).toEqual([]);
  });

  it('acts as a root-only safety net: removes only the exact root node, not descendants', () => {
    const perms = [
      { nodeId: 10, permission: 'admin' },
      { nodeId: 100, permission: 'write' },
      { nodeId: 20, permission: 'read' },
    ];

    const result = filterOutUserOwnFolders(perms, user);

    expect(result).toEqual([
      { nodeId: 100, permission: 'write' },
      { nodeId: 20, permission: 'read' },
    ]);
  });
});
