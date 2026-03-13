/**
 * usePermissionManager tests.
 * Map-based permission state for ShareDialog.
 * @see docs/spec/client/hooks/usePermissionManager.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { usePermissionManager } from '../usePermissionManager';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

const defaultProps = {
  mode: 'share',
  userId: '1',
  username: 'me',
  onMessage: jest.fn(),
  onSave: jest.fn(),
  onApprove: jest.fn(),
  onClose: jest.fn(),
};

describe('usePermissionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns initial state with empty folderPermissions', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    expect(result.current.folderPermissions.size).toBe(0);
    expect(result.current.initialFolderPermissions.size).toBe(0);
    expect(result.current.userInfoMap.size).toBe(0);
    expect(result.current.saving).toBe(false);
    expect(result.current.loadingPermissions).toBe(false);
  });

  it('handleAddUserPermission adds permission for folder and user', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission('/folder', 'user2', PERMISSIONS.WRITE);
    });

    const perms = result.current.folderPermissions.get('/folder');
    expect(perms).toBeDefined();
    expect(perms.get('user2')).toBe(PERMISSIONS.WRITE);
  });

  it('handleAddUserPermission applies to subfolders', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission('/folder', 'user2', PERMISSIONS.READ, ['/folder/sub1', '/folder/sub2']);
    });

    expect(result.current.folderPermissions.get('/folder').get('user2')).toBe(PERMISSIONS.READ);
    expect(result.current.folderPermissions.get('/folder/sub1').get('user2')).toBe(PERMISSIONS.READ);
    expect(result.current.folderPermissions.get('/folder/sub2').get('user2')).toBe(PERMISSIONS.READ);
  });

  it('handleRemoveUserPermission removes user from folder', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission('/folder', 'user2', PERMISSIONS.WRITE);
    });
    expect(result.current.folderPermissions.get('/folder').has('user2')).toBe(true);

    act(() => {
      result.current.handleRemoveUserPermission('/folder', 'user2');
    });

    expect(result.current.folderPermissions.get('/folder')).toBeUndefined();
  });

  it('handleRemoveUserPermission removes from subfolders', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission('/folder', 'user2', PERMISSIONS.READ, ['/folder/sub1']);
    });
    act(() => {
      result.current.handleRemoveUserPermission('/folder', 'user2', ['/folder/sub1']);
    });

    expect(result.current.folderPermissions.get('/folder')).toBeUndefined();
    expect(result.current.folderPermissions.get('/folder/sub1')).toBeUndefined();
  });

  it('handleToggleUserPermission toggles read <-> write', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission('/folder', 'user2', PERMISSIONS.READ);
    });
    expect(result.current.folderPermissions.get('/folder').get('user2')).toBe(PERMISSIONS.READ);

    act(() => {
      result.current.handleToggleUserPermission('/folder', 'user2');
    });
    expect(result.current.folderPermissions.get('/folder').get('user2')).toBe(PERMISSIONS.WRITE);

    act(() => {
      result.current.handleToggleUserPermission('/folder', 'user2');
    });
    expect(result.current.folderPermissions.get('/folder').get('user2')).toBe(PERMISSIONS.READ);
  });

  it('hasPermissionChanged returns false when no changes', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.READ]])]]));
      result.current.setInitialFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged('/folder')).toBe(false);
  });

  it('hasPermissionChanged returns true when permission differs', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.WRITE]])]]));
      result.current.setInitialFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged('/folder')).toBe(true);
  });

  it('hasPermissionChanged returns true when user removed', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map());
      result.current.setInitialFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged('/folder')).toBe(true);
  });

  it('hasPermissionChanged returns true when user added', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([['/folder', new Map([['user2', PERMISSIONS.READ]])]]));
      result.current.setInitialFolderPermissions(new Map());
    });

    expect(result.current.hasPermissionChanged('/folder')).toBe(true);
  });
});
