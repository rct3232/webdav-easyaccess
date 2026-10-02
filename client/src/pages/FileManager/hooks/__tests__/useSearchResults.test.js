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

function createGateway(overrides = {}) {
  return {
    runSearch: jest.fn().mockResolvedValue(SEARCH_RESPONSE),
    createCollection: jest
      .fn()
      .mockResolvedValue({ collection: { collection_id: 7 }, undo: { action_id: 42 } }),
    recordSearchClick: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderResultsHook({
  showError = jest.fn(),
  onUndoable = jest.fn(),
  gateway,
  isAdmin = false,
} = {}) {
  const resolvedGateway = gateway ?? createGateway();
  const utils = renderHook(() =>
    useSearchResults({ showError, onUndoable, gateway: resolvedGateway, isAdmin })
  );
  return { ...utils, gateway: resolvedGateway, showError, onUndoable };
}

beforeEach(() => {
  jest.clearAllMocks();
  recentQueriesStorage.loadRecentQueries.mockReturnValue([]);
});

describe('useSearchResults mode transitions', () => {
  it('starts in filter mode with no results', () => {
    const { result } = renderResultsHook();

    expect(result.current.mode).toBe('filter');
    expect(result.current.submittedQuery).toBeNull();
    expect(result.current.displaySections).toBe('none');
  });

  it('enters results mode only on submit; typing alone never calls runSearch', async () => {
    const { result, gateway } = renderResultsHook();

    act(() => {
      result.current.setFilterText('typing');
    });
    expect(gateway.runSearch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(gateway.runSearch).toHaveBeenCalledTimes(1);
    expect(gateway.runSearch).toHaveBeenCalledWith({ query: 'movie' }, expect.anything());
    expect(result.current.mode).toBe('results');
    expect(result.current.submittedQuery).toBe('movie');
  });

  it('exitResults returns to filter mode and clears result state, keeping chips', async () => {
    const { result, gateway } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.exitResults();
    });

    expect(result.current.mode).toBe('filter');
    expect(result.current.submittedQuery).toBeNull();
    expect(result.current.nameMatches).toEqual([]);
    expect(result.current.displaySections).toBe('none');
    expect(gateway.runSearch).toHaveBeenCalledTimes(1); // no re-fetch on exit
  });
});

describe('useSearchResults submit guards', () => {
  it('treats an empty submit as exit (no server call)', async () => {
    const { result, gateway } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('');
    });

    expect(gateway.runSearch).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('filter');
  });

  it('guards >200 chars client-side with the mapped 400 message and no server call', async () => {
    const { result, gateway, showError } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('a'.repeat(201));
    });

    expect(gateway.runSearch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('serverErrors.search.queryTooLong');
  });

  it('maps an absorbed failure to search.fail and keeps the prior result set', async () => {
    const gateway = createGateway();
    const { result, showError } = renderResultsHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    gateway.runSearch.mockResolvedValueOnce(null);

    await act(async () => {
      await result.current.submitSearch('other');
    });

    expect(showError).toHaveBeenCalledWith('serverErrors.search.fail');
    expect(result.current.submittedQuery).toBe('movie');
    expect(result.current.nameMatches).toHaveLength(2);
  });
});

describe('useSearchResults sections + visibility rule', () => {
  it('computes highlight ranges only on nameMatches rows; semantic rows carry score only', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [{ node_id: 11, name: 'Fun-MOVIE-notes.pdf' }],
        semantic: [{ node_id: 90, name: 'fantasy-movie-night.jpg', score: 0.71 }],
        result_ref: 'sr1.aaaaaaaaaaaaaaaa',
        counts: { name: 1, semantic: 1, total: 2, name_truncated: false },
        semantic_available: true,
      }),
    });
    const { result } = renderResultsHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('movie');
    });

    expect(result.current.nameMatches).toEqual([
      {
        node_id: 11,
        name: 'Fun-MOVIE-notes.pdf',
        highlights: [{ start: 4, end: 9 }],
      },
    ]);
    expect(result.current.semantic).toEqual([
      { node_id: 90, name: 'fantasy-movie-night.jpg', score: 0.71 },
    ]);
    expect(result.current.displaySections).toBe('both');
  });

  it('hides the save button when semantic is empty or unavailable; shows it otherwise', async () => {
    const { result } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    expect(result.current.canSaveToCollection).toBe(false);

    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [],
        semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.9 }],
        result_ref: 'sr1.bbbbbbbbbbbbbbbb',
        counts: { name: 0, semantic: 1, total: 1, name_truncated: false },
        semantic_available: true,
      }),
    });
    const second = renderResultsHook({ gateway });
    await act(async () => {
      await second.result.current.submitSearch('fantasy');
    });
    expect(second.result.current.canSaveToCollection).toBe(true);
    expect(second.result.current.displaySections).toBe('semantic');
  });

  it('filters loaded rows inline while in results mode; the server count stays', async () => {
    const { result } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    expect(result.current.nameMatches).toHaveLength(2);

    act(() => {
      result.current.setFilterText('night');
    });

    expect(result.current.nameMatches).toEqual([
      { node_id: 12, name: 'movie-night.jpg', highlights: [{ start: 0, end: 5 }] },
    ]);
    expect(result.current.counts.total).toBe(2); // server count — honesty rule
  });
});

describe('useSearchResults recent-query chips', () => {
  it('upserts a chip per submitted query (newest first, max 8, deduped) and persists', async () => {
    const { result } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    await act(async () => {
      await result.current.submitSearch('sig');
    });
    await act(async () => {
      await result.current.submitSearch('  movie  '); // normalized dedup
    });

    expect(result.current.recentQueries).toHaveLength(2);
    expect(result.current.recentQueries[0].query).toBe('movie');
    expect(result.current.recentQueries[0].resultRef).toBe(SEARCH_RESPONSE.result_ref);
    expect(recentQueriesStorage.saveRecentQueries).toHaveBeenCalled();

    const queries = Array.from({ length: 9 }, (_, i) => `query-${i}`);
    for (const q of queries) {
      await act(async () => {
        await result.current.submitSearch(q);
      });
    }
    expect(result.current.recentQueries).toHaveLength(8);
  });

  it('reloads persisted chips on mount', () => {
    recentQueriesStorage.loadRecentQueries.mockReturnValueOnce([
      { id: 'movie', query: 'movie', resultRef: 'sr1.old' },
    ]);

    const { result } = renderResultsHook();

    expect(result.current.recentQueries).toEqual([
      { id: 'movie', query: 'movie', resultRef: 'sr1.old' },
    ]);
  });
});

describe('useSearchResults save flow', () => {
  it('creates a search-origin collection from the semantic-only contract and forwards undo', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [{ node_id: 11, name: 'Fun-MOVIE-notes.pdf' }],
        semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.9 }],
        result_ref: 'sr1.cccccccccccccccc',
        counts: { name: 1, semantic: 1, total: 2, name_truncated: false },
        semantic_available: true,
      }),
    });
    const { result, onUndoable } = renderResultsHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('fantasy');
    });
    let payload;
    await act(async () => {
      payload = await result.current.saveResultsToCollection('Fantasy picks');
    });

    expect(gateway.createCollection).toHaveBeenCalledTimes(1);
    expect(gateway.createCollection).toHaveBeenCalledWith(
      { name: 'Fantasy picks', origin: 'search', resultRef: 'sr1.cccccccccccccccc' },
      expect.anything()
    );
    expect(payload).toEqual({ collection: { collection_id: 7 }, undo: { action_id: 42 } });
    expect(onUndoable).toHaveBeenCalledWith({ action_id: 42 });
  });

  it('refuses the save when semantic is empty or unavailable', async () => {
    const { result, gateway } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    let payload;
    await act(async () => {
      payload = await result.current.saveResultsToCollection('Nope');
    });

    expect(payload).toBeNull();
    expect(gateway.createCollection).not.toHaveBeenCalled();
  });

  it('saveChipQuery re-runs the chip query then saves with the chip text as name', async () => {
    const gateway = createGateway({
      runSearch: jest.fn().mockResolvedValue({
        name_matches: [],
        semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.9 }],
        result_ref: 'sr1.dddddddddddddddd',
        counts: { name: 0, semantic: 1, total: 1, name_truncated: false },
        semantic_available: true,
      }),
    });
    const { result } = renderResultsHook({ gateway });

    await act(async () => {
      await result.current.saveChipQuery({ id: 'fantasy', query: 'fantasy' });
    });

    expect(gateway.runSearch).toHaveBeenCalledWith({ query: 'fantasy' }, expect.anything());
    expect(gateway.createCollection).toHaveBeenCalledWith(
      { name: 'fantasy', origin: 'search', resultRef: 'sr1.dddddddddddddddd' },
      expect.anything()
    );
  });
});

describe('useSearchResults entry-click recording (register (a))', () => {
  it('routes a result-open through the gateway click seam, absorbed silently', async () => {
    const { result, gateway } = renderResultsHook();

    await act(async () => {
      const recorded = await result.current.recordEntryClick(11);
      expect(recorded).toBe(true);
    });

    expect(gateway.recordSearchClick).toHaveBeenCalledTimes(1);
    expect(gateway.recordSearchClick).toHaveBeenCalledWith(11);
  });
});

describe('useSearchResults results-mode filter contract', () => {
  it('leaves the explorer listing untouched: no gateway IO besides search seams', async () => {
    const { result, gateway } = renderResultsHook();

    await act(async () => {
      await result.current.submitSearch('movie');
    });
    act(() => {
      result.current.exitResults();
    });

    expect(gateway.listDirectory).toBeUndefined();
    expect(gateway.loadCollections).toBeUndefined();
    expect(result.current.mode).toBe('filter');
  });
});

describe('useSearchResults admin operator suppression (PLAN §14 client half)', () => {
  const semanticResponse = () => ({
    name_matches: [],
    semantic: [{ node_id: 90, name: 'fantasy.jpg', score: 0.9 }],
    result_ref: 'sr1.cccccccccccccccc',
    counts: { name: 0, semantic: 1, total: 1, name_truncated: false },
    semantic_available: true,
  });

  it('canSaveToCollection is false for admin even with a savable semantic set', async () => {
    const gateway = createGateway({ runSearch: jest.fn().mockResolvedValue(semanticResponse()) });
    const { result } = renderResultsHook({ gateway, isAdmin: true });

    await act(async () => {
      await result.current.submitSearch('fantasy');
    });

    expect(result.current.canSaveToCollection).toBe(false);

    let payload = 'unset';
    await act(async () => {
      payload = await result.current.saveResultsToCollection('Fantasy picks');
    });
    expect(payload).toBeNull();
    expect(gateway.createCollection).not.toHaveBeenCalled();
  });

  it('saveChipQuery is inert for admin — no re-run, no create', async () => {
    const gateway = createGateway({ runSearch: jest.fn().mockResolvedValue(semanticResponse()) });
    const { result } = renderResultsHook({ gateway, isAdmin: true });

    let payload = 'unset';
    await act(async () => {
      payload = await result.current.saveChipQuery({ id: 'fantasy', query: 'fantasy' });
    });

    expect(payload).toBeNull();
    expect(gateway.createCollection).not.toHaveBeenCalled();
  });

  it('non-admin control: the identical savable payload still yields canSaveToCollection true', async () => {
    const gateway = createGateway({ runSearch: jest.fn().mockResolvedValue(semanticResponse()) });
    const { result } = renderResultsHook({ gateway });

    await act(async () => {
      await result.current.submitSearch('fantasy');
    });

    expect(result.current.canSaveToCollection).toBe(true);
  });
});
