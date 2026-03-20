import { deriveFolderPickerSharedState } from '../deriveFolderPickerSharedState';

describe('deriveFolderPickerSharedState', () => {
  it('normalizes paths and exposes only top-level shared folders', () => {
    const result = deriveFolderPickerSharedState({
      permissions: [
        { folder_path: '/shared/root/', permission: 'write' },
        { folder_path: '/shared/root/nested', permission: 'read' },
        { folder_path: '/other/path', permission: 'read' },
      ],
    });

    expect(Array.from(result.sharedPermissionPaths)).toEqual([
      '/shared/root',
      '/shared/root/nested',
      '/other/path',
    ]);
    expect(result.sharedFolderRoots).toEqual(['/shared/root', '/other/path']);
    expect(result.sharedFolders).toEqual([
      expect.objectContaining({
        path: '/shared/root',
        basename: 'root',
        hasReadPermission: true,
        hasWritePermission: true,
      }),
      expect.objectContaining({
        path: '/other/path',
        basename: 'path',
        hasReadPermission: true,
        hasWritePermission: false,
      }),
    ]);
  });

  it('returns empty shared state for empty input', () => {
    const result = deriveFolderPickerSharedState();

    expect(Array.from(result.sharedPermissionPaths)).toEqual([]);
    expect(result.sharedFolderRoots).toEqual([]);
    expect(result.sharedFolders).toEqual([]);
  });
});
