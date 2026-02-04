import { getUserBaseFolder, isUserOwnFolder, filterOutUserOwnFolders, filterDisplayUsers, getUserDisplayName } from '../userUtils';
import { normalizePath } from '../pathUtils';

describe('userUtils', () => {
  const mockUser = { id: 1, username: 'testuser' };

  describe('getUserBaseFolder', () => {
    it('returns root folder based on username', () => {
      expect(getUserBaseFolder(mockUser)).toBe('/testuser');
      expect(getUserBaseFolder(null)).toBe('/');
    });
  });

  describe('isUserOwnFolder', () => {
    it('returns true for exact base folder', () => {
      expect(isUserOwnFolder('/testuser', mockUser)).toBe(true);
    });

    it('returns true for subfolder of base folder', () => {
      expect(isUserOwnFolder('/testuser/sub', mockUser)).toBe(true);
    });

    it('returns false for other user folders', () => {
      expect(isUserOwnFolder('/otheruser', mockUser)).toBe(false);
      expect(isUserOwnFolder('/testuser_suffix', mockUser)).toBe(false);
    });
  });

  describe('filterOutUserOwnFolders', () => {
    it('removes user own folders from permission list', () => {
      const permissions = [
        { folder_path: '/testuser', permission: 'write' },
        { folder_path: '/shared', permission: 'read' },
      ];
      const filtered = filterOutUserOwnFolders(permissions, mockUser);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].folder_path).toBe('/shared');
    });
  });

  describe('filterDisplayUsers', () => {
    const users = [
      [1, { permission: 'read' }], // testuser
      [2, { permission: 'write' }], // otheruser
      [3, { permission: 'read' }], // adminuser
    ];
    const userInfoMap = new Map([
      [1, { username: 'testuser', is_admin: false }],
      [2, { username: 'otheruser', is_admin: false }],
      [3, { username: 'adminuser', is_admin: true }],
    ]);

    it('filters out current user and admins in regular mode', () => {
      const options = {
        user: mockUser,
        userInfoMap,
      };
      const filtered = filterDisplayUsers(users, options);
      expect(filtered).toHaveLength(1);
      expect(filtered[0][0]).toBe(2); // only otheruser
    });

    it('shows only target user in admin mode', () => {
      const options = {
        isAdminMode: true,
        currentUserId: 2,
      };
      const filtered = filterDisplayUsers(users, options);
      expect(filtered).toHaveLength(1);
      expect(filtered[0][0]).toBe(2);
    });
  });

  describe('getUserDisplayName', () => {
    it('returns username, then email, then id', () => {
      expect(getUserDisplayName({ username: 'user1' })).toBe('user1');
      expect(getUserDisplayName({ email: 'user@example.com' })).toBe('user@example.com');
      expect(getUserDisplayName({ id: 123 })).toBe(123);
      expect(getUserDisplayName(null)).toBe('');
    });
  });
});
