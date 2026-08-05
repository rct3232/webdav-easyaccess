/**
 * useFolderTreeItemController tests.
 * @see docs/spec/client/hooks/useFolderTreeItemController.md
 * @see docs/TESTING_STRATEGY.md
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import useFolderTreeItemController from '../useFolderTreeItemController';

jest.mock('../../../../services/folderTreeGateway', () => ({
  __esModule: true,
  default: {
    listFolderChildren: jest.fn(),
  },
}));

jest.mock('../../../../hooks/useDropToUpload', () => ({
  useDropToUpload: jest.fn(),
}));

import folderTreeGateway from '../../../../services/folderTreeGateway';
import { useDropToUpload } from '../../../../hooks/useDropToUpload';

const createProps = (overrides = {}) => ({
  node: { nodeId: 10, name: 'root' },
  currentNodeId: null,
  expandedNodeIds: new Set(),
  onNodeClick: jest.fn(),
  onToggleExpand: jest.fn(),
  hasReadPermission: true,
  hasWritePermission: true,
  children: [],
  ...overrides,
});

describe('useFolderTreeItemController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderTreeGateway.listFolderChildren.mockResolvedValue([]);
    useDropToUpload.mockReturnValue({
      isDropTarget: false,
      isDraggingOver: false,
      handleFolderDragOver: jest.fn(),
      handleFolderDragEnter: jest.fn(),
      handleFolderDragLeave: jest.fn(),
      handleFolderDrop: jest.fn(),
    });
  });

  it('lazy loads children when expanded and not yet loaded', async () => {
    folderTreeGateway.listFolderChildren.mockResolvedValue([
      { nodeId: 20, name: 'docs', hasReadPermission: true, hasWritePermission: true },
    ]);

    const { result } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          expandedNodeIds: new Set([10]),
        })
      )
    );

    await waitFor(() => {
      expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 10 })
      );
    });

    await waitFor(() => {
      expect(result.current.children).toEqual([
        { nodeId: 20, name: 'docs', hasReadPermission: true, hasWritePermission: true },
      ]);
      expect(result.current.hasLoaded).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });

  it('adds a created child once and requests expansion when the parent is collapsed', async () => {
    const props = createProps();
    const { result, rerender } = renderHook((hookProps) => useFolderTreeItemController(hookProps), {
      initialProps: props,
    });

    act(() => {
      rerender({
        ...props,
        treeUpdateTrigger: {
          type: 'created',
          parentNodeId: 10,
          nodeId: 20,
          name: 'docs',
        },
      });
    });

    expect(result.current.children).toEqual([{ nodeId: 20, name: 'docs' }]);
    expect(props.onToggleExpand).toHaveBeenCalledWith(10);

    act(() => {
      rerender({
        ...props,
        treeUpdateTrigger: {
          type: 'created',
          parentNodeId: 10,
          nodeId: 20,
          name: 'docs',
        },
      });
    });

    expect(result.current.children).toEqual([{ nodeId: 20, name: 'docs' }]);
  });

  it('removes the matching child on deleted updates', () => {
    const props = createProps({
      children: [
        { nodeId: 20, name: 'docs' },
        { nodeId: 21, name: 'photos' },
      ],
    });

    const { result, rerender } = renderHook((hookProps) => useFolderTreeItemController(hookProps), {
      initialProps: props,
    });

    act(() => {
      rerender({
        ...props,
        treeUpdateTrigger: {
          type: 'deleted',
          nodeId: 20,
        },
      });
    });

    expect(result.current.children).toEqual([{ nodeId: 21, name: 'photos' }]);
  });

  it('reloads on refresh updates only when expanded or home', async () => {
    const expandedProps = createProps({
      expandedNodeIds: new Set([10]),
      children: [{ nodeId: 99, name: 'existing' }],
    });
    const { rerender: rerenderExpanded } = renderHook((hookProps) => useFolderTreeItemController(hookProps), {
      initialProps: expandedProps,
    });

    act(() => {
      rerenderExpanded({
        ...expandedProps,
        treeUpdateTrigger: { type: 'refresh' },
      });
    });

    await waitFor(() => {
      expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledTimes(1);
    });

    folderTreeGateway.listFolderChildren.mockClear();

    const homeProps = createProps({
      isHome: true,
      children: [{ nodeId: 99, name: 'existing' }],
    });
    const { rerender: rerenderHome } = renderHook((hookProps) => useFolderTreeItemController(hookProps), {
      initialProps: homeProps,
    });

    act(() => {
      rerenderHome({
        ...homeProps,
        treeUpdateTrigger: { type: 'refresh' },
      });
    });

    await waitFor(() => {
      expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledTimes(1);
    });

    folderTreeGateway.listFolderChildren.mockClear();

    const collapsedProps = createProps({
      children: [{ nodeId: 99, name: 'existing' }],
    });
    const { rerender: rerenderCollapsed } = renderHook((hookProps) => useFolderTreeItemController(hookProps), {
      initialProps: collapsedProps,
    });

    act(() => {
      rerenderCollapsed({
        ...collapsedProps,
        treeUpdateTrigger: { type: 'refresh' },
      });
    });

    expect(folderTreeGateway.listFolderChildren).not.toHaveBeenCalled();
  });

  it('prefers explicit node permissions over sharedFoldersMap fallback', () => {
    const sharedFoldersMap = new Map([
      [10, { permission: PERMISSIONS.WRITE }],
    ]);

    const { result } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          node: {
            nodeId: 10,
            name: 'shared',
            hasReadPermission: false,
            hasWritePermission: false,
          },
          sharedFoldersMap,
        })
      )
    );

    expect(result.current.hasReadPermission).toBe(false);
    expect(result.current.hasWritePermission).toBe(false);
    expect(result.current.isDisabled).toBe(true);
  });

  it('derives permissions from sharedFoldersMap (keyed by nodeId) when explicit node permissions are absent', () => {
    const sharedFoldersMap = new Map([
      [10, { permission: PERMISSIONS.WRITE }],
    ]);

    const { result } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          node: { nodeId: 10, name: 'shared' },
          hasReadPermission: false,
          hasWritePermission: false,
          sharedFoldersMap,
        })
      )
    );

    expect(result.current.hasReadPermission).toBe(true);
    expect(result.current.hasWritePermission).toBe(true);
    expect(result.current.isDisabled).toBe(false);
  });

  it('wires useDropToUpload with nodeId and internalDraggedNodeId so isFolderMode activates', () => {
    useDropToUpload.mockReturnValue({
      isDropTarget: false,
      isDraggingOver: false,
      handleFolderDragOver: jest.fn(),
      handleFolderDragEnter: jest.fn(),
      handleFolderDragLeave: jest.fn(),
      handleFolderDrop: jest.fn(),
    });

    renderHook(() =>
      useFolderTreeItemController(
        createProps({
          node: { nodeId: 10, name: 'root' },
          internalDraggedNodeId: 42,
        })
      )
    );

    expect(useDropToUpload).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 10, internalDraggedNodeId: 42 })
    );
  });

  it('publishes drag start (text/plain = String(nodeId)) and drag end only for enabled desktop items', () => {
    const onInternalDragStart = jest.fn();
    const onInternalDragEnd = jest.fn();
    const { result } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          onInternalDragStart,
          onInternalDragEnd,
        })
      )
    );

    const event = {
      stopPropagation: jest.fn(),
      dataTransfer: {
        effectAllowed: '',
        setData: jest.fn(),
      },
    };

    act(() => {
      result.current.handleDragStart(event);
    });

    expect(onInternalDragStart).toHaveBeenCalledWith(10);
    expect(event.dataTransfer.effectAllowed).toBe('move');
    expect(event.dataTransfer.setData).toHaveBeenCalledWith('text/plain', '10');

    act(() => {
      result.current.handleDragEnd();
    });

    expect(onInternalDragEnd).toHaveBeenCalled();
  });

  it('does not start drag for disabled or mobile items', () => {
    const onInternalDragStart = jest.fn();
    const event = {
      stopPropagation: jest.fn(),
      dataTransfer: {
        effectAllowed: '',
        setData: jest.fn(),
      },
    };

    const { result: disabledResult } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          hasReadPermission: false,
          onInternalDragStart,
        })
      )
    );

    act(() => {
      disabledResult.current.handleDragStart(event);
    });

    expect(onInternalDragStart).not.toHaveBeenCalled();
    expect(event.dataTransfer.setData).not.toHaveBeenCalled();

    const { result: mobileResult } = renderHook(() =>
      useFolderTreeItemController(
        createProps({
          isMobile: true,
          onInternalDragStart,
        })
      )
    );

    act(() => {
      mobileResult.current.handleDragStart(event);
    });

    expect(onInternalDragStart).not.toHaveBeenCalled();
  });
});
