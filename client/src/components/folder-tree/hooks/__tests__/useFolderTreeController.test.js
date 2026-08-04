/**
 * useFolderTreeController tests.
 * @see docs/spec/client/hooks/useFolderTreeController.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import useFolderTreeController from '../useFolderTreeController';

jest.mock('../../../../services/recentFilesRepository', () => ({
  getRecentFiles: jest.fn(),
}));

jest.mock('../../../../services/recentFilesNotifier', () => ({
  onRecentFilesChange: jest.fn(),
}));

jest.mock('../../../../services/folderTreeGateway', () => ({
  __esModule: true,
  default: {
    getUserSharedFolderPermissions: jest.fn(),
  },
}));

import { getRecentFiles } from '../../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../../services/recentFilesNotifier';
import folderTreeGateway from '../../../../services/folderTreeGateway';

const renderControllerHook = (initialProps) =>
  renderHook((props) => useFolderTreeController(props), { initialProps });

describe('useFolderTreeController', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Provide safe defaults so derived logic can always assume array values.
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockImplementation(() => jest.fn());
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
  });

  it('loads recent files for a non-null user and clears them when user becomes falsy', async () => {
    const unsubscribe = jest.fn();
    onRecentFilesChange.mockImplementation(() => unsubscribe);

    // React strict-mode (or test environment) may invoke effects more than once.
    // Use a stable resolved value rather than `mockResolvedValueOnce`.
    getRecentFiles.mockResolvedValue([{ path: '/testuser/f1', name: 'f1' }]);

    const onPathClick = jest.fn();
    const initialProps = {
      currentPath: '/',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick,
    };

    const { result, rerender } = renderHook((props) => useFolderTreeController(props), {
      initialProps,
    });

    await waitFor(() => {
      expect(result.current.recentFilesList).toHaveLength(1);
    });
    expect(result.current.recentFilesList[0]).toMatchObject({ path: '/testuser/f1', name: 'f1' });

    rerender({ ...initialProps, user: null });

    await waitFor(() => {
      expect(result.current.recentFilesList).toEqual([]);
    });
  });

  it('subscribes to recent-file changes and reloads when notified', async () => {
    let notifyRecentChange;
    const unsubscribe = jest.fn();
    onRecentFilesChange.mockImplementation((cb) => {
      notifyRecentChange = cb;
      return unsubscribe;
    });

    const first = [{ path: '/testuser/f1', name: 'f1' }];
    const second = [{ path: '/testuser/f2', name: 'f2' }];
    let loadCallCount = 0;
    getRecentFiles.mockImplementation(async () => {
      loadCallCount += 1;
      return loadCallCount === 1 ? first : second;
    });

    const { result } = renderControllerHook({
      currentPath: '/',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(result.current.recentFilesList).toHaveLength(1);
    });

    act(() => {
      expect(typeof notifyRecentChange).toBe('function');
      notifyRecentChange();
    });

    await waitFor(() => {
      expect(result.current.recentFilesList).toHaveLength(1);
      expect(result.current.recentFilesList[0]).toMatchObject({ path: '/testuser/f2', name: 'f2' });
    });
  });

  it('loads shared folders for non-admin users', async () => {
    onRecentFilesChange.mockImplementation(() => jest.fn());
    getRecentFiles.mockResolvedValue([]);

    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
      { nodeId: 20, permission: 'read' },
    ]);

    const { result } = renderControllerHook({
      currentPath: '/',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toHaveLength(2);
    });
    expect(result.current.sharedFolders[0]).toMatchObject({ nodeId: 10, permission: 'read' });
  });

  it('does not load shared folders for admin users', async () => {
    const { result } = renderControllerHook({
      currentPath: '/',
      user: { id: '1', username: 'admin', is_admin: true },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toEqual([]);
    });

    expect(folderTreeGateway.getUserSharedFolderPermissions).not.toHaveBeenCalled();
  });

  it('keeps empty recent state from repository fallback and clears shared state on shared-load failure', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getRecentFiles.mockResolvedValue([]);
    folderTreeGateway.getUserSharedFolderPermissions.mockRejectedValue(new Error('shared failed'));

    const { result } = renderControllerHook({
      currentPath: '/',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(result.current.recentFilesList).toEqual([]);
      expect(result.current.sharedFolders).toEqual([]);
    });

    consoleErrorSpy.mockRestore();
  });

  it('sets sharedExpanded/recentExpanded based on currentPath', async () => {
    onRecentFilesChange.mockImplementation(() => jest.fn());
    getRecentFiles.mockResolvedValue([]);
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);

    const { result: sharedResult } = renderControllerHook({
      currentPath: '/__shared__',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(sharedResult.current.sharedExpanded).toBe(true);
    });

    const { result: recentResult } = renderControllerHook({
      currentPath: '/__recent__',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(recentResult.current.recentExpanded).toBe(true);
    });
  });

  it('auto-expands shared sections when currentPath enters a shared folder prefix', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
    ]);

    const { result } = renderControllerHook({
      currentPath: '/__shared__/10',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(result.current.sharedExpanded).toBe(true);
    });
  });

  it('expands prefixes of currentPath plus homePath, and handleSharedToggle navigates', async () => {
    onRecentFilesChange.mockImplementation(() => jest.fn());
    getRecentFiles.mockResolvedValue([]);
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);

    const onPathClick = jest.fn();

    const { result } = renderControllerHook({
      currentPath: '/a/b',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick,
    });

    await waitFor(() => {
      expect(Array.from(result.current.expandedPaths)).toEqual(
        expect.arrayContaining(['/a', '/a/b', '/testuser'])
      );
    });

    expect(result.current.sharedExpanded).toBe(false);
    act(() => {
      result.current.handleSharedToggle({ stopPropagation: jest.fn() });
    });

    await waitFor(() => {
      expect(result.current.sharedExpanded).toBe(true);
      expect(onPathClick).toHaveBeenCalledWith('/__shared__');
    });
  });

  it('keeps only homePath expanded when currentPath is falsy', async () => {
    const { result } = renderControllerHook({
      currentPath: '',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick: jest.fn(),
    });

    await waitFor(() => {
      expect(Array.from(result.current.expandedPaths)).toEqual(['/testuser']);
    });
  });

  it('routes recent and shared folder click handlers through onPathClick', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
    ]);
    const onPathClick = jest.fn();
    const { result } = renderControllerHook({
      currentPath: '/',
      user: { id: '1', username: 'testuser', is_admin: false },
      onPathClick,
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toHaveLength(1);
    });

    act(() => {
      result.current.handleRecentClick();
      result.current.handleSharedFolderClick('/__shared__/10');
      result.current.handleRecentToggle({ stopPropagation: jest.fn() });
    });

    expect(onPathClick).toHaveBeenCalledWith('/__recent__');
    expect(onPathClick).toHaveBeenCalledWith('/__shared__/10');
    expect(result.current.recentExpanded).toBe(true);
  });
});

