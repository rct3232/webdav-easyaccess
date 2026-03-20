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
jest.mock('../../../../../services/folderPickerGateway', () => ({
  __esModule: true,
  default: {
    listFolderContents: jest.fn(),
    checkWritePermission: jest.fn(),
    getUserSharedFolderPermissions: jest.fn(),
  },
}));

import folderPickerGateway from '../../../../../services/folderPickerGateway';

const mockUser = { id: '1', username: 'user1', is_admin: false };
const mockAdminUser = { id: 'admin', username: 'admin', is_admin: true };

const renderFolderPickerHook = (overrides = {}) => {
  const initialProps = {
    open: false,
    currentPath: '/',
    user: mockUser,
    ...overrides,
  };

  const utils = renderHook((props) => useFolderPicker(props), {
    initialProps,
  });

  const openPicker = async (nextOverrides = {}) => {
    const nextProps = {
      ...initialProps,
      ...nextOverrides,
      open: true,
    };

    await act(async () => {
      utils.rerender(nextProps);
    });

    return nextProps;
  };

  return {
    ...utils,
    initialProps,
    openPicker,
  };
};

describe('useFolderPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderPickerGateway.listFolderContents.mockResolvedValue([
      { path: '/folder1', basename: 'folder1', type: 'directory' },
      { path: '/folder2', basename: 'folder2', type: 'directory' },
    ]);
    folderPickerGateway.checkWritePermission.mockResolvedValue({ hasWrite: true });
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
  });

  it('returns selectedPath, folders, loading, breadcrumbs, handlers', () => {
    const { result } = renderFolderPickerHook();

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
    const { result, openPicker } = renderFolderPickerHook();

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[0]).toMatchObject({ path: '/folder1', basename: 'folder1', type: 'directory' });
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ path: '/' });
  });

  it('loads shared folders when path is __shared__', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { folder_path: '/other/shared', permission: 'read', owner_id: '2' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({ currentPath: '/__shared__' });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(folderPickerGateway.getUserSharedFolderPermissions).toHaveBeenCalledWith({ user: mockUser });
    expect(result.current.folders).toEqual([
      expect.objectContaining({ path: '/other/shared', basename: 'shared', type: 'directory' }),
    ]);
  });

  it('handleFolderClick updates selectedPath and loads subfolders', async () => {
    const { result, openPicker } = renderFolderPickerHook();

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const folder = { path: '/folder1', basename: 'folder1', type: 'directory', hasReadPermission: true };
    folderPickerGateway.listFolderContents.mockResolvedValue([
      { path: '/folder1/sub', basename: 'sub', type: 'directory' },
    ]);

    await act(async () => {
      result.current.handleFolderClick(folder);
    });

    expect(result.current.selectedPath).toBe('/folder1');
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ path: '/folder1' });
  });

  it('handlePathClick updates selectedPath and loads path', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentPath: '/folder1' });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handlePathClick('/');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.selectedPath).toBe('/');
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ path: '/' });
  });

  it('returns home breadcrumbs without repeating the username segment', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentPath: '/user1/docs' });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.breadcrumbs).toEqual([
      { name: 'nav.home', path: '/user1' },
      { name: 'docs', path: '/user1/docs' },
    ]);
  });

  it('returns shared breadcrumbs starting at the first matching permission path', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { folder_path: '/shared/root', permission: 'write' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({
      currentPath: '/shared/root/child',
      action: 'move',
      sourceFilePath: '/user1/file.txt',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.breadcrumbs).toEqual([
      { name: 'nav.shared', path: '/__shared__' },
      { name: 'root', path: '/shared/root' },
      { name: 'child', path: '/shared/root/child' },
    ]);
  });

  it('marks invalid destinations for source parent, source path, descendant, and multi-source input', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      action: 'move',
      sourceFilePath: '/folder1/file.txt',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/folder1');
    });
    expect(result.current.isInvalidDestination()).toBe(true);

    act(() => {
      result.current.setSelectedPath('/folder1/file.txt');
    });
    expect(result.current.isInvalidDestination()).toBe(true);

    act(() => {
      result.current.setSelectedPath('/folder1/file.txt/subdir');
    });
    expect(result.current.isInvalidDestination()).toBe(true);

    const multiSource = renderFolderPickerHook({
      action: 'move',
      sourceFilePaths: ['/folder1/file-a.txt', '/folder2/file-b.txt'],
    });
    await multiSource.openPicker();

    act(() => {
      multiSource.result.current.setSelectedPath('/folder1');
    });
    expect(multiSource.result.current.isInvalidDestination()).toBe(true);
  });

  it('returns false for invalid-destination checks outside copy/move flows', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      sourceFilePath: '/folder1/file.txt',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/folder1');
    });

    expect(result.current.isInvalidDestination()).toBe(false);
  });

  it('admin user keeps hasWritePermission true for move flows', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      user: mockAdminUser,
      action: 'move',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasWritePermission).toBe(true);
  });

  it('getCurrentPathType returns home for user home paths', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentPath: '/user1' });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedPath('/user1');
    });

    expect(result.current.getCurrentPathType()).toBe('home');
  });

  it('getCurrentPathType returns shared for __shared__ paths', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentPath: '/__shared__' });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getCurrentPathType()).toBe('shared');
  });

  it('checkWritePermission updates write access for non-admin users', async () => {
    folderPickerGateway.checkWritePermission.mockResolvedValue({ hasWrite: false });

    const { result, openPicker } = renderFolderPickerHook({
      currentPath: '/user1',
      action: 'move',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.hasWritePermission).toBe(false);
    });
  });

  it('handleTogglePath switches between home and shared routes for home-origin moves', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      currentPath: '/user1',
      action: 'move',
      sourceFilePath: '/user1/doc.txt',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.selectedPath).toBe('/__shared__');
      expect(result.current.getCurrentPathType()).toBe('shared');
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'home');
    });

    await waitFor(() => {
      expect(result.current.selectedPath).toBe('/user1');
      expect(result.current.getCurrentPathType()).toBe('home');
    });
  });

  it('handleTogglePath(shared) lands on the best matching shared root for shared-origin moves', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { folder_path: '/shared', permission: 'read' },
      { folder_path: '/shared/root', permission: 'write' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({
      currentPath: '/shared/root/subdir',
      action: 'move',
      sourceFilePath: '/shared/root/subdir/file.txt',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.selectedPath).toBe('/shared/root/subdir');
      expect(result.current.getCurrentPathType()).toBe('shared');
    });
  });
});
