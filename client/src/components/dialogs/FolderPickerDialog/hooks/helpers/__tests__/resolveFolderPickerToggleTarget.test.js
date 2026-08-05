import { resolveFolderPickerToggleTarget } from '../resolveFolderPickerToggleTarget';

describe('resolveFolderPickerToggleTarget', () => {
  it('routes home-origin moves to the shared root', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'shared',
      action: 'move',
      sourceNodeId: 55,
      sharedFolderRoots: ['10', '20'],
      homeNodeId: 100,
    });

    expect(result).toEqual({
      nodeId: null,
      pathType: 'shared',
      presetHasWritePermission: true,
    });
  });

  it('routes shared-origin moves to the matching top-level shared root', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'shared',
      action: 'move',
      sourceNodeId: 20,
      sharedFolderRoots: ['10', '20'],
      homeNodeId: 100,
    });

    expect(result).toEqual({
      nodeId: 20,
      pathType: 'shared',
      presetHasWritePermission: undefined,
    });
  });

  it('routes the home toggle to the user home nodeId', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'home',
      action: 'move',
      sourceNodeId: 20,
      sharedFolderRoots: ['20'],
      homeNodeId: 100,
    });

    expect(result).toEqual({
      nodeId: 100,
      pathType: 'home',
      presetHasWritePermission: undefined,
    });
  });

  it('falls back to the home nodeId outside copy and move flows', () => {
    const result = resolveFolderPickerToggleTarget({
      nextPathType: 'home',
      sourceNodeId: 20,
      sharedFolderRoots: ['20'],
      homeNodeId: 100,
    });

    expect(result).toEqual({
      nodeId: 100,
      pathType: 'home',
      presetHasWritePermission: undefined,
    });
  });
});
