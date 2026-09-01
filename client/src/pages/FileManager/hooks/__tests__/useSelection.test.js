/**
 * useSelection tests.
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../useSelection';

const displayFiles = [
  { nodeId: 1, path: '/file1.txt', type: 'file' },
  { nodeId: 2, path: '/file2.txt', type: 'file' },
  { nodeId: 3, path: '/folder', type: 'directory' },
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
    expect(result.current.selectedFiles.has(1)).toBe(true);
    expect(result.current.selectedFiles.has(2)).toBe(true);
    expect(result.current.selectedFiles.has(3)).toBe(true);
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
    expect(result.current.selectedFiles.has(1)).toBe(true);

    act(() => {
      result.current.handleFileCheck(file, false);
    });
    expect(result.current.selectedFiles.has(1)).toBe(false);
  });

  it('toggleFileSelection toggles file in selection', () => {
    const { result } = renderHook(() => useSelection(displayFiles));
    const file = displayFiles[0];

    act(() => {
      result.current.toggleFileSelection(file);
    });
    expect(result.current.selectedFiles.has(1)).toBe(true);

    act(() => {
      result.current.toggleFileSelection(file);
    });
    expect(result.current.selectedFiles.has(1)).toBe(false);
  });

  it('uses allFiles for select all when provided', () => {
    const allFiles = [
      { nodeId: 10, path: '/visible.txt', type: 'file' },
      { nodeId: 11, path: '/hidden.txt', type: 'file' },
    ];
    const displayedFiles = [{ nodeId: 10, path: '/visible.txt', type: 'file' }];
    const { result } = renderHook(() => useSelection(displayedFiles, allFiles));

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.selectedFiles.size).toBe(2);
    expect(result.current.selectedFiles.has(10)).toBe(true);
    expect(result.current.selectedFiles.has(11)).toBe(true);
  });

  it('keys entries without nodeId by path fallback (recent-file entries)', () => {
    const recentFiles = [{ path: '/recent.txt', type: 'file' }];
    const { result } = renderHook(() => useSelection(recentFiles));

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.selectedFiles.size).toBe(1);
    expect(result.current.selectedFiles.has('/recent.txt')).toBe(true);

    act(() => {
      result.current.toggleFileSelection(recentFiles[0]);
    });
    expect(result.current.selectedFiles.size).toBe(0);
  });

  describe('handleFileClickSelection', () => {
    const createEvent = (opts = {}) => ({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...opts,
    });

    it('single click enters selection mode and selects only that file', () => {
      const { result } = renderHook(() => useSelection(displayFiles));
      const file = displayFiles[1];
      const event = createEvent();

      act(() => {
        result.current.handleFileClickSelection(file, event, 1);
      });

      expect(result.current.selectionMode).toBe(true);
      expect(result.current.selectedFiles.size).toBe(1);
      expect(result.current.selectedFiles.has(2)).toBe(true);
    });

    it('Ctrl+click adds file to selection', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.handleFileClickSelection(displayFiles[0], createEvent(), 0);
      });
      act(() => {
        result.current.handleFileClickSelection(displayFiles[2], createEvent({ ctrlKey: true }), 2);
      });

      expect(result.current.selectionMode).toBe(true);
      expect(result.current.selectedFiles.size).toBe(2);
      expect(result.current.selectedFiles.has(1)).toBe(true);
      expect(result.current.selectedFiles.has(3)).toBe(true);
    });

    it('Ctrl+click removes file if already selected, auto-exits when last deselected', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.handleFileClickSelection(displayFiles[0], createEvent(), 0);
      });
      act(() => {
        result.current.handleFileClickSelection(displayFiles[0], createEvent({ ctrlKey: true }), 0);
      });

      expect(result.current.selectionMode).toBe(false);
      expect(result.current.selectedFiles.size).toBe(0);
    });

    it('Shift+click selects range from anchor to current', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.handleFileClickSelection(displayFiles[0], createEvent(), 0);
      });
      act(() => {
        result.current.handleFileClickSelection(
          displayFiles[2],
          createEvent({ shiftKey: true }),
          2
        );
      });

      expect(result.current.selectionMode).toBe(true);
      expect(result.current.selectedFiles.size).toBe(3);
      expect(result.current.selectedFiles.has(1)).toBe(true);
      expect(result.current.selectedFiles.has(2)).toBe(true);
      expect(result.current.selectedFiles.has(3)).toBe(true);
    });

    it('Shift+click with no anchor uses index 0', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.handleFileClickSelection(
          displayFiles[1],
          createEvent({ shiftKey: true }),
          1
        );
      });

      expect(result.current.selectionMode).toBe(true);
      expect(result.current.selectedFiles.size).toBe(2);
      expect(result.current.selectedFiles.has(1)).toBe(true);
      expect(result.current.selectedFiles.has(2)).toBe(true);
    });
  });

  describe('selectRange', () => {
    it('selects files in given index range', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.setSelectionMode(true);
        result.current.selectRange(1, 2);
      });

      expect(result.current.selectedFiles.size).toBe(2);
      expect(result.current.selectedFiles.has(2)).toBe(true);
      expect(result.current.selectedFiles.has(3)).toBe(true);
    });

    it('handles reversed indices', () => {
      const { result } = renderHook(() => useSelection(displayFiles));

      act(() => {
        result.current.setSelectionMode(true);
        result.current.selectRange(2, 0);
      });

      expect(result.current.selectedFiles.size).toBe(3);
    });

    it('no-op when displayedFiles is empty', () => {
      const { result } = renderHook(() => useSelection([]));

      act(() => {
        result.current.setSelectionMode(true);
        result.current.selectRange(0, 2);
      });

      expect(result.current.selectedFiles.size).toBe(0);
    });
  });

  it('auto-exits selection mode when selectedFiles becomes empty', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    act(() => {
      result.current.handleFileClickSelection(
        displayFiles[0],
        { ctrlKey: false, metaKey: false, shiftKey: false },
        0
      );
    });
    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.handleFileClickSelection(
        displayFiles[0],
        { ctrlKey: true, metaKey: false, shiftKey: false },
        0
      );
    });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('enterSelectionMode enters selection mode', () => {
    const { result } = renderHook(() => useSelection(displayFiles));

    act(() => {
      result.current.enterSelectionMode();
    });

    expect(result.current.selectionMode).toBe(true);
  });
});
