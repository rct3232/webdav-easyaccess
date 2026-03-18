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
  getViewMode: jest.fn(() => 'detail'),
  setViewMode: jest.fn(),
  setSortMode: jest.fn(),
}));

jest.mock('../../../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: jest.fn(),
}));

import { sortFiles } from '../../../../utils/fileUtils';
import { getViewMode, setViewMode, setSortMode } from '../../../../utils/localStorage';
import { useInfiniteScroll } from '../../../../hooks/useInfiniteScroll';
import { useExplorerSession } from '../useExplorerSession';

const EMPTY_FILES = [];

describe('useExplorerSession', () => {
  let setSortModeMock;

  beforeEach(() => {
    jest.clearAllMocks();
    setSortModeMock = jest.fn();
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
      sortMode: 'name',
      setSortMode: setSortModeMock,
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
        sortMode: 'name',
        setSortMode: setSortModeMock,
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
      sortMode: 'name',
      setSortMode: setSortModeMock,
      isMobile: true,
    }));

    expect(result.current.viewMode).toBe('list');
  });

  it('persists current view and sort mode through the existing localStorage policy', () => {
    renderHook(() => useExplorerSession({
      currentPath: '/docs',
      files: EMPTY_FILES,
      sortMode: 'modified',
      setSortMode: setSortModeMock,
      isMobile: false,
    }));

    expect(setViewMode).toHaveBeenCalledWith('detail');
    expect(setSortMode).toHaveBeenCalledWith('modified');
    expect(sortFiles).toHaveBeenCalled();
  });
});
