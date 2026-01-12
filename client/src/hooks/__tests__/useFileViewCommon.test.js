import { renderHook, act } from '@testing-library/react';
import { useFileViewCommon } from '../useFileViewCommon';
import * as useDragAndDropModule from '../useDragAndDrop';

// Mock useDragAndDrop
jest.mock('../useDragAndDrop', () => ({
  useDragAndDrop: jest.fn(),
}));

describe('useFileViewCommon', () => {
  const mockDragHandlers = {
    handleDragStart: jest.fn(),
    handleDragEnd: jest.fn(),
    handleDragOver: jest.fn(),
    handleDragLeave: jest.fn(),
    handleDrop: jest.fn(),
    draggedFile: null,
    dropTarget: null,
  };

  const defaultProps = {
    onFileDrop: jest.fn(),
    selectionMode: false,
    selectedFiles: new Set(),
    onFileCheck: jest.fn(),
    processingMap: new Map(),
    theme: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useDragAndDropModule.useDragAndDrop.mockReturnValue(mockDragHandlers);
  });

  describe('initialization', () => {
    it('should initialize with all required functions', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));

      expect(result.current).toHaveProperty('getFileState');
      expect(result.current).toHaveProperty('handleFileCheck');
      expect(result.current).toHaveProperty('isSelected');
      expect(result.current).toHaveProperty('getDragHandlers');
      expect(result.current).toHaveProperty('getDropHandlers');
      expect(typeof result.current.getFileState).toBe('function');
      expect(typeof result.current.handleFileCheck).toBe('function');
      expect(typeof result.current.isSelected).toBe('function');
    });

    it('should spread drag and drop handlers', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));

      expect(result.current.handleDragStart).toBe(mockDragHandlers.handleDragStart);
      expect(result.current.handleDragEnd).toBe(mockDragHandlers.handleDragEnd);
      expect(result.current.handleDragOver).toBe(mockDragHandlers.handleDragOver);
      expect(result.current.handleDragLeave).toBe(mockDragHandlers.handleDragLeave);
      expect(result.current.handleDrop).toBe(mockDragHandlers.handleDrop);
    });
  });

  describe('getFileState', () => {
    it('should return file state', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt', type: 'file' };

      const state = result.current.getFileState(file);

      expect(state).toHaveProperty('isSelected');
      expect(state).toHaveProperty('isDisabled');
      expect(state).toHaveProperty('isProcessing');
    });

    it('should reflect selection state', () => {
      const selectedFiles = new Set(['/selected.txt']);
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectionMode: true, selectedFiles })
      );

      const selectedFile = { path: '/selected.txt', type: 'file' };
      const unselectedFile = { path: '/other.txt', type: 'file' };

      expect(result.current.getFileState(selectedFile).isSelected).toBe(true);
      expect(result.current.getFileState(unselectedFile).isSelected).toBe(false);
    });
  });

  describe('handleFileCheck', () => {
    it('should call onFileCheck callback', () => {
      const onFileCheck = jest.fn();
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, onFileCheck })
      );

      const file = { path: '/test.txt' };
      const event = { stopPropagation: jest.fn() };

      act(() => {
        result.current.handleFileCheck(file, true, event);
      });

      expect(onFileCheck).toHaveBeenCalledWith(file, true);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should work without event', () => {
      const onFileCheck = jest.fn();
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, onFileCheck })
      );

      const file = { path: '/test.txt' };

      act(() => {
        result.current.handleFileCheck(file, false);
      });

      expect(onFileCheck).toHaveBeenCalledWith(file, false);
    });

    it('should handle missing onFileCheck', () => {
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, onFileCheck: undefined })
      );

      const file = { path: '/test.txt' };

      expect(() => {
        act(() => {
          result.current.handleFileCheck(file, true);
        });
      }).not.toThrow();
    });
  });

  describe('isSelected', () => {
    it('should return true for selected files', () => {
      const selectedFiles = new Set(['/selected.txt']);
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectedFiles })
      );

      const file = { path: '/selected.txt' };
      expect(result.current.isSelected(file)).toBe(true);
    });

    it('should return false for unselected files', () => {
      const selectedFiles = new Set(['/other.txt']);
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectedFiles })
      );

      const file = { path: '/test.txt' };
      expect(result.current.isSelected(file)).toBe(false);
    });

    it('should handle null selectedFiles', () => {
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectedFiles: null })
      );

      const file = { path: '/test.txt' };
      expect(result.current.isSelected(file)).toBeFalsy();
    });
  });

  describe('getDragHandlers', () => {
    it('should return drag handlers when not disabled', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };

      const handlers = result.current.getDragHandlers(file, false);

      expect(handlers.draggable).toBe(true);
      expect(handlers.onDragStart).toBeDefined();
      expect(handlers.onDragEnd).toBeDefined();
    });

    it('should disable drag when in selection mode', () => {
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectionMode: true })
      );
      const file = { path: '/test.txt' };

      const handlers = result.current.getDragHandlers(file, false);

      expect(handlers.draggable).toBe(false);
      expect(handlers.onDragStart).toBeUndefined();
      expect(handlers.onDragEnd).toBeUndefined();
    });

    it('should disable drag when file is disabled', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };

      const handlers = result.current.getDragHandlers(file, true);

      expect(handlers.draggable).toBe(false);
      expect(handlers.onDragStart).toBeUndefined();
    });

    it('should call dragAndDrop handlers when dragging', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };
      const handlers = result.current.getDragHandlers(file, false);

      const mockEvent = {};
      handlers.onDragStart(mockEvent);

      expect(mockDragHandlers.handleDragStart).toHaveBeenCalledWith(mockEvent, file);
    });
  });

  describe('getDropHandlers', () => {
    it('should return drop handlers when not disabled', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };

      const handlers = result.current.getDropHandlers(file, false);

      expect(handlers.onDragOver).toBeDefined();
      expect(handlers.onDragLeave).toBeDefined();
      expect(handlers.onDrop).toBeDefined();
    });

    it('should disable drop when in selection mode', () => {
      const { result } = renderHook(() =>
        useFileViewCommon({ ...defaultProps, selectionMode: true })
      );
      const file = { path: '/test.txt' };

      const handlers = result.current.getDropHandlers(file, false);

      expect(handlers.onDragOver).toBeUndefined();
      expect(handlers.onDragLeave).toBeUndefined();
      expect(handlers.onDrop).toBeUndefined();
    });

    it('should disable drop when file is disabled', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };

      const handlers = result.current.getDropHandlers(file, true);

      expect(handlers.onDragOver).toBeUndefined();
    });

    it('should call dragAndDrop handlers when dropping', () => {
      const { result } = renderHook(() => useFileViewCommon(defaultProps));
      const file = { path: '/test.txt' };
      const handlers = result.current.getDropHandlers(file, false);

      const mockEvent = {};
      handlers.onDragOver(mockEvent);
      handlers.onDrop(mockEvent);

      expect(mockDragHandlers.handleDragOver).toHaveBeenCalledWith(mockEvent, file);
      expect(mockDragHandlers.handleDrop).toHaveBeenCalledWith(mockEvent, file);
    });
  });

  describe('memoization', () => {
    it('should memoize getFileState based on dependencies', () => {
      const { result, rerender } = renderHook(
        (props) => useFileViewCommon(props),
        { initialProps: defaultProps }
      );

      const getFileState1 = result.current.getFileState;

      // Rerender with same props
      rerender(defaultProps);
      expect(result.current.getFileState).toBe(getFileState1);

      // Rerender with different selectionMode
      rerender({ ...defaultProps, selectionMode: true });
      expect(result.current.getFileState).not.toBe(getFileState1);
    });
  });
});

