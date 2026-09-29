/**
 * fileLikesRepository tests — failure absorption, notify-after-real-success,
 * snake_case payload pass-through, onError envelope handoff, notifier cleanup.
 * @see docs/spec/client/services/fileLikesRepository.md
 */
import { get, put } from '../apiClient';
import {
  getLikedItems,
  getLikedNodeIds,
  setFileLike,
  subscribeFileLikesChange,
} from '../fileLikesRepository';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

function transportError(status, errorCode, params) {
  const error = new Error(`Request failed with status ${status}`);
  error.response = { status, data: { errorCode, ...(params ? { params } : {}) } };
  return error;
}

describe('fileLikesRepository.getLikedNodeIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the whole-viewer payload verbatim', async () => {
    get.mockResolvedValueOnce({ data: { liked: [3, 7] } });

    await expect(getLikedNodeIds()).resolves.toEqual({ liked: [3, 7] });
    expect(get).toHaveBeenCalledWith('/file-likes');
  });

  it('absorbs failures into the { liked: [] } fallback without rejecting', async () => {
    get.mockRejectedValueOnce(transportError(500, 'serverErrors.files.readFailed'));

    await expect(getLikedNodeIds()).resolves.toEqual({ liked: [] });
  });
});

describe('fileLikesRepository.setFileLike', () => {
  beforeEach(() => jest.clearAllMocks());

  it('puts the explicit boolean state and returns the settled payload', async () => {
    put.mockResolvedValueOnce({ data: { node_id: 11, liked: true } });

    await expect(setFileLike(11, true)).resolves.toEqual({ node_id: 11, liked: true });
    expect(put).toHaveBeenCalledWith('/file-likes/11', { liked: true });
  });

  it('notifies subscribers exactly once after a real success', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFileLikesChange(listener);
    try {
      put.mockResolvedValueOnce({ data: { node_id: 11, liked: false } });

      await setFileLike(11, false);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('absorbs a failed mutation into null, reports the envelope once, and never notifies', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFileLikesChange(listener);
    const onError = jest.fn();
    try {
      put.mockRejectedValueOnce(transportError(404, 'serverErrors.files.notFound'));

      await expect(setFileLike(11, true, { onError })).resolves.toBeNull();
      expect(onError).toHaveBeenCalledWith({
        errorCode: 'serverErrors.files.notFound',
        params: {},
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('survives a throwing subscriber (fan-out isolation)', async () => {
    const unsubscribe = subscribeFileLikesChange(() => {
      throw new Error('subscriber boom');
    });
    try {
      put.mockResolvedValueOnce({ data: { node_id: 12, liked: true } });

      await expect(setFileLike(12, true)).resolves.toEqual({ node_id: 12, liked: true });
    } finally {
      unsubscribe();
    }
  });

  it('unsubscribe removes the listener and is safe to call twice', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFileLikesChange(listener);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    put.mockResolvedValueOnce({ data: { node_id: 13, liked: true } });
    await setFileLike(13, true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('fileLikesRepository.getLikedItems (P-5 Likes surface)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the cursor page verbatim and builds the query string', async () => {
    const page = {
      items: [
        {
          node_id: 7,
          name: 'b.txt',
          type: 'file',
          mime: null,
          state: 'normal',
          liked: true,
          created_at: null,
        },
      ],
      next_cursor: 'cursor-token',
    };
    get.mockResolvedValueOnce({ data: page });

    await expect(getLikedItems({ cursor: 'abc', limit: 50 })).resolves.toEqual(page);
    expect(get).toHaveBeenCalledWith('/file-likes/items?cursor=abc&limit=50');
  });

  it('omits absent params (first page)', async () => {
    get.mockResolvedValueOnce({ data: { items: [], next_cursor: null } });

    await expect(getLikedItems()).resolves.toEqual({ items: [], next_cursor: null });
    expect(get).toHaveBeenCalledWith('/file-likes/items');
  });

  it('absorbs failures into { items: [], next_cursor: null } without rejecting or notifying', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFileLikesChange(listener);
    try {
      get.mockRejectedValueOnce(transportError(500, 'serverErrors.files.readFailed'));

      await expect(getLikedItems({ cursor: 'abc' })).resolves.toEqual({
        items: [],
        next_cursor: null,
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
