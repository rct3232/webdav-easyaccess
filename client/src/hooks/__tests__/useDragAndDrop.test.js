/**
 * useDragAndDrop tests.
 * @see docs/spec/client/hooks/useDragAndDrop.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useDragAndDrop } from '../useDragAndDrop';

jest.mock('../../utils/dragGhostImage', () => ({
  setupDragGhost: jest.fn(),
}));

describe('useDragAndDrop', () => {
  const mockOnFileDrop = jest.fn();
  const mockOnDropPermissionDenied = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handleDragOver sets dropEffect to "none" and does not set drop target when target folder hasWritePermission is false', () => {
    const draggedFile = { nodeId: 1, parentNodeId: 2, type: 'file' };
    const noWriteFolder = { nodeId: 3, type: 'directory', hasWritePermission: false };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    expect(result.current.draggedFile).toEqual(draggedFile);

    act(() => {
      result.current.handleDragOver({ preventDefault: jest.fn(), dataTransfer }, noWriteFolder);
    });

    expect(dataTransfer.dropEffect).toBe('none');
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDragOver sets dropEffect to "move" and sets drop target when target folder has write permission', () => {
    const draggedFile = { nodeId: 1, parentNodeId: 2, type: 'file' };
    const writeFolder = { nodeId: 3, type: 'directory', hasWritePermission: true };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDragOver({ preventDefault: jest.fn(), dataTransfer }, writeFolder);
    });

    expect(dataTransfer.dropEffect).toBe('move');
    expect(result.current.dropTarget).toBe(3);
  });

  it('handleDrop calls onDropPermissionDenied and does not call onFileDrop when target has no write permission', () => {
    const draggedFile = { nodeId: 1, parentNodeId: 2, type: 'file' };
    const noWriteFolder = { nodeId: 3, type: 'directory', hasWritePermission: false };
    const e = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    const dataTransfer = { setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDrop(e, noWriteFolder);
    });

    expect(mockOnDropPermissionDenied).toHaveBeenCalledWith(3);
    expect(mockOnFileDrop).not.toHaveBeenCalled();
    expect(result.current.draggedFile).toBeNull();
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDrop calls onFileDrop when target has write permission', () => {
    const draggedFile = { nodeId: 1, parentNodeId: 2, type: 'file' };
    const writeFolder = { nodeId: 3, type: 'directory', hasWritePermission: true };
    const e = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    const dataTransfer = { setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDrop(e, writeFolder);
    });

    expect(mockOnFileDrop).toHaveBeenCalledWith(draggedFile, writeFolder);
    expect(mockOnDropPermissionDenied).not.toHaveBeenCalled();
  });

  it('handleDragOver does not set drop target when target folder is the parent of the dragged nodeId (no-op move)', () => {
    const draggedFile = { nodeId: 5, parentNodeId: 3, type: 'file' };
    const parentFolder = { nodeId: 3, type: 'directory', hasWritePermission: true };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDragOver({ preventDefault: jest.fn(), dataTransfer }, parentFolder);
    });

    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDrop does not call onFileDrop when target folder is the parent of the dragged nodeId (no-op move)', () => {
    const draggedFile = { nodeId: 5, parentNodeId: 3, type: 'file' };
    const parentFolder = { nodeId: 3, type: 'directory', hasWritePermission: true };
    const e = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    const dataTransfer = { setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDrop(e, parentFolder);
    });

    expect(mockOnFileDrop).not.toHaveBeenCalled();
    expect(mockOnDropPermissionDenied).not.toHaveBeenCalled();
    expect(result.current.draggedFile).toBeNull();
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDrop does not call onFileDrop for tree-origin no-op drops (target nodeId equals dragged nodeId)', () => {
    const targetFolder = { nodeId: 3, type: 'directory', hasWritePermission: true };

    const eSelf = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        getData: jest.fn(() => String(3)),
      },
    };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDrop(eSelf, targetFolder);
    });
    expect(mockOnFileDrop).not.toHaveBeenCalled();
  });

  it('handleDragOver does not set drop target for tree-origin no-op drops when dragged nodeId matches', () => {
    const folder = { nodeId: 3, type: 'directory', hasWritePermission: true };
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      types: ['text/plain'],
      getData: jest.fn(() => String(3)),
    };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragOver({ preventDefault: jest.fn(), dataTransfer }, folder);
    });

    expect(result.current.dropTarget).toBeNull();
  });
});
