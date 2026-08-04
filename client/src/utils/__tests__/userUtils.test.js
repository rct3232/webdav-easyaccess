/**
 * userUtils tests: getUserBaseFolder, isUserOwnFolder, filterOutUserOwnFolders,
 * filterDisplayUsers, getUserDisplayName
 */
import {
  getUserBaseFolder,
  isUserOwnFolder,
  filterOutUserOwnFolders,
  filterDisplayUsers,
  getUserDisplayName,
} from '../userUtils';

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

describe('isUserOwnFolder', () => {
  const user = { id: 'u1', username: 'alice', rootNodeId: 10 };

  it('returns true when nodeId matches user rootNodeId', () => {
    expect(isUserOwnFolder(10, user)).toBe(true);
  });

  it('returns false for different nodeId', () => {
    expect(isUserOwnFolder(20, user)).toBe(false);
    expect(isUserOwnFolder(30, user)).toBe(false);
  });

  it('returns false for null/undefined inputs', () => {
    expect(isUserOwnFolder(null, user)).toBe(false);
    expect(isUserOwnFolder(undefined, user)).toBe(false);
    expect(isUserOwnFolder(10, null)).toBe(false);
    expect(isUserOwnFolder(10, undefined)).toBe(false);
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
});

describe('filterDisplayUsers', () => {
  const users = [
    ['u1', { permission: 'read' }],
    ['u2', { permission: 'write' }],
    ['u3', { permission: 'admin' }],
  ];
  const user = { id: 'u1' };
  const userInfoMap = new Map([['u2', { is_admin: false }], ['u3', { is_admin: true }]]);
  const allUsers = [{ id: 'u1' }, { id: 'u2', is_admin: false }, { id: 'u3', is_admin: true }];

  it('in admin mode returns only current user', () => {
    const result = filterDisplayUsers(users, {
      isAdminMode: true,
      currentUserId: 'u2',
      user,
      userInfoMap,
      allUsers,
    });
    expect(result).toEqual([['u2', { permission: 'write' }]]);
  });

  it('excludes self when not admin mode', () => {
    const result = filterDisplayUsers(users, {
      isAdminMode: false,
      user,
      userInfoMap,
      allUsers,
    });
    expect(result).toEqual([['u2', { permission: 'write' }]]);
  });

  it('excludes admin users when not admin mode', () => {
    const usersNoAdmin = [
      ['u1', {}],
      ['u2', {}],
    ];
    const result = filterDisplayUsers(usersNoAdmin, {
      isAdminMode: false,
      user: { id: 'u3' },
      userInfoMap: new Map([['u1', { is_admin: true }], ['u2', { is_admin: false }]]),
      allUsers: [{ id: 'u1', is_admin: true }, { id: 'u2', is_admin: false }],
    });
    expect(result).toEqual([['u2', {}]]);
  });

  it('uses allUsers.is_admin when userInfoMap lacks info', () => {
    const usersTwo = [
      ['u1', {}],
      ['u2', {}],
    ];
    const result = filterDisplayUsers(usersTwo, {
      isAdminMode: false,
      user: { id: 'u3' },
      userInfoMap: new Map(),
      allUsers: [{ id: 'u1', is_admin: true }, { id: 'u2', is_admin: false }],
    });
    expect(result).toEqual([['u2', {}]]);
  });

  it('handles empty options', () => {
    const result = filterDisplayUsers(users, {});
    expect(result.length).toBeLessThanOrEqual(users.length);
  });
});

describe('getUserDisplayName', () => {
  it('returns username when present', () => {
    expect(getUserDisplayName({ username: 'alice' })).toBe('alice');
  });

  it('falls back to email', () => {
    expect(getUserDisplayName({ email: 'alice@example.com' })).toBe('alice@example.com');
  });

  it('falls back to id', () => {
    expect(getUserDisplayName({ id: 'u1' })).toBe('u1');
  });

  it('prefers username over email', () => {
    expect(getUserDisplayName({ username: 'alice', email: 'a@x.com' })).toBe('alice');
  });

  it('returns empty string for null/undefined', () => {
    expect(getUserDisplayName(null)).toBe('');
    expect(getUserDisplayName(undefined)).toBe('');
  });
});
