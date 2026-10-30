/**
 * storageRepository tests — failure absorption, snake_case payload
 * pass-through, onError envelope handoff.
 * @see docs/spec/client/services/storageRepository.md
 */
import { get, post } from '../apiClient';
import {
  getStorageHygiene,
  getStorageUsage,
  acceptStorageSuggestions,
  dismissStorageSuggestion,
} from '../storageRepository';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('../collectionsNotifier', () => ({
  notifyCollectionsChange: jest.fn(),
}));

function transportError(status, errorCode, params) {
  const error = new Error(`Request failed with status ${status}`);
  error.response = { status, data: { errorCode, ...(params ? { params } : {}) } };
  return error;
}

describe('storageRepository reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getStorageHygiene returns the hygiene + suggestions payload verbatim', async () => {
    const payload = {
      hygiene: {
        duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 120 },
        trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
      },
      suggestions: [{ id: 1, node_id: 2, kind: 'exact_dup' }],
    };
    get.mockResolvedValueOnce({ data: payload });

    await expect(getStorageHygiene()).resolves.toEqual(payload);
    expect(get).toHaveBeenCalledWith('/storage');
  });

  it('getStorageHygiene absorbs failures into the { suggestions: [] } fallback', async () => {
    get.mockRejectedValueOnce(new Error('Network error'));

    await expect(getStorageHygiene()).resolves.toEqual({ suggestions: [] });
  });

  it('getStorageUsage returns the current breakdown + series verbatim', async () => {
    const payload = {
      current: {
        total_bytes: 30,
        live_bytes: 20,
        trash_bytes: 5,
        versions_bytes: 5,
        version_history_supported: true,
        incomplete: false,
      },
      series: {
        points: [
          { day: '2026-10-01', bytes: 10 },
          { day: '2026-10-02', bytes: 20 },
        ],
      },
    };
    get.mockResolvedValueOnce({ data: payload });

    await expect(getStorageUsage()).resolves.toEqual(payload);
    expect(get).toHaveBeenCalledWith('/storage/usage');
  });

  it('getStorageUsage absorbs failures into null (summary/sparkline omitted)', async () => {
    get.mockRejectedValueOnce(new Error('Network error'));

    await expect(getStorageUsage()).resolves.toBeNull();
  });
});

describe('storageRepository mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('acceptStorageSuggestions posts the camelCase body and returns the undo pointer untouched', async () => {
    const payload = {
      trashed: [1, 2],
      rejected_not_owned: [],
      skipped: [],
      undo: { action_id: 5501 },
    };
    post.mockResolvedValueOnce({ data: payload });

    await expect(acceptStorageSuggestions([1, 2])).resolves.toEqual(payload);
    expect(post).toHaveBeenCalledWith('/storage/suggestions/accept', { nodeIds: [1, 2] });
  });

  it('acceptStorageSuggestions absorbs failure to null and surfaces the envelope', async () => {
    post.mockRejectedValueOnce(transportError(400, 'serverErrors.storage.emptyNodeIds'));
    const onError = jest.fn();

    await expect(acceptStorageSuggestions([1], { onError })).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith({
      errorCode: 'serverErrors.storage.emptyNodeIds',
      params: {},
    });
  });

  it('dismissStorageSuggestion POSTs the camelCase body and returns the state row', async () => {
    post.mockResolvedValueOnce({ data: { id: 9, state: 'dismissed' } });

    await expect(dismissStorageSuggestion(9)).resolves.toEqual({ id: 9, state: 'dismissed' });
    expect(post).toHaveBeenCalledWith('/storage/suggestions/dismiss', { suggestionId: 9 });
  });

  it('dismissStorageSuggestion absorbs the 404 to null', async () => {
    post.mockRejectedValueOnce(transportError(404, 'serverErrors.storage.suggestionNotFound'));

    await expect(dismissStorageSuggestion(99)).resolves.toBeNull();
  });
});
