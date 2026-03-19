import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { deriveShareFolderAccessView } from '../deriveShareFolderAccessView';

describe('deriveShareFolderAccessView', () => {
  it('filters to the target user in admin mode and marks admin-owned root state', () => {
    const result = deriveShareFolderAccessView({
      folderPath: '/alice',
      folderPermissions: new Map([
        [
          '/alice',
          new Map([
            ['target', PERMISSIONS.ADMIN],
            ['other', PERMISSIONS.READ],
          ]),
        ],
      ]),
      isAdminMode: true,
      userId: 'target',
      username: 'alice',
      userInfoMap: new Map(),
      users: [],
      getUserName: (id) => (id === 'target' ? 'alice' : 'other'),
      hasPermissionChanged: () => true,
    });

    expect(result.displayUsers).toEqual([
      { userId: 'target', permission: PERMISSIONS.ADMIN, userName: 'alice' },
    ]);
    expect(result.userCount).toBe(1);
    expect(result.currentIsUserBaseFolder).toBe(true);
    expect(result.isFolderWithAdminPermission).toBe(true);
    expect(result.isChanged).toBe(true);
  });

  it('filters out current user and admin users in non-admin mode', () => {
    const result = deriveShareFolderAccessView({
      folderPath: '/docs',
      folderPermissions: new Map([
        [
          '/docs',
          new Map([
            ['me', PERMISSIONS.READ],
            ['admin1', PERMISSIONS.READ],
            ['u1', PERMISSIONS.WRITE],
          ]),
        ],
      ]),
      isAdminMode: false,
      user: { id: 'me' },
      userInfoMap: new Map([['admin1', { is_admin: true }]]),
      users: [{ id: 'u1', is_admin: false }],
      getUserName: (id) => (id === 'u1' ? 'user1' : ''),
    });

    expect(result.displayUsers).toEqual([
      { userId: 'u1', permission: PERMISSIONS.WRITE, userName: 'user1' },
    ]);
    expect(result.userCount).toBe(1);
    expect(result.isFolderWithAdminPermission).toBe(false);
  });
});
