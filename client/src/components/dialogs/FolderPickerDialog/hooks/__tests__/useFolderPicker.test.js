/**
 * useFolderPicker tests.
 * @see docs/spec/client/hooks/useFolderPicker.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFolderPicker } from '../useFolderPicker';

import folderPickerGateway from '../../../../../services/folderPickerGateway';

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

const mockUser = { id: '1', username: 'user1', is_admin: false, rootNodeId: 100 };
const mockAdminUser = { id: 'admin', username: 'admin', is_admin: true };

const renderFolderPickerHook = (overrides = {}) => {
  const initialProps = {
    open: false,
    currentNodeId: null,
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
      { nodeId: 101, basename: 'folder1', type: 'directory' },
      { nodeId: 102, basename: 'folder2', type: 'directory' },
    ]);
    folderPickerGateway.checkWritePermission.mockResolvedValue({ hasWrite: true });
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
  });

  it('returns selectedNodeId, folders, loading, breadcrumbs, handlers', () => {
    const { result } = renderFolderPickerHook();

    expect(typeof result.current.selectedNodeId).toBe('number');
    expect(Array.isArray(result.current.folders)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(Array.isArray(result.current.breadcrumbs)).toBe(true);
    expect(typeof result.current.handleFolderClick).toBe('function');
    expect(typeof result.current.handleNodeClick).toBe('function');
    expect(typeof result.current.handleTogglePath).toBe('function');
    expect(typeof result.current.isInvalidDestination).toBe('function');
    expect(typeof result.current.loadFolders).toBe('function');
    expect(typeof result.current.checkWritePermission).toBe('function');
  });

  it('loads folders for nodeId when open', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentNodeId: 100 });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[0]).toMatchObject({ nodeId: 101, basename: 'folder1', type: 'directory' });
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ nodeId: 100 });
  });

  it('lists the server root when opening without a derivable home nodeId', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      user: { id: '2', username: 'user2', is_admin: false },
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ nodeId: null });
  });

  it('loads shared folders when toggled to the shared root', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'write' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({
      action: 'move',
      sourceNodeId: 50,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.getCurrentPathType()).toBe('shared');
    });

    expect(result.current.selectedNodeId).toBeNull();
    expect(folderPickerGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    expect(result.current.folders).toEqual([
      expect.objectContaining({ nodeId: 10, type: 'directory' }),
    ]);
  });

  it('handleFolderClick updates selectedNodeId and loads subfolders by nodeId', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentNodeId: 100 });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const folder = { nodeId: 101, basename: 'folder1', type: 'directory', hasReadPermission: true };
    folderPickerGateway.listFolderContents.mockResolvedValue([
      { nodeId: 103, basename: 'sub', type: 'directory' },
    ]);

    await act(async () => {
      result.current.handleFolderClick(folder);
    });

    expect(result.current.selectedNodeId).toBe(101);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ nodeId: 101 });
    expect(result.current.breadcrumbs).toEqual([
      { name: 'nav.home', nodeId: 100 },
      { name: 'folder1', nodeId: 101 },
    ]);
  });

  it('handleNodeClick truncates the navigation stack and loads the requested nodeId', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentNodeId: 100 });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    folderPickerGateway.listFolderContents.mockResolvedValue([
      { nodeId: 103, basename: 'sub', type: 'directory' },
    ]);
    await act(async () => {
      result.current.handleFolderClick({ nodeId: 101, basename: 'folder1', type: 'directory', hasReadPermission: true });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleNodeClick(100);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.selectedNodeId).toBe(100);
    expect(result.current.breadcrumbs).toEqual([{ name: 'nav.home', nodeId: 100 }]);
    expect(folderPickerGateway.listFolderContents).toHaveBeenLastCalledWith({ nodeId: 100 });
  });

  it('returns home breadcrumbs without a repeated username segment', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentNodeId: 100 });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.breadcrumbs).toEqual([{ name: 'nav.home', nodeId: 100 }]);
  });

  it('marks source nodeId destinations as invalid for copy/move', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      action: 'move',
      sourceNodeId: 101,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedNodeId(101);
    });
    expect(result.current.isInvalidDestination()).toBe(true);

    act(() => {
      result.current.setSelectedNodeId(102);
    });
    expect(result.current.isInvalidDestination()).toBe(false);
  });

  it('marks multi-source copy/move invalid when any source equals the destination', async () => {
    const multiSource = renderFolderPickerHook({
      action: 'move',
      sourceNodeIds: [101, 202],
    });
    await multiSource.openPicker();

    await waitFor(() => {
      expect(multiSource.result.current.loading).toBe(false);
    });

    act(() => {
      multiSource.result.current.setSelectedNodeId(202);
    });
    expect(multiSource.result.current.isInvalidDestination()).toBe(true);

    act(() => {
      multiSource.result.current.setSelectedNodeId(303);
    });
    expect(multiSource.result.current.isInvalidDestination()).toBe(false);
  });

  it('returns false for invalid-destination checks outside copy/move flows', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      sourceNodeId: 101,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSelectedNodeId(101);
    });

    expect(result.current.isInvalidDestination()).toBe(false);
  });

  it('admin user keeps hasWritePermission true and lists the root for move flows', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      user: mockAdminUser,
      action: 'move',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasWritePermission).toBe(true);
    expect(result.current.selectedNodeId).toBeNull();
    expect(folderPickerGateway.listFolderContents).toHaveBeenCalledWith({ nodeId: null });
  });

  it('getCurrentPathType returns home for the home root and shared after toggling', async () => {
    const { result, openPicker } = renderFolderPickerHook({ currentNodeId: 100 });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getCurrentPathType()).toBe('home');

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    expect(result.current.getCurrentPathType()).toBe('shared');
  });

  it('checkWritePermission({nodeId}) updates write access for non-admin users', async () => {
    folderPickerGateway.checkWritePermission.mockResolvedValue({ hasWrite: false });

    const { result, openPicker } = renderFolderPickerHook({
      currentNodeId: 100,
      action: 'move',
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.hasWritePermission).toBe(false);
    });
    expect(folderPickerGateway.checkWritePermission).toHaveBeenCalledWith({ nodeId: 100 });
  });

  it('handleTogglePath switches between home and shared routes for home-origin moves', async () => {
    const { result, openPicker } = renderFolderPickerHook({
      currentNodeId: 100,
      action: 'move',
      sourceNodeId: 55,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.selectedNodeId).toBeNull();
      expect(result.current.getCurrentPathType()).toBe('shared');
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'home');
    });

    await waitFor(() => {
      expect(result.current.selectedNodeId).toBe(100);
      expect(result.current.getCurrentPathType()).toBe('home');
    });
  });

  it('treats read-granted shared folders as non-writable and write/admin grants as writable', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, name: 'ReadOnly', permission: 'read' },
      { nodeId: 20, name: 'Writable', permission: 'write' },
      { nodeId: 30, name: 'AdminShared', permission: 'admin' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({
      action: 'move',
      sourceNodeId: 50,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.getCurrentPathType()).toBe('shared');
    });

    const folders = result.current.folders;
    const byNodeId = new Map(folders.map((folder) => [folder.nodeId, folder]));

    expect(folders).toHaveLength(3);
    expect(byNodeId.get(10)).toMatchObject({
      nodeId: 10,
      name: 'ReadOnly',
      hasReadPermission: true,
      hasWritePermission: false,
    });
    expect(byNodeId.get(20)).toMatchObject({
      nodeId: 20,
      name: 'Writable',
      hasReadPermission: true,
      hasWritePermission: true,
    });
    expect(byNodeId.get(30)).toMatchObject({
      nodeId: 30,
      name: 'AdminShared',
      hasReadPermission: true,
      hasWritePermission: true,
    });
    expect(folders.every((folder) => !String(folder.name).includes('Shared ('))).toBe(true);

    await act(async () => {
      result.current.handleFolderClick(byNodeId.get(10));
    });
    expect(result.current.hasWritePermission).toBe(false);

    await act(async () => {
      result.current.handleFolderClick(byNodeId.get(20));
    });
    expect(result.current.hasWritePermission).toBe(true);

    await act(async () => {
      result.current.handleFolderClick(byNodeId.get(30));
    });
    expect(result.current.hasWritePermission).toBe(true);
  });

  it('handleTogglePath(shared) lands on a top-level shared root for shared-origin sources', async () => {
    folderPickerGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
      { nodeId: 20, permission: 'write' },
    ]);

    const { result, openPicker } = renderFolderPickerHook({
      currentNodeId: 100,
      action: 'move',
      sourceNodeId: 20,
    });

    await openPicker();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.handleTogglePath({}, 'shared');
    });

    await waitFor(() => {
      expect(result.current.selectedNodeId).toBe(20);
      expect(result.current.getCurrentPathType()).toBe('shared');
    });
  });
});
