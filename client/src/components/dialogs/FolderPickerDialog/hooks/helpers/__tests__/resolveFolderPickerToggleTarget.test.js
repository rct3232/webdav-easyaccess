import { resolveFolderPickerToggleTarget } from '../resolveFolderPickerToggleTarget';

describe('resolveFolderPickerToggleTarget', () => {
  const user = { id: '1', username: 'user1', is_admin: false };

  it('routes home-origin moves to the shared root virtual path', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'shared',
      action: 'move',
      user,
      sourceFilePath: '/user1/docs/file.txt',
      sharedFolderRoots: ['/shared/root'],
    });

    expect(result).toEqual({
      path: '/__shared__',
      pathType: 'shared',
      presetHasWritePermission: true,
    });
  });

  it('routes shared-origin moves to the best matching shared parent path', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'shared',
      action: 'move',
      user,
      sourceFilePath: '/shared/root/nested/file.txt',
      sharedFolderRoots: ['/shared', '/shared/root'],
    });

    expect(result).toEqual({
      path: '/shared/root/nested',
      pathType: 'shared',
      presetHasWritePermission: undefined,
    });
  });

  it('falls back to the home path outside copy and move flows', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'home',
      user,
      sourceFilePath: '/shared/root/file.txt',
      sharedFolderRoots: ['/shared/root'],
    });

    expect(result).toEqual({
      path: '/user1',
      pathType: 'home',
      presetHasWritePermission: undefined,
    });
  });
});
