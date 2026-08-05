/**
 * useExplorerSession tests.
 * @see docs/spec/client/hooks/useExplorerSession.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('../../../../utils/fileUtils', () => ({
  sortFiles: jest.fn((files) => files),
}));

jest.mock('../../../../utils/localStorage', () => ({
  getSortMode: jest.fn(() => 'name_desc'),
  getViewMode: jest.fn(() => 'detail'),
  setViewMode: jest.fn(),
  setSortMode: jest.fn(),
}));

jest.mock('../../../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: jest.fn(),
}));

import { sortFiles } from '../../../../utils/fileUtils';
import { getSortMode, getViewMode, setViewMode, setSortMode } from '../../../../utils/localStorage';
import { useInfiniteScroll } from '../../../../hooks/useInfiniteScroll';
import { useExplorerSession } from '../useExplorerSession';

const EMPTY_FILES = [];

describe('useExplorerSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSortMode.mockReturnValue('name_desc');
    getViewMode.mockReturnValue('detail');
    sortFiles.mockImplementation((files) => files);
    useInfiniteScroll.mockImplementation((files) => ({
      displayedFiles: files,
      loadMoreRef: { current: null },
      hasMore: false,
    }));
  });

  it('filters files by case-insensitive name matching', () => {
    const files = [
      { path: '/docs/Report.txt', basename: 'Report.txt' },
      { path: '/docs/photo.jpg', basename: 'photo.jpg' },
    ];

    const { result } = renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files,
      isMobile: false,
    }));

    act(() => {
      result.current.setSearchQuery('report');
    });

    expect(result.current.displayedFiles).toEqual([
      { path: '/docs/Report.txt', basename: 'Report.txt' },
    ]);
  });

  it('changes sessionKey when currentPath changes so the shell can reset selection', () => {
    const { result, rerender } = renderHook(
      ({ currentPath }) => useExplorerSession({
        currentPath,
        files: EMPTY_FILES,
        isMobile: false,
      }),
      { initialProps: { currentPath: '/docs' } }
    );

    expect(result.current.sessionKey).toBe('/docs');

    rerender({ currentPath: '/images' });

    expect(result.current.sessionKey).toBe('/images');
  });

  it('forces detail mode back to list on mobile to preserve current UX', () => {
    const { result } = renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files: EMPTY_FILES,
      isMobile: true,
    }));

    expect(result.current.viewMode).toBe('list');
  });

  it('persists current view and sort mode through the existing localStorage policy', () => {
    renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files: EMPTY_FILES,
      isMobile: false,
    }));

    expect(setViewMode).toHaveBeenCalledWith('detail');
    expect(setSortMode).toHaveBeenCalledWith('name_desc');
    expect(sortFiles).toHaveBeenCalled();
  });

  it('owns sort mode internally without external injection', () => {
    const { result } = renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files: EMPTY_FILES,
      isMobile: false,
    }));

    expect(result.current.sortMode).toBe('name_desc');

    act(() => {
      result.current.setSortMode('modified');
    });

    expect(result.current.sortMode).toBe('modified');
    expect(setSortMode).toHaveBeenLastCalledWith('modified');
  });

  it('handleThumbnailsLoaded merges thumbnailUrl keyed by file.nodeId', () => {
    const files = [
      { nodeId: 1, path: '/docs/a.jpg', basename: 'a.jpg', type: 'file', mime: 'image/jpeg' },
      { nodeId: 2, path: '/docs/b.jpg', basename: 'b.jpg', type: 'file', mime: 'image/jpeg' },
    ];

    const { result } = renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files,
      isMobile: false,
    }));

    act(() => {
      result.current.handleThumbnailsLoaded(new Map([[1, 'http://thumb/a.jpg']]));
    });

    const updated = result.current.files;
    expect(updated.find((f) => f.nodeId === 1).thumbnailUrl).toBe('http://thumb/a.jpg');
    expect(updated.find((f) => f.nodeId === 2).thumbnailUrl).toBeUndefined();
  });
});
