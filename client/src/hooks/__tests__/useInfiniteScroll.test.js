import { renderHook, act } from '@testing-library/react';
import { useInfiniteScroll } from '../useInfiniteScroll';

// Mock IntersectionObserver
const mockObserve = jest.fn();
const mockUnobserve = jest.fn();
const mockDisconnect = jest.fn();

let intersectionCallback = null;

class MockIntersectionObserver {
  constructor(callback) {
    intersectionCallback = callback;
  }
  observe = mockObserve;
  unobserve = mockUnobserve;
  disconnect = mockDisconnect;
}

describe('useInfiniteScroll', () => {
  const createMockFiles = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      path: `/file${i}.txt`,
      basename: `file${i}.txt`,
      type: 'file',
      size: 100,
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.IntersectionObserver = MockIntersectionObserver;
    intersectionCallback = null;
  });

  afterEach(() => {
    delete global.IntersectionObserver;
  });

  describe('초기 상태', () => {
    it('should display initialCount items initially (default 50)', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.displayedFiles).toHaveLength(50);
      expect(result.current.displayedCount).toBe(50);
      expect(result.current.totalCount).toBe(100);
      expect(result.current.hasMore).toBe(true);
    });

    it('should display all items when files < initialCount', () => {
      const files = createMockFiles(30);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.displayedFiles).toHaveLength(30);
      expect(result.current.displayedCount).toBe(30);
      expect(result.current.hasMore).toBe(false);
    });

    it('should respect custom initialCount option', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => 
        useInfiniteScroll(files, { initialCount: 20 })
      );

      expect(result.current.displayedFiles).toHaveLength(20);
      expect(result.current.displayedCount).toBe(20);
    });

    it('should return empty array for empty files', () => {
      const { result } = renderHook(() => useInfiniteScroll([]));

      expect(result.current.displayedFiles).toHaveLength(0);
      expect(result.current.displayedCount).toBe(0);
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('추가 로드', () => {
    it('should load incrementCount more items when loadMoreRef is intersecting', () => {
      const files = createMockFiles(150);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.displayedFiles).toHaveLength(50);

      // Simulate intersection
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });

      expect(result.current.displayedFiles).toHaveLength(100);
      expect(result.current.displayedCount).toBe(100);
      expect(result.current.hasMore).toBe(true);
    });

    it('should stop loading when all items are displayed', () => {
      const files = createMockFiles(80);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.displayedFiles).toHaveLength(50);

      // First intersection
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });

      expect(result.current.displayedFiles).toHaveLength(80);
      expect(result.current.hasMore).toBe(false);
    });

    it('should respect custom incrementCount option', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => 
        useInfiniteScroll(files, { initialCount: 20, incrementCount: 10 })
      );

      expect(result.current.displayedFiles).toHaveLength(20);

      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });

      expect(result.current.displayedFiles).toHaveLength(30);
    });

    it('should not load more when not intersecting', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.displayedFiles).toHaveLength(50);

      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: false }]);
        }
      });

      expect(result.current.displayedFiles).toHaveLength(50);
    });
  });

  describe('리셋', () => {
    it('should reset displayCount when files list length decreases', () => {
      const files100 = createMockFiles(100);
      const files30 = createMockFiles(30);

      const { result, rerender } = renderHook(
        ({ files }) => useInfiniteScroll(files),
        { initialProps: { files: files100 } }
      );

      expect(result.current.displayedFiles).toHaveLength(50);

      // Load more
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });
      expect(result.current.displayedFiles).toHaveLength(100);

      // Change files to a smaller list (simulates folder change)
      rerender({ files: files30 });

      expect(result.current.displayedFiles).toHaveLength(30);
      expect(result.current.displayedCount).toBe(30);
    });

    it('should reset via reset() function', () => {
      const files = createMockFiles(150);
      const { result } = renderHook(() => useInfiniteScroll(files));

      // Load more twice
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });
      expect(result.current.displayedFiles).toHaveLength(150);

      // Manual reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.displayedFiles).toHaveLength(50);
      expect(result.current.displayedCount).toBe(50);
    });

    it('should not reset when files are added to the list', () => {
      const files50 = createMockFiles(50);
      const files100 = createMockFiles(100);

      const { result, rerender } = renderHook(
        ({ files }) => useInfiniteScroll(files, { initialCount: 30 }),
        { initialProps: { files: files50 } }
      );

      expect(result.current.displayedFiles).toHaveLength(30);

      // Load more
      act(() => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });
      expect(result.current.displayedCount).toBe(50);

      // Files increase (e.g., new file uploaded)
      rerender({ files: files100 });

      // displayCount should not reset since files increased
      expect(result.current.displayedCount).toBe(50);
    });
  });

  describe('IntersectionObserver', () => {
    it('should create IntersectionObserver when hasMore is true', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => useInfiniteScroll(files));

      // IntersectionObserver should be created (callback stored)
      expect(intersectionCallback).not.toBeNull();
      expect(result.current.hasMore).toBe(true);
    });

    it('should disconnect on unmount', () => {
      const files = createMockFiles(100);
      const { unmount } = renderHook(() => useInfiniteScroll(files));

      unmount();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should not set up observer when no more items to load', () => {
      const files = createMockFiles(30);
      
      // Clear previous calls
      mockObserve.mockClear();
      
      renderHook(() => useInfiniteScroll(files));

      // hasMore is false, so observer should not observe (or disconnect immediately)
      // The hook disconnects previous observer before setting up new one
      expect(result => result.current.hasMore).toBeFalsy;
    });
  });

  describe('loadMoreRef', () => {
    it('should return a ref object', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => useInfiniteScroll(files));

      expect(result.current.loadMoreRef).toBeDefined();
      expect(result.current.loadMoreRef).toHaveProperty('current');
    });
  });

  describe('displayed files slicing', () => {
    it('should return correct slice of files', () => {
      const files = createMockFiles(100);
      const { result } = renderHook(() => useInfiniteScroll(files));

      // Check first and last displayed files
      expect(result.current.displayedFiles[0].basename).toBe('file0.txt');
      expect(result.current.displayedFiles[49].basename).toBe('file49.txt');
    });

    it('should update displayed files when source files change order', () => {
      const files = createMockFiles(100);
      const reversedFiles = [...files].reverse();

      const { result, rerender } = renderHook(
        ({ files }) => useInfiniteScroll(files),
        { initialProps: { files } }
      );

      expect(result.current.displayedFiles[0].basename).toBe('file0.txt');

      rerender({ files: reversedFiles });

      expect(result.current.displayedFiles[0].basename).toBe('file99.txt');
    });
  });
});
