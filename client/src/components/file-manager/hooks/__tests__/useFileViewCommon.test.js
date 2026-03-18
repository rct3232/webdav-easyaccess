/**
 * useFileViewCommon tests.
 * @see docs/spec/client/hooks/useFileViewCommon.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { useFileViewCommon } from '../useFileViewCommon';

const theme = createTheme();
const mockOnFileDrop = jest.fn();
const mockOnFileCheck = jest.fn();

describe('useFileViewCommon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns getFileState, handleFileCheck, isSelected, getDragHandlers, getDropHandlers', () => {
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        theme,
      })
    );

    expect(typeof result.current.getFileState).toBe('function');
    expect(typeof result.current.handleFileCheck).toBe('function');
    expect(typeof result.current.isSelected).toBe('function');
    expect(typeof result.current.getDragHandlers).toBe('function');
    expect(typeof result.current.getDropHandlers).toBe('function');
  });

  it('getFileState returns isSelected, isDisabled, isProcessing from file and selection', () => {
    const file = {
      path: '/file.txt',
      basename: 'file.txt',
      type: 'file',
      hasReadPermission: true,
    };
    const selectedFiles = new Set(['/file.txt']);
    const processingMap = new Map([['/file.txt', 'rename']]);

    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles,
        processingMap,
        theme,
      })
    );

    const state = result.current.getFileState(file);

    expect(state.isSelected).toBe(true);
    expect(state.isProcessing).toBe(true);
    expect(state.isDisabled).toBe(true);
    expect(state.processingType).toBe('rename');
  });

  it('handleFileCheck calls onFileCheck when provided', () => {
    const file = { path: '/f.txt', basename: 'f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles: new Set(),
        onFileCheck: mockOnFileCheck,
        theme,
      })
    );

    act(() => {
      result.current.handleFileCheck(file, true, { stopPropagation: jest.fn() });
    });

    expect(mockOnFileCheck).toHaveBeenCalledWith(file, true);
  });

  it('isSelected returns true when file path is in selectedFiles', () => {
    const file = { path: '/a.txt', basename: 'a.txt' };
    const selectedFiles = new Set(['/a.txt']);

    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles,
        theme,
      })
    );

    expect(result.current.isSelected(file)).toBe(true);
  });

  it('isSelected returns false when file path is not in selectedFiles', () => {
    const file = { path: '/b.txt', basename: 'b.txt' };
    const selectedFiles = new Set(['/a.txt']);

    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles,
        theme,
      })
    );

    expect(result.current.isSelected(file)).toBe(false);
  });

  it('getDragHandlers returns empty when selectionMode is true', () => {
    const file = { path: '/f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles: new Set(),
        theme,
      })
    );

    const handlers = result.current.getDragHandlers(file, false);

    expect(handlers.draggable).toBe(false);
    expect(handlers.onDragStart).toBeUndefined();
    expect(handlers.onDragEnd).toBeUndefined();
  });

  it('getDragHandlers returns empty when isMobile is true', () => {
    const file = { path: '/f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        theme,
        isMobile: true,
      })
    );

    const handlers = result.current.getDragHandlers(file, false);

    expect(handlers.draggable).toBe(false);
  });

  it('getDragHandlers returns empty when isDisabled is true', () => {
    const file = { path: '/f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        theme,
      })
    );

    const handlers = result.current.getDragHandlers(file, true);

    expect(handlers.draggable).toBe(false);
  });

  it('getDragHandlers returns empty when file.hasWritePermission is false', () => {
    const file = { path: '/f.txt', type: 'file', hasWritePermission: false };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        theme,
      })
    );

    const handlers = result.current.getDragHandlers(file, false);

    expect(handlers.draggable).toBe(false);
    expect(handlers.onDragStart).toBeUndefined();
    expect(handlers.onDragEnd).toBeUndefined();
  });

  it('getDragHandlers returns draggable handlers when not selection mode and not disabled', () => {
    const file = { path: '/f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        onFileDrop: mockOnFileDrop,
        theme,
      })
    );

    const handlers = result.current.getDragHandlers(file, false);

    expect(handlers.draggable).toBe(true);
    expect(typeof handlers.onDragStart).toBe('function');
    expect(typeof handlers.onDragEnd).toBe('function');
  });

  it('getDropHandlers returns empty when selectionMode is true', () => {
    const file = { path: '/f.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: true,
        selectedFiles: new Set(),
        theme,
      })
    );

    const handlers = result.current.getDropHandlers(file, false);

    expect(handlers.onDragOver).toBeUndefined();
    expect(handlers.onDragLeave).toBeUndefined();
    expect(handlers.onDrop).toBeUndefined();
  });

  it('getDropHandlers returns handlers when not selection mode and not disabled', () => {
    const file = { path: '/folder', type: 'directory' };
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        onFileDrop: mockOnFileDrop,
        theme,
      })
    );

    const handlers = result.current.getDropHandlers(file, false);

    expect(typeof handlers.onDragOver).toBe('function');
    expect(typeof handlers.onDragLeave).toBe('function');
    expect(typeof handlers.onDrop).toBe('function');
  });

  it('returns draggedFile and dropTarget from useDragAndDrop', () => {
    const { result } = renderHook(() =>
      useFileViewCommon({
        selectionMode: false,
        selectedFiles: new Set(),
        theme,
      })
    );

    expect(result.current.draggedFile).toBeNull();
    expect(result.current.dropTarget).toBeNull();
  });
});
