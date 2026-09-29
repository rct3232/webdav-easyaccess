/**
 * useExplorerSession tests.
 * @see docs/spec/client/hooks/useExplorerSession.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';

import { sortFiles } from '../../../../utils/fileUtils';
import {
  getSortMode,
  getViewMode,
  setViewMode,
  setSortMode,
  getCollectionMemberViewMode,
  setCollectionMemberViewMode,
  getLikedViewMode,
  setLikedViewMode,
} from '../../../../utils/localStorage';
import { useInfiniteScroll } from '../../../../hooks/useInfiniteScroll';
import { useExplorerSession } from '../useExplorerSession';

jest.mock('../../../../utils/fileUtils', () => ({
  sortFiles: jest.fn((files) => files),
}));

jest.mock('../../../../utils/localStorage', () => ({
  getSortMode: jest.fn(() => 'name_desc'),
  getViewMode: jest.fn(() => 'detail'),
  setViewMode: jest.fn(),
  setSortMode: jest.fn(),
  getCollectionMemberViewMode: jest.fn(() => 'grid'),
  setCollectionMemberViewMode: jest.fn(),
  getLikedViewMode: jest.fn(() => 'grid'),
  setLikedViewMode: jest.fn(),
}));

jest.mock('../../../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: jest.fn(),
}));

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

    const { result } = renderHook(() =>
      useExplorerSession({
        currentNodeId: 5,
        files,
        isMobile: false,
      })
    );

    act(() => {
      result.current.setSearchQuery('report');
    });

    expect(result.current.displayedFiles).toEqual([
      { nodeId: 5, path: '/docs/Report.txt', basename: 'Report.txt' },
    ]);
  });

  it('changes sessionKey when currentNodeId changes so the shell can reset selection', () => {
    const { result, rerender } = renderHook(
      ({ currentNodeId }) =>
        useExplorerSession({
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
    const { result } = renderHook(() =>
      useExplorerSession({
        currentNodeId: null,
        files: EMPTY_FILES,
        isMobile: false,
      })
    );

    expect(result.current.sessionKey).toBe('node:root');
  });

  it('forces detail mode back to list on mobile to preserve current UX', () => {
    const { result } = renderHook(() =>
      useExplorerSession({
        currentNodeId: 5,
        files: EMPTY_FILES,
        isMobile: true,
      })
    );

    expect(result.current.viewMode).toBe('list');
  });

  it('persists current view and sort mode through the existing localStorage policy', () => {
    renderHook(() =>
      useExplorerSession({
        currentNodeId: 5,
        files: EMPTY_FILES,
        isMobile: false,
      })
    );

    expect(setViewMode).toHaveBeenCalledWith('detail');
    expect(setSortMode).toHaveBeenCalledWith('name_desc');
    expect(sortFiles).toHaveBeenCalled();
  });

  it('owns sort mode internally without external injection', () => {
    const { result } = renderHook(() =>
      useExplorerSession({
        currentNodeId: 5,
        files: EMPTY_FILES,
        isMobile: false,
      })
    );

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

    const { result } = renderHook(() =>
      useExplorerSession({
        currentNodeId: 5,
        files,
        isMobile: false,
      })
    );

    act(() => {
      result.current.handleThumbnailsLoaded(new Map([[1, 'http://thumb/a.jpg']]));
    });

    const updated = result.current.files;
    expect(updated.find((f) => f.nodeId === 1).thumbnailUrl).toBe('http://thumb/a.jpg');
    expect(updated.find((f) => f.nodeId === 2).thumbnailUrl).toBeUndefined();
  });

  // -- §3 AI-platform boundary — server-search state handoff (D1) ------------

  it('exposes a stable onSubmitQuery callback delegating to the shell wiring', () => {
    const submitSearch = jest.fn();
    const { result, rerender } = renderHook(() =>
      useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES, onSubmitQuery: submitSearch })
    );

    const first = result.current.onSubmitQuery;
    rerender();
    expect(result.current.onSubmitQuery).toBe(first);

    act(() => {
      result.current.onSubmitQuery('movie');
    });
    expect(submitSearch).toHaveBeenCalledWith('movie');
  });

  it('keeps calling the LATEST shell wiring while identity stays stable', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(
      ({ handler }) =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES, onSubmitQuery: handler }),
      { initialProps: { handler: first } }
    );

    const identity = result.current.onSubmitQuery;
    rerender({ handler: second });
    expect(result.current.onSubmitQuery).toBe(identity);

    act(() => {
      result.current.onSubmitQuery('sig');
    });
    expect(second).toHaveBeenCalledWith('sig');
    expect(first).not.toHaveBeenCalled();
  });

  it('does not reset searchQuery across results-mode entry/exit (input text shared)', () => {
    const { result } = renderHook(() =>
      useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES })
    );

    act(() => {
      result.current.setSearchQuery('movie');
    });
    // results-mode entry/exit is host state; the session searchQuery survives it
    expect(result.current.searchQuery).toBe('movie');
    expect(result.current.filteredFiles).toEqual([]);
  });

  describe('memberViewMode (P-4 per-surface members key)', () => {
    beforeEach(() => {
      getCollectionMemberViewMode.mockReturnValue('grid');
    });

    it('initializes from the collectionMemberViewMode helper (per-surface, independent of viewMode)', () => {
      getViewMode.mockReturnValue('detail');
      getCollectionMemberViewMode.mockReturnValue('list');

      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES })
      );

      expect(getCollectionMemberViewMode).toHaveBeenCalledTimes(1);
      expect(result.current.memberViewMode).toBe('list');
      expect(result.current.viewMode).toBe('detail');
    });

    it('setMemberViewMode updates the member state and persists through the member helper only', () => {
      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES })
      );

      act(() => {
        result.current.setMemberViewMode('list');
      });

      expect(result.current.memberViewMode).toBe('list');
      expect(setCollectionMemberViewMode).toHaveBeenCalledWith('list');
      // the file view mode/key never sees the member dispatch
      expect(result.current.viewMode).toBe('detail');
      expect(setViewMode).not.toHaveBeenCalledWith('list');
    });

    it('mobile detail→list restriction applies to the member key too', () => {
      getCollectionMemberViewMode.mockReturnValue('detail');

      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES, isMobile: true })
      );

      expect(result.current.memberViewMode).toBe('list');
      expect(setCollectionMemberViewMode).toHaveBeenCalledWith('list');
    });
  });

  describe('likedViewMode (P-5 per-surface Likes key)', () => {
    beforeEach(() => {
      getLikedViewMode.mockReturnValue('grid');
    });

    it('initializes from the likedViewMode helper, independent of viewMode/memberViewMode', () => {
      getViewMode.mockReturnValue('detail');
      getCollectionMemberViewMode.mockReturnValue('list');
      getLikedViewMode.mockReturnValue('detail');

      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES })
      );

      expect(getLikedViewMode).toHaveBeenCalledTimes(1);
      expect(result.current.likedViewMode).toBe('detail');
      expect(result.current.viewMode).toBe('detail');
      expect(result.current.memberViewMode).toBe('list');
    });

    it('setLikedViewMode persists through the LIKES helper only', () => {
      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES })
      );

      act(() => {
        result.current.setLikedViewMode('list');
      });

      expect(result.current.likedViewMode).toBe('list');
      expect(setLikedViewMode).toHaveBeenCalledWith('list');
      // neither other key ever sees the likes dispatch
      expect(setCollectionMemberViewMode).not.toHaveBeenCalledWith('list');
      expect(setViewMode).not.toHaveBeenCalledWith('list');
    });

    it('mobile detail→list restriction applies to the likes key too', () => {
      getLikedViewMode.mockReturnValue('detail');

      const { result } = renderHook(() =>
        useExplorerSession({ currentNodeId: 5, files: EMPTY_FILES, isMobile: true })
      );

      expect(result.current.likedViewMode).toBe('list');
      expect(setLikedViewMode).toHaveBeenCalledWith('list');
    });
  });
});
