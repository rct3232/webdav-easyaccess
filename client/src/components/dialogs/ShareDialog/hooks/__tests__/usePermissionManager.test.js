/**
 * usePermissionManager tests.
 * Map-based permission state for ShareDialog (nodeId-keyed).
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
      result.current.handleAddUserPermission(10, 'user2', PERMISSIONS.WRITE);
    });

    const perms = result.current.folderPermissions.get(10);
    expect(perms).toBeDefined();
    expect(perms.get('user2')).toBe(PERMISSIONS.WRITE);
  });

  it('handleAddUserPermission applies to subfolders', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission(10, 'user2', PERMISSIONS.READ, [11, 12]);
    });

    expect(result.current.folderPermissions.get(10).get('user2')).toBe(PERMISSIONS.READ);
    expect(result.current.folderPermissions.get(11).get('user2')).toBe(PERMISSIONS.READ);
    expect(result.current.folderPermissions.get(12).get('user2')).toBe(PERMISSIONS.READ);
  });

  it('handleRemoveUserPermission removes user from folder', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission(10, 'user2', PERMISSIONS.WRITE);
    });
    expect(result.current.folderPermissions.get(10).has('user2')).toBe(true);

    act(() => {
      result.current.handleRemoveUserPermission(10, 'user2');
    });

    expect(result.current.folderPermissions.get(10)).toBeUndefined();
  });

  it('handleRemoveUserPermission removes from subfolders', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission(10, 'user2', PERMISSIONS.READ, [11]);
    });
    act(() => {
      result.current.handleRemoveUserPermission(10, 'user2', [11]);
    });

    expect(result.current.folderPermissions.get(10)).toBeUndefined();
    expect(result.current.folderPermissions.get(11)).toBeUndefined();
  });

  it('handleToggleUserPermission toggles read <-> write', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.handleAddUserPermission(10, 'user2', PERMISSIONS.READ);
    });
    expect(result.current.folderPermissions.get(10).get('user2')).toBe(PERMISSIONS.READ);

    act(() => {
      result.current.handleToggleUserPermission(10, 'user2');
    });
    expect(result.current.folderPermissions.get(10).get('user2')).toBe(PERMISSIONS.WRITE);

    act(() => {
      result.current.handleToggleUserPermission(10, 'user2');
    });
    expect(result.current.folderPermissions.get(10).get('user2')).toBe(PERMISSIONS.READ);
  });

  it('hasPermissionChanged returns false when no changes', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.READ]])]]));
      result.current.setInitialFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged(10)).toBe(false);
  });

  it('hasPermissionChanged returns true when permission differs', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.WRITE]])]]));
      result.current.setInitialFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged(10)).toBe(true);
  });

  it('hasPermissionChanged returns true when user removed', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map());
      result.current.setInitialFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.READ]])]]));
    });

    expect(result.current.hasPermissionChanged(10)).toBe(true);
  });

  it('hasPermissionChanged returns true when user added', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));

    act(() => {
      result.current.setFolderPermissions(new Map([[10, new Map([['user2', PERMISSIONS.READ]])]]));
      result.current.setInitialFolderPermissions(new Map());
    });

    expect(result.current.hasPermissionChanged(10)).toBe(true);
  });
});
