/**
 * collectionsRepository tests — failure absorption, notify-after-real-success,
 * snake_case payload pass-through, onError envelope handoff.
 * @see docs/spec/client/services/collectionsRepository.md
 */
import { get, post, put, del } from '../apiClient';
import { notifyCollectionsChange } from '../collectionsNotifier';
import {
  getCollections,
  getCollectionItems,
  createCollection,
  updateCollection,
  archiveCollection,
  deleteCollection,
  addCollectionItems,
  removeCollectionItems,
  previewCollection,
  getMergeSuggestions,
  mergeCollections,
  getMemberships,
  grantCollection,
  revokeGrant,
} from '../collectionsRepository';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../collectionsNotifier', () => ({
  notifyCollectionsChange: jest.fn(),
}));

function transportError(status, errorCode, params) {
  const error = new Error(`Request failed with status ${status}`);
  error.response = { status, data: { errorCode, ...(params ? { params } : {}) } };
  return error;
}

describe('collectionsRepository reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getCollections returns the snake_case payload verbatim', async () => {
    const payload = {
      collections: [{ collection_id: 17, name: 'Europe', publish_mode: 'ask' }],
    };
    get.mockResolvedValueOnce({ data: payload });

    const result = await getCollections({ sort: 'activity', include: 'mine,shared' });

    expect(get).toHaveBeenCalledWith('/collections', expect.anything());
    expect(result).toEqual(payload);
  });

  it('getCollections absorbs transport failures into { collections: [] }', async () => {
    get.mockRejectedValueOnce(new Error('Network error'));

    await expect(getCollections()).resolves.toEqual({ collections: [] });
  });

  it('getCollectionItems returns the fallback view shape on failure', async () => {
    get.mockRejectedValueOnce(new Error('Network error'));

    const result = await getCollectionItems(17, { cursor: 'abc', since: '2026-09-01T00:00:00Z' });
    expect(result).toEqual({ items: [], next_cursor: null });
    expect(get).toHaveBeenCalledWith(
      '/collections/17/items?cursor=abc&since=2026-09-01T00%3A00%3A00Z',
      expect.anything()
    );
  });

  it('getMergeSuggestions returns an empty suggestions array on failure (not null)', async () => {
    get.mockRejectedValueOnce(new Error('Network error'));

    await expect(getMergeSuggestions()).resolves.toEqual({ suggestions: [] });
  });

  it('getMemberships posts camelCase nodeIds and returns the fallback on failure', async () => {
    post.mockResolvedValueOnce({
      data: { memberships: [{ node_id: 5, collection_ids: [1, 2] }] },
    });
    const ok = await getMemberships([5, 6]);
    expect(ok).toEqual({ memberships: [{ node_id: 5, collection_ids: [1, 2] }] });

    post.mockRejectedValueOnce(new Error('Network error'));
    await expect(getMemberships([5])).resolves.toEqual({ memberships: [] });
    expect(post).toHaveBeenLastCalledWith('/collections/for-nodes', { nodeIds: [5, 6] }, expect.anything());
  });

  it('previewCollection returns null on failure and the payload on success', async () => {
    post.mockRejectedValueOnce(new Error('Network error'));
    await expect(previewCollection({ definition: { kind: 'predicate', any_of: [] } })).resolves.toBeNull();

    const payload = { count: 3, sample: [{ node_id: 1, name: 'a' }], sample_truncated: false };
    post.mockResolvedValueOnce({ data: payload });
    await expect(previewCollection({ seedNodeId: 9 })).resolves.toEqual(payload);
    expect(post).toHaveBeenLastCalledWith('/collections/preview', { seedNodeId: 1 }, expect.anything());
  });
});

describe('collectionsRepository mutations (absorb + notify + onError)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createCollection posts { name } and returns the payload with undo.action_id untouched', async () => {
    const payload = {
      collection: { collection_id: 9, name: 'X' },
      undo: { action_id: 990 },
    };
    post.mockResolvedValueOnce({ data: payload });

    const result = await createCollection({ name: 'X' });

    expect(post).toHaveBeenCalledWith('/collections', { name: 'X' }, expect.anything());
    expect(result).toEqual(payload);
    expect(result.undo.action_id).toBe(990);
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('mutations return null on failure, call onError with the envelope, and never notify', async () => {
    const onError = jest.fn();
    post.mockRejectedValueOnce(transportError(409, 'serverErrors.collections.notArchived'));

    const result = await archiveCollection(17, { onError });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith({
      errorCode: 'serverErrors.collections.notArchived',
      params: {},
    });
    expect(notifyCollectionsChange).not.toHaveBeenCalled();
  });

  it('deleteCollection returns true only on 204 success and false on failure', async () => {
    del.mockResolvedValueOnce({ status: 204, data: null });
    expect(await deleteCollection(17)).toBe(true);
    expect(del).toHaveBeenCalledWith('/collections/17', expect.anything());
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);

    del.mockRejectedValueOnce(transportError(409, 'serverErrors.collections.notArchived'));
    const onError = jest.fn();
    await expect(deleteCollection(17, { onError })).resolves.toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('updateCollection sends camelCase bodies to PUT /:id', async () => {
    put.mockResolvedValueOnce({ data: { collection: { collection_id: 1 }, undo: { action_id: 1 } } });

    await updateCollection(17, { name: 'N', pinned: true, publishMode: 'auto' });

    expect(put).toHaveBeenCalledWith(
      '/collections/17',
      { name: 'N', pinned: true, publishMode: 'auto' },
      expect.anything()
    );
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('addCollectionItems posts nodeIds; silent suppresses notify', async () => {
    post.mockResolvedValueOnce({ data: { added: [1], undo: { action_id: 5 } } });

    await addCollectionItems(17, [1, 2], { silent: true });

    expect(post).toHaveBeenCalledWith('/collections/17/items', { nodeIds: [1, 2] }, expect.anything());
    expect(notifyCollectionsChange).not.toHaveBeenCalled();

    post.mockResolvedValueOnce({ data: { added: [3], undo: { action_id: 6 } } });
    await addCollectionItems(17, [3]);
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('removeCollectionItems issues DELETE with a JSON body (symmetric batch semantics)', async () => {
    del.mockResolvedValueOnce({ data: { removed: [1], excluded: [], ignored: [] } });

    const result = await removeCollectionItems(17, [1]);

    expect(del).toHaveBeenCalledWith('/collections/17/items', { nodeIds: [1] }, expect.anything());
    expect(result).toEqual({ removed: [1], excluded: [], ignored: [] });
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('merge posts to /:id/merge/:other and returns the snake_case payload', async () => {
    post.mockResolvedValueOnce({
      data: { survivor: { collection_id: 17, name: 'A', item_count: 4 }, absorbed_id: 23, undo: { action_id: 7 } },
    });

    const result = await mergeCollections(17, 23);

    expect(post).toHaveBeenCalledWith('/collections/17/merge/23', {}, expect.anything());
    expect(result.absorbed_id).toBe(23);
    expect(notifyCollectionsChange).toHaveBeenCalledTimes(1);
  });

  it('grant/revoke use the documented paths', async () => {
    post.mockResolvedValueOnce({ data: { grant: { grantee_id: 9 }, undo: { action_id: 8 } } });
    await grantCollection(17, { userId: 9, role: 'viewer' });
    expect(post).toHaveBeenCalledWith(
      '/collections/17/grants',
      { userId: 9, role: 'viewer' },
      expect.anything()
    );

    del.mockResolvedValueOnce({ data: { grantee_id: 9, revoked: true, undo: { action_id: 9 } } });
    await revokeGrant(17, 9);
    expect(del).toHaveBeenCalledWith('/collections/17/grants?userId=9', expect.anything());
  });

  it('onError receives null for transport errors without a response body', async () => {
    const onError = jest.fn();
    const boom = new Error('socket hang up');
    post.mockRejectedValueOnce(boom);

    await updateCollection(17, { pinned: true }, { onError });

    expect(onError).toHaveBeenCalledWith(null);
    expect(notifyCollectionsChange).not.toHaveBeenCalled();
  });
});