/**
 * useFolderPicker tests.
 * @see docs/spec/client/hooks/useFolderPicker.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFolderPicker } from '../useFolderPicker';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});
jest.mock('../../../../../services/permissionService', () => {
  const { createPermissionServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createPermissionServiceMock();
});
jest.mock('../../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

jest.mock('../../../../../utils/userUtils', () => {
  const actual = jest.requireActual('../../../../../utils/userUtils');
  return {
    ...actual,
    filterOutUserOwnFolders: jest.fn((arr) => (Array.isArray(arr) ? arr.filter(() => true) : [])),
  };
});

import * as permissionService from '../../../../../services/permissionService';
import * as fileService from '../../../../../services/fileService';

const mockUser = { id: '1', username: 'user1', is_admin: false };
const mockAdminUser = { id: 'admin', username: 'admin', is_admin: true };

describe('useFolderPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileService.listFiles.mockResolvedValue([
      { path: '/folder1', basename: 'folder1', type: 'directory' },
      { path: '/folder2', basename: 'folder2', type: 'directory' },
    ]);
    fileService.checkPermission.mockResolvedValue({ hasWrite: true });
    permissionService.getUserPermissions.mockResolvedValue([]);
  });

  it('returns selectedPath, folders, loading, breadcrumbs, handlers', () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/', user: mockUser })
    );

    expect(typeof result.current.selectedPath).toBe('string');
    expect(Array.isArray(result.current.folders)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(Array.isArray(result.current.breadcrumbs)).toBe(true);
    expect(typeof result.current.handleFolderClick).toBe('function');
    expect(typeof result.current.handlePathClick).toBe('function');
    expect(typeof result.current.handleTogglePath).toBe('function');
    expect(typeof result.current.isInvalidDestination).toBe('function');
    expect(typeof result.current.loadFolders).toBe('function');
    expect(typeof result.current.checkWritePermission).toBe('function');
  });

  it('loads folders for path when open', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[0]).toMatchObject({ path: '/folder1', basename: 'folder1', type: 'directory' });
    expect(fileService.listFiles).toHaveBeenCalledWith('/');
  });

  it('loads shared folders when path is __shared__', async () => {
    permissionService.getUserPermissions.mockResolvedValue([
      { folder_path: '/other/shared', permission: 'read', owner_id: '2' },
    ]);

    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/__shared__', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(permissionService.getUserPermissions).toHaveBeenCalledWith(mockUser.id);
    expect(result.current.folders).toBeDefined();
    expect(Array.isArray(result.current.folders)).toBe(true);
  });

  it('handleFolderClick updates selectedPath and loads subfolders', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const folder = { path: '/folder1', basename: 'folder1', type: 'directory', hasReadPermission: true };
    fileService.listFiles.mockResolvedValue([
      { path: '/folder1/sub', basename: 'sub', type: 'directory' },
    ]);

    act(() => {
      result.current.handleFolderClick(folder);
    });

    expect(result.current.selectedPath).toBe('/folder1');
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fileService.listFiles).toHaveBeenCalledWith('/folder1');
  });

  it('handlePathClick updates selectedPath and loads path', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/folder1', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handlePathClick('/');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.selectedPath).toBe('/');
    expect(fileService.listFiles).toHaveBeenCalledWith('/');
  });

  it('isInvalidDestination returns true when selectedPath is source or parent of source', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({
        open: true,
        currentPath: '/',
        user: mockUser,
        action: 'move',
        sourceFilePath: '/folder1/file.txt',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/folder1');
    });

    expect(result.current.isInvalidDestination()).toBe(true);
  });

  it('isInvalidDestination returns false when action is not copy or move', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({
        open: true,
        currentPath: '/',
        user: mockUser,
        sourceFilePath: '/folder1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/folder1');
    });

    expect(result.current.isInvalidDestination()).toBe(false);
  });

  it('admin user has hasWritePermission true', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/', user: mockAdminUser, action: 'move' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasWritePermission).toBe(true);
  });

  it('getCurrentPathType returns home when selectedPath is user base folder', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/user1', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/user1');
    });

    expect(result.current.getCurrentPathType()).toBe('home');
  });

  it('getCurrentPathType returns shared for __shared__ path', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({ open: true, currentPath: '/__shared__', user: mockUser })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getCurrentPathType()).toBe('shared');
  });

  it('checkWritePermission sets hasWritePermission false when user lacks write', async () => {
    fileService.checkPermission.mockResolvedValue({ hasWrite: false });

    const { result } = renderHook(() =>
      useFolderPicker({
        open: true,
        currentPath: '/user1',
        user: mockUser,
        action: 'move',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.hasWritePermission).toBe(false);
    });
  });

  it('handleTogglePath(home) switches to home path and getCurrentPathType is home', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({
        open: true,
        currentPath: '/user1',
        user: mockUser,
        action: 'move',
        sourceFilePath: '/user1/doc.txt',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });
    await waitFor(() => {
      expect(result.current.selectedPath).toBe('/__shared__');
    });

    act(() => {
      result.current.handleTogglePath({}, 'home');
    });

    expect(result.current.selectedPath).toBe('/user1');
    expect(result.current.getCurrentPathType()).toBe('home');
  });

  it('handleTogglePath(shared) switches to shared path and getCurrentPathType is shared', async () => {
    const { result } = renderHook(() =>
      useFolderPicker({
        open: true,
        currentPath: '/user1',
        user: mockUser,
        action: 'move',
        sourceFilePath: '/user1/doc.txt',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.selectedPath).toBe('/__shared__');
      expect(result.current.getCurrentPathType()).toBe('shared');
    });
  });
});
