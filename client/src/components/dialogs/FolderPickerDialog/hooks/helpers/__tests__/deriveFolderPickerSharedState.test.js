import { deriveFolderPickerSharedState } from '../deriveFolderPickerSharedState';

describe('deriveFolderPickerSharedState', () => {
  it('builds nodeId-keyed shared state and exposes all permissions as roots', () => {
    const result = deriveFolderPickerSharedState({
      permissions: [
        { nodeId: 10, permission: 'write' },
        { nodeId: 20, permission: 'read' },
        { nodeId: 30, permission: 'read' },
      ],
    });

    expect(Array.from(result.sharedPermissionNodeIds)).toEqual(['10', '20', '30']);
    expect(result.sharedFolderRoots).toEqual(['10', '20', '30']);
    expect(result.sharedFolders).toEqual([
      expect.objectContaining({
        nodeId: 10,
        hasReadPermission: true,
        hasWritePermission: true,
      }),
      expect.objectContaining({
        nodeId: 20,
        hasReadPermission: true,
        hasWritePermission: false,
      }),
      expect.objectContaining({
        nodeId: 30,
        hasReadPermission: true,
        hasWritePermission: false,
      }),
    ]);
  });

  it('returns empty shared state for empty input', () => {
    const result = deriveFolderPickerSharedState();

    expect(Array.from(result.sharedPermissionNodeIds)).toEqual([]);
    expect(result.sharedFolderRoots).toEqual([]);
    expect(result.sharedFolders).toEqual([]);
  });
});
