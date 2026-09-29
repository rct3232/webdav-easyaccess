/**
 * useFolderTreeController tests.
 * @see docs/spec/client/hooks/useFolderTreeController.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import useFolderTreeController from '../useFolderTreeController';

import { getRecentFiles } from '../../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../../services/recentFilesNotifier';
import folderTreeGateway from '../../../../services/folderTreeGateway';
import explorerGateway from '../../../../services/explorerGateway';

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

jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return { __esModule: true, default: createExplorerGatewayMock() };
});

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
    // CRA resetMocks strips the serviceMocks factory implementations — re-supply
    // the §3 collections seams so the new effect can mount/unmount everywhere.
    explorerGateway.loadCollections.mockResolvedValue({ collections: [] });
    explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
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
      { nodeId: 10, name: 'Shared Docs', permission: 'read', type: 'directory' },
      { nodeId: 20, name: 'Team Assets', permission: 'read', type: 'directory' },
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
    expect(result.current.sharedFolders[0]).toMatchObject({
      nodeId: 10,
      name: 'Shared Docs',
      permission: 'read',
    });
  });

  it('does not load shared folders for admin users', async () => {
    const { result } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: { id: '1', username: 'admin', is_admin: true, rootNodeId: 999 },
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

  it('builds shared tree nodes with real folder names from the gateway result', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 10, name: 'Team Docs', permission: 'write', type: 'directory' },
    ]);

    const { result } = renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });

    await waitFor(() => {
      expect(result.current.sharedFolders).toHaveLength(1);
    });

    const tree = result.current.buildSharedFolderTree();

    expect(tree).toEqual([
      expect.objectContaining({ nodeId: 10, name: 'Team Docs', permission: 'write' }),
    ]);
    expect(JSON.stringify(tree)).not.toContain('Shared (10)');
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
      ancestors: [
        { nodeId: 1, name: 'testuser' },
        { nodeId: 2, name: 'a' },
      ],
    });

    await waitFor(() => {
      expect(Array.from(result.current.expandedNodeIds)).toEqual(expect.arrayContaining([1, 2, 3]));
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

/**
 * AI-platform virtual-node registration (§3 addendum + CollectionsSection §2.5/§2.6).
 * @see docs/spec/client/hooks/useFolderTreeController.md §3
 */
describe('useFolderTreeController — collections section (§3)', () => {
  const rowA = {
    collection_id: 7,
    name: 'Alpha',
    item_count: 3,
    granted_role: null,
    status: 'active',
    origin: 'user',
    created_at: '2026-01-01T00:00:00Z',
  };
  const rowShared = {
    collection_id: 8,
    name: 'Received',
    item_count: 1,
    granted_role: 'viewer',
    status: 'active',
    origin: 'seed',
    created_at: '2026-01-02T00:00:00Z',
  };
  const archivedRow = { ...rowA, collection_id: 9, name: 'Old', status: 'archived' };

  const renderCollections = (props = {}) =>
    renderControllerHook({
      currentNodeId: null,
      currentPath: '/',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
      ...props,
    });

  beforeEach(() => {
    window.localStorage.clear();
    // Base seams must stay array/cleanup-safe for this hook's other effects too.
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockImplementation(() => jest.fn());
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
    explorerGateway.loadCollections.mockReset();
    explorerGateway.loadCollections.mockImplementation(async ({ include } = {}) =>
      include === 'mine,archived'
        ? { collections: [archivedRow] }
        : { collections: [rowA, rowShared] }
    );
    explorerGateway.subscribeToCollections.mockReset();
    explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
  });

  it('loads flat tree rows via the gateway activity+include seams (depth-1: collection rows only)', async () => {
    const { result } = renderCollections();
    await waitFor(() => {
      expect(result.current.collectionsTreeRows).toHaveLength(2);
    });
    expect(explorerGateway.loadCollections).toHaveBeenCalledWith({
      sort: 'activity',
      include: 'mine,shared',
    });
    expect(explorerGateway.loadCollections).toHaveBeenCalledWith({
      sort: 'activity',
      include: 'mine,archived',
    });
    // depth-1: the tree state exposes collection rows only — never member items
    expect(result.current.collectionsTreeRows.map((r) => r.collection_id)).toEqual([7, 8]);
    expect(explorerGateway.loadCollectionItems).not.toHaveBeenCalled();
  });

  it('exposes archiveCount from the archived include read', async () => {
    const { result } = renderCollections();
    await waitFor(() => {
      expect(result.current.archiveCount).toBe(1);
    });
  });

  it('notifier events refresh the flat rows; unmount unsubscribes', async () => {
    let notify;
    const unsubscribe = jest.fn();
    explorerGateway.subscribeToCollections.mockImplementation((cb) => {
      notify = cb;
      return unsubscribe;
    });
    const { result, unmount } = renderCollections();
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(2));
    expect(explorerGateway.subscribeToCollections).toHaveBeenCalled();

    explorerGateway.loadCollections.mockImplementation(async ({ include } = {}) =>
      include === 'mine,archived' ? { collections: [] } : { collections: [rowA] }
    );
    await act(async () => {
      notify();
    });
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(1));
    await waitFor(() => expect(result.current.archiveCount).toBe(0));

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('load failure keeps rows array-safe', async () => {
    explorerGateway.loadCollections.mockRejectedValue(new Error('boom'));
    const { result } = renderCollections();
    await waitFor(() => {
      expect(explorerGateway.loadCollections).toHaveBeenCalled();
    });
    expect(Array.isArray(result.current.collectionsTreeRows)).toBe(true);
    expect(result.current.collectionsTreeRows).toEqual([]);
    expect(result.current.archiveCount).toBe(0);
  });

  it('handleCollectionsClick / handleArchiveClick / handleLikedClick / handleCollectionClick route via the host', async () => {
    const onNodeClick = jest.fn();
    const { result } = renderCollections({ onNodeClick });
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(2));

    act(() => result.current.handleCollectionsClick());
    act(() => result.current.handleArchiveClick());
    act(() => result.current.handleLikedClick());
    act(() => result.current.handleCollectionClick(7));

    expect(onNodeClick).toHaveBeenCalledWith('/__collections__');
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/__archive__');
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/liked'); // P-5
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/collection/7');
  });

  it('handleCollectionsToggle expands and navigates the __collections__ route on expand', async () => {
    const onNodeClick = jest.fn();
    const { result } = renderCollections({ onNodeClick });
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(2));
    expect(result.current.collectionsExpanded).toBe(false);

    act(() => result.current.handleCollectionsToggle({ stopPropagation: jest.fn() }));
    expect(result.current.collectionsExpanded).toBe(true);
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__');

    act(() => result.current.handleCollectionsToggle({ stopPropagation: jest.fn() }));
    expect(result.current.collectionsExpanded).toBe(false);
  });

  it('locations inside a collections route auto-expand the section', async () => {
    const { result, rerender } = renderCollections();
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(2));
    expect(result.current.collectionsExpanded).toBe(false);

    rerender({
      currentNodeId: null,
      currentPath: '/__collections__/collection/7',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });
    await waitFor(() => {
      expect(result.current.collectionsExpanded).toBe(true);
    });
  });

  it('new-collection dots come from the stored visit cursor; visiting __collections__ clears them', async () => {
    // Cursor predates both rows' created_at → everything is "new".
    window.localStorage.setItem(
      'collections.lastVisitedAt',
      String(new Date('2025-12-01T00:00:00Z').getTime())
    );
    const { result, rerender } = renderCollections();
    await waitFor(() => expect(result.current.collectionsTreeRows).toHaveLength(2));
    expect(result.current.newCollectionIds).toEqual([7, 8]);

    // Arriving at the section visits it: cursor refreshes → dots clear.
    rerender({
      currentNodeId: null,
      currentPath: '/__collections__',
      user: baseUser,
      onNodeClick: jest.fn(),
      ancestors: [],
    });
    await waitFor(() => {
      expect(result.current.newCollectionIds).toEqual([]);
    });
    expect(Number(window.localStorage.getItem('collections.lastVisitedAt'))).toBeGreaterThan(
      Date.now() - 60 * 1000
    );
  });
});
