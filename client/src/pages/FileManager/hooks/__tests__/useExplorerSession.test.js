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
      { nodeId: 5, path: '/docs/Report.txt', basename: 'Report.txt' },
      { nodeId: 6, path: '/docs/photo.jpg', basename: 'photo.jpg' },
    ];

    const { result } = renderHook(() => useExplorerSession({
      currentNodeId: 5,
      files,
      isMobile: false,
    }));

    act(() => {
      result.current.setSearchQuery('report');
    });

    expect(result.current.displayedFiles).toEqual([
      { nodeId: 5, path: '/docs/Report.txt', basename: 'Report.txt' },
    ]);
  });

  it('changes sessionKey when currentNodeId changes so the shell can reset selection', () => {
    const { result, rerender } = renderHook(
      ({ currentNodeId }) => useExplorerSession({
        currentNodeId,
        files: EMPTY_FILES,
        isMobile: false,
      }),
      { initialProps: { currentNodeId: 5 } }
    );

    expect(result.current.sessionKey).toBe('node:5');

    rerender({ currentNodeId: 6 });

    expect(result.current.sessionKey).toBe('node:6');
  });

  it('derives distinct session keys for the virtual-root views', () => {
    const { result: recentResult, rerender: rerenderRecent } = renderHook(
      ({ view }) => useExplorerSession({ currentNodeId: null, view, files: EMPTY_FILES }),
      { initialProps: { view: 'recent' } }
    );
    expect(recentResult.current.sessionKey).toBe('view:recent');

    rerenderRecent({ view: 'shared' });
    expect(recentResult.current.sessionKey).toBe('view:shared');
  });

  it('uses node:root as the session key for root-level listings', () => {
    const { result } = renderHook(() => useExplorerSession({
      currentNodeId: null,
      files: EMPTY_FILES,
      isMobile: false,
    }));

    expect(result.current.sessionKey).toBe('node:root');
  });

  it('forces detail mode back to list on mobile to preserve current UX', () => {
    const { result } = renderHook(() => useExplorerSession({
      currentNodeId: 5,
      files: EMPTY_FILES,
      isMobile: true,
    }));

    expect(result.current.viewMode).toBe('list');
  });

  it('persists current view and sort mode through the existing localStorage policy', () => {
    renderHook(() => useExplorerSession({
      currentNodeId: 5,
      files: EMPTY_FILES,
      isMobile: false,
    }));

    expect(setViewMode).toHaveBeenCalledWith('detail');
    expect(setSortMode).toHaveBeenCalledWith('name_desc');
    expect(sortFiles).toHaveBeenCalled();
  });

  it('owns sort mode internally without external injection', () => {
    const { result } = renderHook(() => useExplorerSession({
      currentNodeId: 5,
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
      currentNodeId: 5,
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
