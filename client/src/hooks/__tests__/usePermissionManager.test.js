import { renderHook, act } from '@testing-library/react';
import { usePermissionManager } from '../usePermissionManager';
import { normalizePath } from '../../utils/pathUtils';

describe('usePermissionManager', () => {
  const defaultProps = {
    mode: 'user',
    userId: 1,
    username: 'testuser',
    onMessage: jest.fn(),
    onSave: jest.fn(),
    onApprove: jest.fn(),
    onClose: jest.fn(),
  };

  it('initializes with empty states', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    expect(result.current.folderPermissions).toBeInstanceOf(Map);
    expect(result.current.folderPermissions.size).toBe(0);
    expect(result.current.saving).toBe(false);
    expect(result.current.loadingPermissions).toBe(false);
  });

  it('adds user permission', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    
    act(() => {
      result.current.handleAddUserPermission('/test', 2, 'read');
    });

    expect(result.current.folderPermissions.has('/test')).toBe(true);
    expect(result.current.folderPermissions.get('/test').get(2)).toBe('read');
  });

  it('adds permission to subfolders', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    
    act(() => {
      result.current.handleAddUserPermission('/test', 2, 'write', ['/test/sub1', '/test/sub2']);
    });

    expect(result.current.folderPermissions.get('/test').get(2)).toBe('write');
    expect(result.current.folderPermissions.get('/test/sub1').get(2)).toBe('write');
    expect(result.current.folderPermissions.get('/test/sub2').get(2)).toBe('write');
  });

  it('removes user permission', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    
    act(() => {
      result.current.handleAddUserPermission('/test', 2, 'read', ['/test/sub']);
    });

    act(() => {
      result.current.handleRemoveUserPermission('/test', 2, ['/test/sub']);
    });

    expect(result.current.folderPermissions.has('/test')).toBe(false);
    expect(result.current.folderPermissions.has('/test/sub')).toBe(false);
  });

  it('toggles user permission', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    
    act(() => {
      result.current.handleAddUserPermission('/test', 2, 'read', ['/test/sub']);
    });

    act(() => {
      result.current.handleToggleUserPermission('/test', 2, ['/test/sub']);
    });

    expect(result.current.folderPermissions.get('/test').get(2)).toBe('write');
    expect(result.current.folderPermissions.get('/test/sub').get(2)).toBe('write');
  });

  it('detects permission changes', () => {
    const { result } = renderHook(() => usePermissionManager(defaultProps));
    
    const initialMap = new Map([['/test', new Map([[2, 'read']]) ]]);
    
    act(() => {
      result.current.setInitialFolderPermissions(new Map(initialMap));
      result.current.setFolderPermissions(new Map(initialMap));
    });

    expect(result.current.hasPermissionChanged('/test')).toBe(false);

    act(() => {
      result.current.handleToggleUserPermission('/test', 2);
    });

    expect(result.current.hasPermissionChanged('/test')).toBe(true);
  });
});
