/**
 * useSearchResults tests.
 * @see docs/spec/client/hooks/useSearchResults.md
 */
import { renderHook, act } from '@testing-library/react';

import { useSearchResults } from '../useSearchResults';
import * as recentQueriesStorage from '../../../../services/recentQueriesStorage';

jest.mock('../../../../services/recentQueriesStorage', () => ({
  loadRecentQueries: jest.fn(() => []),
  saveRecentQueries: jest.fn(),
  clearRecentQueries: jest.fn(),
}));

const SEARCH_RESPONSE = {
  name_matches: [
    { node_id: 11, name: 'Fun-MOVIE-notes.pdf' },
    { node_id: 12, name: 'movie-night.jpg' },
  ],
  result_ref: 'sr1.9f3c2a7e41b0d8c5',
  counts: { name: 2, semantic: 0, total: 2, name_truncated: false },
  semantic_available: false,
  semantic_unavailable_reason: 'serverErrors.ai.notConfigured',
};

const SESSION_FILES = [
  {
    nodeId: 1,
    name: 'movie-poster.png',
    basename: 'movie-poster.png',
    type: 'directory',
    path: '/docs/movie-poster.png',
  },
  {
    nodeId: 2,
    name: 'notes-movie.txt',
    basename: 'notes-movie.txt',
    type: 'file',
    path: '/docs/notes-movie.txt',
  },
  { nodeId: 3, name: 'other.txt', basename: 'other.txt', type: 'file', path: '/docs/other.txt' },
];

function createGateway(overrides = {}) {
  return {
    runSearch: jest.fn().mockResolvedValue(SEARCH_RESPONSE),
    loadNodesMetadata: jest.fn().mockResolvedValue([]),
    recordSearchClick: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderSearchHook({
  showError = jest.fn(),
  gateway = createGateway(),
  files = SESSION_FILES,
  sortMode = 'name_asc',
  liveText = '',
} = {}) {
  const utils = renderHook((props) => useSearchResults(props), {
    initialProps: { showError, gateway, files, sortMode, liveText },
  });
  return { ...utils, gateway, showError };
}

beforeEach(() => {
  jest.clearAllMocks();
  recentQueriesStorage.loadRecentQueries.mockReturnValue([]);
});

describe('useSearchResults mode machine', () => {
  it('starts in browse mode with empty zones and no chain', () => {
    const { result } = renderSearchHook();

    expect(result.current.mode).toBe('browse');
    expect(result.current.chain).toEqual([]);
    expect(result.current.zoneARows).toEqual([]);
    expect(result.current.zoneBRows).toEqual([]);
    expect(result.current.zoneCounts).toEqual({ zoneA: 0, zoneB: 0, zoneC: 0 });
  });

  it('enters pending while the submit is in flight, then results', async () => {
    let resolveSearch;
    const gateway = createGateway({
      runSearch: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveSearch = resolve;
          })
      ),
    });
    const { result } = renderSearchHook({ gateway });

    let submitted;
    act(() => {
      submitted = result.current.submitSearch('movie');
    });
    expect(result.current.mode).toBe('pending');

    await act(async () => {
      resolveSearch(SEARCH_RESPONSE);
      await submitted;
    });
    expect(result.current.mode).toBe('results');
  });

  it('ignores resubmits while a submit is in flight (single-flight)', async () => {
    const gateway = createGateway({
      runSearch: jest.fn(() => new Promise(() => {})),
    });
    const { result } = renderSearchHook({ gateway });

    act(() => {
      result.current.submitSearch('movie');
    });
    act(() => {
      result.current.submitSearch('movie again');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(gateway.runSearch).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe('pending');
  });

  it('submit from browse starts a new chain [term] with an intersect-name snapshot', async () => {
    const { result, gateway } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(gateway.runSearch).toHaveBeenCalledTimes(1);
    expect(gateway.runSearch).toHaveBeenCalledWith({ query: 'movie' }, expect.anything());
    expect(result.current.chain).toHaveLength(1);
    expect(result.current.chain[0].term).toBe('movie');
    expect(result.current.chain[0].op).toBe('intersect-name');
    expect(result.current.chain[0].inputTextAtCommit).toBe('movie');
    expect(result.current.zoneBRows.map((row) => row.nodeId)).toEqual([11, 12]);
  });

  it('guards the submit client-side: empty never calls the server, >200 maps queryTooLong', async () => {
    const { result, gateway, showError } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('   ');
    });
    expect(gateway.runSearch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.submitSearch('a'.repeat(201));
    });
    expect(gateway.runSearch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('serverErrors.search.queryTooLong');
  });

  it('an absorbed failure toasts search.fail and keeps the prior mode/chain intact', async () => {
    const gateway = createGateway();
    const { result, showError } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    gateway.runSearch.mockResolvedValueOnce(null);

    await act(async () => {
      await result.current.submitSearch('other');
    });

    expect(showError).toHaveBeenCalledWith('serverErrors.search.fail');
    expect(result.current.mode).toBe('results');
    expect(result.current.chain).toHaveLength(1);
    expect(result.current.chain[0].term).toBe('movie');
    expect(result.current.zoneBRows.map((row) => row.nodeId)).toEqual([11, 12]);
  });
});

describe('useSearchResults chain refinement + undo snapshots', () => {
  const refineGateway = () =>
    createGateway({
      runSearch: jest
        .fn()
        .mockResolvedValueOnce(SEARCH_RESPONSE)
        .mockResolvedValueOnce({
          name_matches: [{ node_id: 11, name: 'Fun-MOVIE-notes.pdf' }],
          result_ref: 'sr1.step2',
          counts: { name: 1, semantic: 0, total: 1, name_truncated: false },
          semantic_available: false,
        }),
    });

  it('step 2 intersects zoneB by id and recomputes zoneA over ALL committed terms', async () => {
    const gateway = refineGateway();
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    await act(async () => {
      await result.current.submitSearch('txt');
    });

    expect(result.current.chain.map((step) => step.term)).toEqual(['movie', 'txt']);
    expect(result.current.zoneBRows.map((row) => row.nodeId)).toEqual([11]);
    // zone A recomputed client-side: current-folder rows containing BOTH terms
    expect(Array.from(result.current.zoneAIds)).toEqual([2]);
    expect(gateway.runSearch).toHaveBeenCalledTimes(2); // zero re-fetch of earlier terms
    expect(gateway.runSearch).toHaveBeenLastCalledWith({ query: 'txt' }, expect.anything());
  });

  it('undoToStep restores the step snapshot with ZERO server calls', async () => {
    const gateway = refineGateway();
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    await act(async () => {
      await result.current.submitSearch('pdf');
    });
    const searchCalls = gateway.runSearch.mock.calls.length;
    const metadataCalls = gateway.loadNodesMetadata.mock.calls.length;

    act(() => {
      result.current.undoToStep(0);
    });

    expect(gateway.runSearch.mock.calls.length).toBe(searchCalls);
    expect(gateway.loadNodesMetadata.mock.calls.length).toBe(metadataCalls);
    expect(result.current.chain).toHaveLength(1);
    expect(result.current.zoneBRows.map((row) => row.nodeId)).toEqual([11, 12]);
    expect(result.current.zoneCounts.zoneB).toBe(2);
  });

  it('emptying zoneB through a refinement still commits the step (honest empty zone)', async () => {
    const gateway = createGateway({
      runSearch: jest
        .fn()
        .mockResolvedValueOnce(SEARCH_RESPONSE)
        .mockResolvedValueOnce({
          name_matches: [{ node_id: 99, name: 'unrelated.x' }],
          result_ref: 'sr1.step2',
          counts: { name: 1, semantic: 0, total: 1, name_truncated: false },
          semantic_available: false,
        }),
    });
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    await act(async () => {
      await result.current.submitSearch('zzz');
    });

    expect(result.current.chain).toHaveLength(2);
    expect(result.current.zoneBRows).toEqual([]);
    expect(result.current.zoneCounts.zoneB).toBe(0);
  });

  it('stores each response result_ref opaquely on the step snapshot', async () => {
    const { result, gateway } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.chain[0].snapshot.resultRef).toBe(SEARCH_RESPONSE.result_ref);
    expect(gateway.runSearch).toHaveBeenCalledTimes(1);
  });
});

describe('useSearchResults zone A + live promotion', () => {
  it('zone A selects the snapshot rows and promotes live matches first without hiding', async () => {
    const { result, rerender } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    expect(result.current.zoneARows.map((row) => row.nodeId)).toEqual([1, 2]);

    rerender({
      showError: jest.fn(),
      gateway: undefined,
      files: SESSION_FILES,
      sortMode: 'name_asc',
      liveText: 'notes',
    });

    // no hiding: still two rows, live match promoted to the top
    expect(result.current.zoneARows.map((row) => row.nodeId)).toEqual([2, 1]);
    const promoted = result.current.zoneARows[0];
    expect(promoted.highlights.some((range) => range.kind === 'live')).toBe(true);
    expect(promoted.highlights.some((range) => range.kind === 'committed')).toBe(true);
  });

  it('live typing never changes zone counts (snapshot honesty)', async () => {
    const { result, rerender } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    const countsBefore = result.current.zoneCounts;

    rerender({
      showError: jest.fn(),
      gateway: undefined,
      files: SESSION_FILES,
      sortMode: 'name_asc',
      liveText: 'poster',
    });

    expect(result.current.zoneCounts).toEqual(countsBefore);
  });

  it('committed-term rows carry committed highlight ranges on both zones', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    const zoneBRow = result.current.zoneBRows.find((row) => row.nodeId === 11);
    // 'Fun-MOVIE-notes.pdf' → 'MOVIE' at 4..9 case-insensitive
    expect(zoneBRow.highlights).toEqual(
      expect.arrayContaining([{ start: 4, end: 9, kind: 'committed' }])
    );
    const zoneARow = result.current.zoneARows.find((row) => row.nodeId === 1);
    expect(zoneARow.highlights).toEqual(
      expect.arrayContaining([{ start: 0, end: 5, kind: 'committed' }])
    );
  });

  it('a node visible in zone A is removed from zone B display but keeps the snapshot count', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [
          { node_id: 2, name: 'notes-movie.txt' },
          { node_id: 11, name: 'Fun-MOVIE-notes.pdf' },
        ],
        result_ref: 'sr1.x',
        counts: { name: 2, semantic: 0, total: 2, name_truncated: false },
        semantic_available: false,
      }),
    });
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.zoneARows.map((row) => row.nodeId)).toContain(2);
    expect(result.current.zoneBRows.map((row) => row.nodeId)).toEqual([11]);
    expect(result.current.zoneCounts.zoneB).toBe(2);
    // library target = zoneAIds ∪ FULL zone B snapshot ids (deduped union)
    expect(Array.from(result.current.libraryAddTarget).sort((a, b) => a - b)).toEqual([1, 2, 11]);
  });

  it('semantic rows land in the zone C snapshot and count; absent section renders nothing without error', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [{ node_id: 11, name: 'movie.pdf' }],
        semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.71 }],
        result_ref: 'sr1.y',
        counts: { name: 1, semantic: 1, total: 2, name_truncated: false },
        semantic_available: true,
      }),
    });
    const showError = jest.fn();
    const { result } = renderSearchHook({ gateway, showError });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.zoneCRows.map((row) => row.nodeId)).toEqual([90]);
    expect(result.current.zoneCounts.zoneC).toBe(1);
    expect(showError).not.toHaveBeenCalled();

    const degraded = renderSearchHook();
    await act(async () => {
      await degraded.result.current.submitSearch('movie');
    });
    expect(degraded.result.current.zoneCRows).toEqual([]);
    expect(degraded.result.current.zoneCounts.zoneC).toBe(0);
    expect(degraded.showError).not.toHaveBeenCalled();
  });
});

describe('useSearchResults enrichment', () => {
  it('routes snapshot row ids through the gateway metadata seam and merges by nodeId', async () => {
    const gateway = createGateway({
      loadNodesMetadata: jest.fn().mockResolvedValue([
        {
          nodeId: 11,
          type: 'file',
          size: 4096,
          lastmod: '2026-01-01T00:00:00Z',
          mime: 'application/pdf',
          hasReadPermission: true,
          hasWritePermission: false,
        },
      ]),
    });
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(gateway.loadNodesMetadata).toHaveBeenCalledWith([11, 12]);
    const row11 = result.current.zoneBRows.find((row) => row.nodeId === 11);
    expect(row11.type).toBe('file');
    expect(row11.size).toBe(4096);
    expect(row11.hasWritePermission).toBe(false);
    // tolerated missing row: 12 never arrives → stays unenriched
    const row12 = result.current.zoneBRows.find((row) => row.nodeId === 12);
    expect(row12.type).toBeUndefined();
    expect(row12.size).toBeUndefined();
  });

  it('an enrichment failure leaves rows unenriched without a toast', async () => {
    const gateway = createGateway({
      loadNodesMetadata: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const showError = jest.fn();
    const { result } = renderSearchHook({ gateway, showError });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.zoneBRows.every((row) => row.type === undefined)).toBe(true);
    expect(showError).not.toHaveBeenCalled();
  });

  it('zone B rows are explorer-shaped adapter rows with the server-search testid', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    const row = result.current.zoneBRows[0];
    expect(row).toEqual(
      expect.objectContaining({
        nodeId: 11,
        path: '',
        name: 'Fun-MOVIE-notes.pdf',
        basename: 'Fun-MOVIE-notes.pdf',
        isSearchServerRow: true,
        rowTestId: 'server-search-row-11',
      })
    );
  });
});

describe('useSearchResults zone thumbnail merge', () => {
  it('zone B rows receive thumbnailUrl when the zone-local callback fires', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    expect(result.current.zoneBRows.every((row) => row.thumbnailUrl === undefined)).toBe(true);

    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[11, '/api/thumbnails/11.webp']]));
    });

    expect(result.current.zoneBRows.find((row) => row.nodeId === 11).thumbnailUrl).toBe(
      '/api/thumbnails/11.webp'
    );
    // rows outside the payload keep the icon placeholder state
    expect(result.current.zoneBRows.find((row) => row.nodeId === 12).thumbnailUrl).toBeUndefined();
  });

  it('zone C rows receive thumbnailUrl through the same seam', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [{ node_id: 11, name: 'movie.pdf' }],
        semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.71 }],
        result_ref: 'sr1.y',
        counts: { name: 1, semantic: 1, total: 2, name_truncated: false },
        semantic_available: true,
      }),
    });
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[90, '/api/thumbnails/90.webp']]));
    });

    expect(result.current.zoneCRows.map((row) => row.nodeId)).toEqual([90]);
    expect(result.current.zoneCRows[0].thumbnailUrl).toBe('/api/thumbnails/90.webp');
  });

  it('merged thumbnails survive row re-derivation (live promotion and late enrichment)', async () => {
    let resolveMeta;
    const gateway = createGateway({
      loadNodesMetadata: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveMeta = resolve;
          })
      ),
    });
    const { result, rerender } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[12, '/api/thumbnails/12.webp']]));
    });

    rerender({
      showError: jest.fn(),
      gateway,
      files: SESSION_FILES,
      sortMode: 'name_asc',
      liveText: 'night',
    });
    expect(result.current.zoneBRows[0].nodeId).toBe(12);
    expect(result.current.zoneBRows[0].thumbnailUrl).toBe('/api/thumbnails/12.webp');

    await act(async () => {
      resolveMeta([
        {
          nodeId: 11,
          type: 'file',
          size: 1,
          lastmod: null,
          mime: 'application/pdf',
          hasReadPermission: true,
          hasWritePermission: true,
        },
      ]);
    });
    // enrichment re-derivation: 12 keeps its merged URL (and stays unenriched — missing row),
    // 11 enriches without inventing a thumbnail
    const row12 = result.current.zoneBRows.find((row) => row.nodeId === 12);
    expect(row12.thumbnailUrl).toBe('/api/thumbnails/12.webp');
    expect(row12.type).toBeUndefined();
    const row11 = result.current.zoneBRows.find((row) => row.nodeId === 11);
    expect(row11.thumbnailUrl).toBeUndefined();
    expect(row11.size).toBe(1);
  });

  it('an enrichment-supplied thumbnailUrl takes precedence over a zone merge', async () => {
    const gateway = createGateway({
      loadNodesMetadata: jest.fn().mockResolvedValue([
        {
          nodeId: 11,
          type: 'file',
          size: 2,
          lastmod: null,
          mime: 'image/jpeg',
          hasReadPermission: true,
          hasWritePermission: true,
          thumbnailUrl: '/api/thumbnails/from-meta.webp',
        },
      ]),
    });
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    expect(result.current.zoneBRows.find((row) => row.nodeId === 11).thumbnailUrl).toBe(
      '/api/thumbnails/from-meta.webp'
    );

    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[11, '/api/thumbnails/late.webp']]));
    });

    expect(result.current.zoneBRows.find((row) => row.nodeId === 11).thumbnailUrl).toBe(
      '/api/thumbnails/from-meta.webp'
    );
  });

  it('non-Map and empty payloads are ignored without touching rows', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    act(() => {
      result.current.handleZoneThumbnailsLoaded([{ nodeId: 11, thumbnailUrl: '/x.webp' }]);
      result.current.handleZoneThumbnailsLoaded(new Map());
    });

    expect(result.current.zoneBRows.every((row) => row.thumbnailUrl === undefined)).toBe(true);
  });

  it('the zone-local merge never touches zone A (session) rows', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    // node 1 is a SESSION_FILES row (zone A) — zone merge must not leak into it
    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[1, '/api/thumbnails/1.webp']]));
    });

    expect(result.current.zoneARows.map((row) => row.nodeId)).toContain(1);
    expect(result.current.zoneARows.every((row) => row.thumbnailUrl === undefined)).toBe(true);
  });

  it('exitResults clears merged zone thumbnails', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.handleZoneThumbnailsLoaded(new Map([[11, '/api/thumbnails/11.webp']]));
    });
    act(() => {
      result.current.exitResults();
    });
    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.zoneBRows.find((row) => row.nodeId === 11).thumbnailUrl).toBeUndefined();
  });
});

describe('useSearchResults exit + recents', () => {
  it('exitResults resets mode/chain/zones while the recents list survives', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.exitResults();
    });

    expect(result.current.mode).toBe('browse');
    expect(result.current.chain).toEqual([]);
    expect(result.current.zoneARows).toEqual([]);
    expect(result.current.zoneBRows).toEqual([]);
    expect(result.current.recentQueries.map((chip) => chip.query)).toEqual(['movie']);
  });

  it('upserts recents (normalized dedup, newest first, cap 8) through the storage seam', async () => {
    const gateway = createGateway();
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    await act(async () => {
      await result.current.submitSearch('  movie  ');
    });
    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.recentQueries[0].query).toBe('movie');
    expect(recentQueriesStorage.saveRecentQueries).toHaveBeenCalled();

    for (const query of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      await act(async () => {
        await result.current.submitSearch(query);
      });
    }
    expect(result.current.recentQueries).toHaveLength(8);
    expect(result.current.recentQueries[0].query).toBe('h');
  });

  it('a fresh submit after a previous chain resets the chain (new snapshot)', async () => {
    const { result } = renderSearchHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.exitResults();
    });
    await act(async () => {
      await result.current.submitSearch('sig');
    });

    expect(result.current.chain).toHaveLength(1);
    expect(result.current.chain[0].term).toBe('sig');
  });
});

describe('useSearchResults entry-click recording', () => {
  it('routes once through the gateway seam and absorbs failures silently', async () => {
    const gateway = createGateway();
    const { result } = renderSearchHook({ gateway });

    await act(async () => {
      await expect(result.current.recordEntryClick(11)).resolves.toBe(true);
    });
    expect(gateway.recordSearchClick).toHaveBeenCalledTimes(1);
    expect(gateway.recordSearchClick).toHaveBeenCalledWith(11);

    gateway.recordSearchClick.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await expect(result.current.recordEntryClick(12)).resolves.toBe(false);
    });
  });
});
