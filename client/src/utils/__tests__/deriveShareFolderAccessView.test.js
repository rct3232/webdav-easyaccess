import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { deriveShareFolderAccessView } from '../deriveShareFolderAccessView';

describe('deriveShareFolderAccessView', () => {
  it('filters to the target user in admin mode and marks admin-owned root state', () => {
    const result = deriveShareFolderAccessView({
      nodeId: 101,
      folderPermissions: new Map([
        [
          101,
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
      baseFolderNodeId: 101,
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
      nodeId: 202,
      folderPermissions: new Map([
        [
          202,
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
    expect(result.availableUsers).toEqual([]);
    expect(result.userCount).toBe(1);
    expect(result.isFolderWithAdminPermission).toBe(false);
  });

  it('derives addable users and review requester state for select-user menus', () => {
    const result = deriveShareFolderAccessView({
      nodeId: 303,
      folderPermissions: new Map([
        [303, new Map([['u1', PERMISSIONS.READ]])],
      ]),
      isAdminMode: false,
      user: { id: 'me' },
      userInfoMap: new Map(),
      users: [
        { id: 'u1', username: 'user1', is_admin: false },
        { id: 'u2', username: 'user2', is_admin: false },
        { id: 'admin', username: 'admin', is_admin: true },
      ],
      getUserName: (id) => ({ u1: 'user1', u2: 'user2', requester: 'requester' }[id] || ''),
      isReviewMode: true,
      permissionRequest: {
        requester_id: 'requester',
        requester_username: '',
      },
    });

    expect(result.availableUsers).toEqual([
      { id: 'u2', username: 'user2', is_admin: false },
    ]);
    expect(result.reviewRequesterOption).toEqual({
      userId: 'requester',
      userName: 'requester',
      alreadyAdded: false,
    });
  });
});
