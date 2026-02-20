/**
 * useSelection tests.
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../useSelection';

const displayFiles = [
  { path: '/file1.txt', type: 'file' },
  { path: '/file2.txt', type: 'file' },
  { path: '/folder', type: 'directory' },
];

describe('useSelection', () => {
  it('starts with selectionMode false and empty selectedFiles', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('handleSelectAll selects all displayed files', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.selectedFiles.size).toBe(3);
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(true);
    expect(result.current.selectedFiles.has('/file2.txt')).toBe(true);
    expect(result.current.selectedFiles.has('/folder')).toBe(true);
  });

  it('handleDeselectAll clears selection', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    act(() => {
      result.current.handleSelectAll();
    });
    act(() => {
      result.current.handleDeselectAll();
    });

    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('handleToggleSelectionMode toggles mode and clears selection', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    act(() => {
      result.current.handleSelectAll();
    });
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedFiles.size).toBe(3);

    act(() => {
      result.current.handleToggleSelectionMode();
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedFiles.size).toBe(0);

    act(() => {
      result.current.handleToggleSelectionMode();
    });
    expect(result.current.selectionMode).toBe(false);
  });

  it('handleFileCheck adds and removes files from selection', () => {
    const { result } = renderHook(() => useSelection(displayFiles));
    const file = displayFiles[0];

    act(() => {
      result.current.handleFileCheck(file, true);
    });
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(true);

    act(() => {
      result.current.handleFileCheck(file, false);
    });
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(false);
  });

  it('toggleFileSelection toggles file in selection', () => {
    const { result } = renderHook(() => useSelection(displayFiles));
    const file = displayFiles[0];

    act(() => {
      result.current.toggleFileSelection(file);
    });
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(true);

    act(() => {
      result.current.toggleFileSelection(file);
    });
    expect(result.current.selectedFiles.has('/file1.txt')).toBe(false);
  });

  it('uses allFiles for select all when provided', () => {
    const allFiles = [
      { path: '/visible.txt', type: 'file' },
      { path: '/hidden.txt', type: 'file' },
    ];
    const displayedFiles = [{ path: '/visible.txt', type: 'file' }];
    const { result } = renderHook(() => useSelection(displayedFiles, allFiles));

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.selectedFiles.size).toBe(2);
    expect(result.current.selectedFiles.has('/visible.txt')).toBe(true);
    expect(result.current.selectedFiles.has('/hidden.txt')).toBe(true);
  });
});
