import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../useSelection';

describe('useSelection', () => {
  const mockFiles = [
    { path: '/file1.txt', basename: 'file1.txt' },
    { path: '/folder1', basename: 'folder1', type: 'directory' },
    { path: '/file2.jpg', basename: 'file2.jpg' },
  ];

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSelection(mockFiles));

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('should toggle selection mode', () => {
    const { result } = renderHook(() => useSelection(mockFiles));

    act(() => {
      result.current.handleToggleSelectionMode();
    });

    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.handleToggleSelectionMode();
    });

    expect(result.current.selectionMode).toBe(false);
  });

  it('should select all files', () => {
    const { result } = renderHook(() => useSelection(mockFiles));

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.selectedFiles.size).toBe(3);
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(true);
    expect(result.current.selectedFiles.has('/folder1')).toBe(true);
    expect(result.current.selectedFiles.has('/file2.jpg')).toBe(true);
  });

  it('should deselect all files', () => {
    const { result } = renderHook(() => useSelection(mockFiles));

    act(() => {
      result.current.handleSelectAll();
      result.current.handleDeselectAll();
    });

    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('should toggle single file selection', () => {
    const { result } = renderHook(() => useSelection(mockFiles));
    const file = mockFiles[0];

    act(() => {
      result.current.toggleFileSelection(file);
    });

    expect(result.current.selectedFiles.has(file.path)).toBe(true);

    act(() => {
      result.current.toggleFileSelection(file);
    });

    expect(result.current.selectedFiles.has(file.path)).toBe(false);
  });

  it('should handle file check/uncheck', () => {
    const { result } = renderHook(() => useSelection(mockFiles));
    const file = mockFiles[1];

    act(() => {
      result.current.handleFileCheck(file, true);
    });

    expect(result.current.selectedFiles.has(file.path)).toBe(true);

    act(() => {
      result.current.handleFileCheck(file, false);
    });

    expect(result.current.selectedFiles.has(file.path)).toBe(false);
  });

  it('should clear selection when toggling selection mode', () => {
    const { result } = renderHook(() => useSelection(mockFiles));

    act(() => {
      result.current.handleSelectAll();
      result.current.handleToggleSelectionMode();
    });

    expect(result.current.selectedFiles.size).toBe(0);
  });
});
