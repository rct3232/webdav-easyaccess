/**
 * useFolderTreeController tests.
 * @see docs/spec/client/hooks/useFolderTreeController.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import useFolderTreeController from '../useFolderTreeController';

jest.mock('../../../../services/recentFilesRepository', () => {
  const { createRecentFilesRepositoryMock } = require('../../../../testing/mocks/serviceMocks');
  return createRecentFilesRepositoryMock();
});

jest.mock('../../../../services/recentFilesNotifier', () => {
  const { createRecentFilesNotifierMock } = require('../../../../testing/mocks/serviceMocks');
  return createRecentFilesNotifierMock();
});

jest.mock('../../../../services/folderTreeGateway', () => {
  const { createFolderTreeGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return createFolderTreeGatewayMock();
});

import { getRecentFiles } from '../../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../../services/recentFilesNotifier';
import folderTreeGateway from '../../../../services/folderTreeGateway';

const renderControllerHook = (initialProps) =>
  renderHook((props) => useFolderTreeController(props), { initialProps });

const baseUser = { id: '1', username: 'testuser', is_admin: false, rootNodeId: 1 };

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

    getRecentFiles.mockResolvedValue([{ path: '/testuser/f1', name: 'f1' }]);

    const onNodeClick = jest.fn();
    const initialProps = {
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick,
      ancestors: [],
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
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
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
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toHaveLength(2);
    });
    expect(result.current.sharedFolders[0]).toMatchObject({ nodeId: 10, permission: 'read' });
  });

  it('does not load shared folders for admin users', async () => {
    const { result } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: { id: '1', username: 'admin', is_admin: true },
      onNodeClick: jest.fn(),
      ancestors: [],
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
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(result.current.recentFilesList).toEqual([]);
      expect(result.current.sharedFolders).toEqual([]);
    });

    consoleErrorSpy.mockRestore();
  });

  it('sets sharedExpanded/recentExpanded based on the virtual-root routes', async () => {
    onRecentFilesChange.mockImplementation(() => jest.fn());
    getRecentFiles.mockResolvedValue([]);
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);

    const { result: sharedResult } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/__shared__',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(sharedResult.current.sharedExpanded).toBe(true);
    });

    const { result: recentResult } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/__recent__',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(recentResult.current.recentExpanded).toBe(true);
    });
  });

  it('auto-expands the shared section when current node is a shared folder', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
    ]);

    const { result } = renderControllerHook({
      currentNodeId: 10,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(result.current.sharedExpanded).toBe(true);
    });
  });

  it('expands home, ancestor node ids and the current node; handleSharedToggle navigates to /__shared__', async () => {
    onRecentFilesChange.mockImplementation(() => jest.fn());
    getRecentFiles.mockResolvedValue([]);
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);

    const onNodeClick = jest.fn();

    const { result } = renderControllerHook({
      currentNodeId: 3,
      currentPath: '/',
      user: baseUser,
      onNodeClick,
      ancestors: [{ nodeId: 1, name: 'testuser' }, { nodeId: 2, name: 'a' }],
    });

    await waitFor(() => {
      expect(Array.from(result.current.expandedNodeIds)).toEqual(
        expect.arrayContaining([1, 2, 3])
      );
    });

    expect(result.current.homeNodeId).toBe(1);
    expect(result.current.sharedExpanded).toBe(false);
    act(() => {
      result.current.handleSharedToggle({ stopPropagation: jest.fn() });
    });

    await waitFor(() => {
      expect(result.current.sharedExpanded).toBe(true);
      expect(onNodeClick).toHaveBeenCalledWith('/__shared__');
    });
  });

  it('keeps only homeNodeId expanded when currentNodeId is falsy', async () => {
    const { result } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(Array.from(result.current.expandedNodeIds)).toEqual([1]);
    });
  });

  it('routes recent and shared folder click handlers through onNodeClick', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read' },
    ]);
    const onNodeClick = jest.fn();
    const { result } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick,
      ancestors: [],
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toHaveLength(1);
    });

    act(() => {
      result.current.handleRecentClick();
      result.current.handleSharedFolderClick(10);
      result.current.handleRecentToggle({ stopPropagation: jest.fn() });
    });

    expect(onNodeClick).toHaveBeenCalledWith('/__recent__');
    expect(onNodeClick).toHaveBeenCalledWith(10);
    expect(result.current.recentExpanded).toBe(true);
  });
});
