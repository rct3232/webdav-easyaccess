/**
 * useInfiniteScroll tests.
 * @see docs/spec/client/hooks/useInfiniteScroll.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useInfiniteScroll } from '../useInfiniteScroll';

const mockCallbacks = [];

beforeAll(() => {
  global.IntersectionObserver = class MockIO {
    constructor(callback) {
      mockCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

beforeEach(() => {
  mockCallbacks.length = 0;
});

describe('useInfiniteScroll', () => {
  it('initial displayedFiles length is min(initialCount, files.length)', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `/f${i}.txt`,
      basename: `f${i}.txt`,
    }));
    const { result } = renderHook(() => useInfiniteScroll(files, { initialCount: 50 }));

    expect(result.current.displayedFiles).toHaveLength(50);
    expect(result.current.displayedCount).toBe(50);
    expect(result.current.totalCount).toBe(100);
    expect(result.current.hasMore).toBe(true);
  });

  it('files.length < initialCount returns all files', () => {
    const files = [
      { path: '/a.txt', basename: 'a.txt' },
      { path: '/b.txt', basename: 'b.txt' },
    ];
    const { result } = renderHook(() => useInfiniteScroll(files, { initialCount: 50 }));

    expect(result.current.displayedFiles).toHaveLength(2);
    expect(result.current.displayedFiles).toEqual(files);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMoreRef is a ref object', () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ path: `/f${i}.txt` }));
    const { result } = renderHook(() => useInfiniteScroll(files, { initialCount: 50 }));

    expect(result.current.loadMoreRef).toHaveProperty('current');
  });

  it('intersecting triggers loadMore and increases displayedCount', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `/f${i}.txt`,
      basename: `f${i}.txt`,
    }));
    const { result } = renderHook(() =>
      useInfiniteScroll(files, { initialCount: 50, incrementCount: 25 })
    );

    expect(result.current.displayedCount).toBe(50);

    act(() => {
      const cb = mockCallbacks[mockCallbacks.length - 1];
      cb([{ isIntersecting: true }]);
    });

    expect(result.current.displayedCount).toBe(75);
    expect(result.current.displayedFiles).toHaveLength(75);
  });

  it('hasMore true when displayCount < files.length', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `/f${i}.txt` }));
    const { result } = renderHook(() => useInfiniteScroll(files, { initialCount: 50 }));

    expect(result.current.hasMore).toBe(true);

    act(() => {
      const cb = mockCallbacks[mockCallbacks.length - 1];
      for (let i = 0; i < 2; i++) {
        cb([{ isIntersecting: true }]);
      }
    });

    expect(result.current.displayedCount).toBe(100);
    expect(result.current.hasMore).toBe(false);
  });

  it('reset restores displayCount to initialCount', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `/f${i}.txt` }));
    const { result } = renderHook(() =>
      useInfiniteScroll(files, { initialCount: 50, incrementCount: 25 })
    );

    act(() => {
      const cb = mockCallbacks[mockCallbacks.length - 1];
      cb([{ isIntersecting: true }]);
    });
    expect(result.current.displayedCount).toBe(75);

    act(() => {
      result.current.reset();
    });

    expect(result.current.displayedCount).toBe(50);
  });

  it('files change resets displayCount', () => {
    const files1 = Array.from({ length: 100 }, (_, i) => ({ path: `/f${i}.txt` }));
    const { result, rerender } = renderHook(
      ({ files }) => useInfiniteScroll(files, { initialCount: 50 }),
      { initialProps: { files: files1 } }
    );

    act(() => {
      const cb = mockCallbacks[mockCallbacks.length - 1];
      cb([{ isIntersecting: true }]);
    });
    expect(result.current.displayedCount).toBe(100);

    const files2 = Array.from({ length: 80 }, (_, i) => ({ path: `/g${i}.txt` }));
    rerender({ files: files2 });

    expect(result.current.displayedCount).toBe(50);
    expect(result.current.totalCount).toBe(80);
  });
});
