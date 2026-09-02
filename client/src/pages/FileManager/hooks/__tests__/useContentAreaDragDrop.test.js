/**
 * useContentAreaDragDrop tests.
 * @see docs/spec/client/pages/FileManager/hooks/useContentAreaDragDrop.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useContentAreaDragDrop } from '../useContentAreaDragDrop';

function createMockEvent(overrides = {}) {
  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    target: { closest: () => null },
    currentTarget: { contains: () => false },
    relatedTarget: null,
    dataTransfer: { types: [], getData: () => '' },
    ...overrides,
  };
}

function createDefaultOptions(overrides = {}) {
  return {
    isMobile: false,
    selectionMode: false,
    hasWritePermission: true,
    isShareLinkMode: false,
    currentNodeId: 10,
    contentAreaDraggedNodeId: null,
    contentAreaDraggedParentNodeId: null,
    setContentAreaDraggedNodeId: jest.fn(),
    setContentAreaDragType: jest.fn(),
    handleInternalFileDrop: jest.fn(),
    handleExplorerDrop: jest.fn(),
    handleFileAreaDragEnter: jest.fn(),
    handleFileAreaDragOver: jest.fn(),
    handleFileAreaDragLeave: jest.fn(),
    handleFileAreaDrop: jest.fn(),
    resetFileAreaDrag: jest.fn(),
    ...overrides,
  };
}

describe('useContentAreaDragDrop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns all four content-area handlers', () => {
    const { result } = renderHook(() => useContentAreaDragDrop(createDefaultOptions()));

    expect(typeof result.current.handleContentAreaDragEnter).toBe('function');
    expect(typeof result.current.handleContentAreaDragOver).toBe('function');
    expect(typeof result.current.handleContentAreaDragLeave).toBe('function');
    expect(typeof result.current.handleContentAreaDrop).toBe('function');
  });

  describe('guards: when isMobile, selectionMode, or !hasWritePermission', () => {
    it('does not call any delegate when isMobile is true', () => {
      const opts = createDefaultOptions({ isMobile: true });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['Files'] } });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
        result.current.handleContentAreaDragOver(e);
        result.current.handleContentAreaDragLeave(e);
        result.current.handleContentAreaDrop(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragEnter).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragOver).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragLeave).not.toHaveBeenCalled();
      expect(opts.handleInternalFileDrop).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDrop).not.toHaveBeenCalled();
    });

    it('does not call any delegate when selectionMode is true', () => {
      const opts = createDefaultOptions({ selectionMode: true });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['Files'] } });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
        result.current.handleContentAreaDragOver(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragEnter).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragOver).not.toHaveBeenCalled();
    });

    it('does not call any delegate when hasWritePermission is false', () => {
      const opts = createDefaultOptions({ hasWritePermission: false });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['Files'] } });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
        result.current.handleContentAreaDragOver(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragEnter).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragOver).not.toHaveBeenCalled();
    });
  });

  describe('same-parent skip', () => {
    it('does not call delegates when internal drag is within the same folder (parentNodeId === currentNodeId)', () => {
      const opts = createDefaultOptions({
        currentNodeId: 10,
        contentAreaDraggedNodeId: 42,
        contentAreaDraggedParentNodeId: 10,
      });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['text/plain'] } });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
        result.current.handleContentAreaDragOver(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragEnter).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragOver).not.toHaveBeenCalled();
    });
  });

  describe('data-file-path skip', () => {
    it('does not call setContentAreaDragType or handleFileAreaDragEnter when target is inside data-file-path', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        target: { closest: () => ({}) },
        dataTransfer: { types: ['Files'] },
      });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragEnter).not.toHaveBeenCalled();
    });

    it('calls handleFileAreaDragLeave and returns on DragOver when target is inside data-file-path', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        target: { closest: () => ({}) },
        dataTransfer: { types: ['Files'] },
      });

      act(() => {
        result.current.handleContentAreaDragOver(e);
      });

      expect(opts.handleFileAreaDragLeave).toHaveBeenCalledWith(e);
      expect(opts.handleFileAreaDragOver).not.toHaveBeenCalled();
    });
  });

  describe('external drag (Files)', () => {
    it('DragEnter sets type to external and calls handleFileAreaDragEnter', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['Files'] } });

      act(() => {
        result.current.handleContentAreaDragEnter(e);
      });

      expect(opts.setContentAreaDragType).toHaveBeenCalledWith('external');
      expect(opts.handleFileAreaDragEnter).toHaveBeenCalledWith(e);
    });

    it('DragOver calls handleFileAreaDragOver', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({ dataTransfer: { types: ['Files'] } });

      act(() => {
        result.current.handleContentAreaDragOver(e);
      });

      expect(opts.handleFileAreaDragOver).toHaveBeenCalledWith(e);
    });

    it('Drop clears state and calls handleFileAreaDrop with currentNodeId and handleExplorerDrop', () => {
      const opts = createDefaultOptions({ currentNodeId: 10 });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: { types: ['Files'], getData: () => '' },
      });

      act(() => {
        result.current.handleContentAreaDrop(e);
      });

      expect(opts.setContentAreaDraggedNodeId).toHaveBeenCalledWith(null);
      expect(opts.setContentAreaDragType).toHaveBeenCalledWith(null);
      expect(opts.handleFileAreaDrop).toHaveBeenCalledWith(e, 10, opts.handleExplorerDrop);
      expect(opts.handleInternalFileDrop).not.toHaveBeenCalled();
    });
  });

  describe('internal drag (text/plain = nodeId)', () => {
    it('Drop clears state, calls handleInternalFileDrop(Number(text), currentNodeId) and resetFileAreaDrag', () => {
      const opts = createDefaultOptions({
        currentNodeId: 10,
        contentAreaDraggedNodeId: 42,
        contentAreaDraggedParentNodeId: 5,
      });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: {
          types: ['text/plain'],
          getData: (t) => (t === 'text/plain' ? '42' : ''),
        },
      });

      act(() => {
        result.current.handleContentAreaDrop(e);
      });

      expect(opts.setContentAreaDraggedNodeId).toHaveBeenCalledWith(null);
      expect(opts.setContentAreaDragType).toHaveBeenCalledWith(null);
      expect(opts.handleInternalFileDrop).toHaveBeenCalledWith(42, 10);
      expect(opts.resetFileAreaDrag).toHaveBeenCalled();
      expect(opts.handleFileAreaDrop).not.toHaveBeenCalled();
    });

    it('does not call handleInternalFileDrop when internal drop is within the same folder (parentNodeId === currentNodeId)', () => {
      const opts = createDefaultOptions({
        currentNodeId: 10,
        contentAreaDraggedNodeId: 42,
        contentAreaDraggedParentNodeId: 10,
      });
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: {
          types: ['text/plain'],
          getData: (t) => (t === 'text/plain' ? '42' : ''),
        },
      });

      act(() => {
        result.current.handleContentAreaDrop(e);
      });

      expect(opts.setContentAreaDraggedNodeId).toHaveBeenCalledWith(null);
      expect(opts.setContentAreaDragType).toHaveBeenCalledWith(null);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopPropagation).toHaveBeenCalled();
      expect(opts.resetFileAreaDrag).toHaveBeenCalled();
      expect(opts.handleInternalFileDrop).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDrop).not.toHaveBeenCalled();
    });

    it('Drop works when resetFileAreaDrag is omitted', () => {
      const opts = createDefaultOptions({
        currentNodeId: 10,
        contentAreaDraggedNodeId: 7,
        contentAreaDraggedParentNodeId: 3,
      });
      delete opts.resetFileAreaDrag;
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: {
          types: ['text/plain'],
          getData: () => '7',
        },
      });

      expect(() => {
        act(() => {
          result.current.handleContentAreaDrop(e);
        });
      }).not.toThrow();
      expect(opts.handleInternalFileDrop).toHaveBeenCalledWith(7, 10);
    });
  });

  describe('DragLeave', () => {
    it('clears drag type only when leaving content area (relatedTarget not contained)', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: { types: ['Files'] },
        currentTarget: { contains: () => false },
        relatedTarget: null,
      });

      act(() => {
        result.current.handleContentAreaDragLeave(e);
      });

      expect(opts.setContentAreaDragType).toHaveBeenCalledWith(null);
      expect(opts.handleFileAreaDragLeave).toHaveBeenCalledWith(e);
    });

    it('does not clear drag type when relatedTarget is inside currentTarget', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useContentAreaDragDrop(opts));
      const e = createMockEvent({
        dataTransfer: { types: ['Files'] },
        currentTarget: { contains: () => true },
        relatedTarget: {},
      });

      act(() => {
        result.current.handleContentAreaDragLeave(e);
      });

      expect(opts.setContentAreaDragType).not.toHaveBeenCalled();
      expect(opts.handleFileAreaDragLeave).toHaveBeenCalledWith(e);
    });
  });
});
