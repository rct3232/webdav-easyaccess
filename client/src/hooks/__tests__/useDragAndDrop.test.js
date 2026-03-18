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

  it('handleDragOver sets dropEffect to "none" and does not set drop target when target folder has hasWritePermission === false', () => {
    const draggedFile = { path: '/a.txt', type: 'file' };
    const noWriteFolder = { path: '/readonly', type: 'directory', hasWritePermission: false };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    expect(result.current.draggedFile).toEqual(draggedFile);

    act(() => {
      result.current.handleDragOver(
        { preventDefault: jest.fn(), dataTransfer },
        noWriteFolder
      );
    });

    expect(dataTransfer.dropEffect).toBe('none');
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDragOver sets dropEffect to "move" and sets drop target when target folder has write permission', () => {
    const draggedFile = { path: '/a.txt', type: 'file' };
    const writeFolder = { path: '/writable', type: 'directory', hasWritePermission: true };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDragOver(
        { preventDefault: jest.fn(), dataTransfer },
        writeFolder
      );
    });

    expect(dataTransfer.dropEffect).toBe('move');
    expect(result.current.dropTarget).toBe('/writable');
  });

  it('handleDrop calls onDropPermissionDenied and does not call onFileDrop when target has no write permission', () => {
    const draggedFile = { path: '/a.txt', type: 'file' };
    const noWriteFolder = { path: '/readonly', type: 'directory', hasWritePermission: false };
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

    expect(mockOnDropPermissionDenied).toHaveBeenCalledWith('/readonly');
    expect(mockOnFileDrop).not.toHaveBeenCalled();
    expect(result.current.draggedFile).toBeNull();
    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDrop calls onFileDrop when target has write permission', () => {
    const draggedFile = { path: '/a.txt', type: 'file' };
    const writeFolder = { path: '/dest', type: 'directory', hasWritePermission: true };
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

  it('handleDragOver does not set drop target when target folder is the parent of the dragged path (no-op move)', () => {
    const draggedFile = { path: '/folder/child.txt', type: 'file' };
    const parentFolder = { path: '/folder', type: 'directory', hasWritePermission: true };
    const dataTransfer = { dropEffect: '', setData: jest.fn(), effectAllowed: '' };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragStart({ dataTransfer }, draggedFile);
    });
    act(() => {
      result.current.handleDragOver(
        { preventDefault: jest.fn(), dataTransfer },
        parentFolder
      );
    });

    expect(result.current.dropTarget).toBeNull();
  });

  it('handleDrop does not call onFileDrop when target folder is the parent of the dragged path (no-op move)', () => {
    const draggedFile = { path: '/folder/child.txt', type: 'file' };
    const parentFolder = { path: '/folder', type: 'directory', hasWritePermission: true };
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

  it('handleDrop does not call onFileDrop for tree-origin no-op drops (target is parent of tree path or equals tree path)', () => {
    const parentFolder = { path: '/folder', type: 'directory', hasWritePermission: true };
    const selfFolder = { path: '/folder', type: 'directory', hasWritePermission: true };

    const eSameParent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        getData: jest.fn(() => '/folder/child.txt'),
      },
    };
    const eSelf = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        getData: jest.fn(() => '/folder'),
      },
    };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDrop(eSameParent, parentFolder);
    });
    expect(mockOnFileDrop).not.toHaveBeenCalled();

    act(() => {
      result.current.handleDrop(eSelf, selfFolder);
    });
    expect(mockOnFileDrop).not.toHaveBeenCalled();
  });

  it('handleDragOver does not set drop target for tree-origin no-op drops when treePath is available', () => {
    const folder = { path: '/folder', type: 'directory', hasWritePermission: true };
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      types: ['text/plain'],
      getData: jest.fn(() => '/folder/child.txt'),
    };

    const { result } = renderHook(() =>
      useDragAndDrop(mockOnFileDrop, false, null, mockOnDropPermissionDenied)
    );

    act(() => {
      result.current.handleDragOver(
        { preventDefault: jest.fn(), dataTransfer },
        folder
      );
    });

    expect(result.current.dropTarget).toBeNull();
  });
});
