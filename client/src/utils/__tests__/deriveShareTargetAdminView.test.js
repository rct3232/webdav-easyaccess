import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

import {
  buildShareTargetAccessList,
  filterShareTargetUsers,
  sortShareTargetAccessList,
} from '../deriveShareTargetAdminView';

describe('deriveShareTargetAdminView', () => {
  it('maps folder and file permission responses into access entries', () => {
    expect(buildShareTargetAccessList({
      permissions: [
        { id: 'u1', username: 'user1', email: 'u1@example.com', permission: PERMISSIONS.WRITE },
      ],
      isDirectory: true,
    })).toEqual([
      {
        id: 'u1',
        username: 'user1',
        email: 'u1@example.com',
        permission: PERMISSIONS.WRITE,
      },
    ]);

    expect(buildShareTargetAccessList({
      permissions: [
        {
          id: 'u2',
          username: 'user2',
          email: 'u2@example.com',
          permission: PERMISSIONS.READ,
          file_permission: PERMISSIONS.WRITE,
        },
      ],
      isDirectory: false,
    })).toEqual([
      {
        id: 'u2',
        username: 'user2',
        email: 'u2@example.com',
        pathPermission: PERMISSIONS.READ,
        filePermission: PERMISSIONS.WRITE,
        permission: PERMISSIONS.WRITE,
      },
    ]);
  });

  it('filters admin entries and matches users by username or email', () => {
    expect(buildShareTargetAccessList({
      permissions: [
        { id: 'admin', is_admin: true, permission: PERMISSIONS.ADMIN },
        { id: 'u1', username: 'user1', email: 'u1@example.com', permission: PERMISSIONS.READ },
      ],
      isDirectory: true,
    })).toEqual([
      {
        id: 'u1',
        username: 'user1',
        email: 'u1@example.com',
        permission: PERMISSIONS.READ,
      },
    ]);

    expect(filterShareTargetUsers({
      users: [
        { id: 'u1', username: 'Alice', email: 'alice@example.com' },
        { id: 'u2', username: 'Bob', email: 'team@example.com' },
      ],
      searchQuery: 'TEAM',
    })).toEqual([
      { id: 'u2', username: 'Bob', email: 'team@example.com' },
    ]);
  });

  it('returns a sorted copy of the access list', () => {
    const accessList = [
      { id: 'u1', permission: PERMISSIONS.READ },
      { id: 'u2', permission: PERMISSIONS.WRITE },
    ];

    const sorted = sortShareTargetAccessList(accessList);

    expect(sorted).toEqual(accessList);
    expect(sorted).not.toBe(accessList);
  });
});
