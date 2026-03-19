/**
 * shareLinkService tests.
 * Verifies CRUD, getShareLinkUrl, getPublicShareLinkInfo, checkMyPermissionForShare,
 * addShareLinkToMyPermissions. Observable outcomes per spec.
 * @see docs/spec/client/services/shareLinkService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post, put, del } from '../apiClient';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

import {
  createShareLink,
  getShareLinks,
  getShareLink,
  updateShareLink,
  deleteShareLink,
  getShareLinkUrl,
  getPublicShareLinkInfo,
  checkMyPermissionForShare,
  addShareLinkToMyPermissions,
} from '../shareLinkService';

describe('shareLinkService', () => {
  const originalOrigin = window.location.origin;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://example.com' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { origin: originalOrigin },
      writable: true,
    });
  });

  describe('createShareLink', () => {
    it('returns link object from POST /share-links', async () => {
      const link = { token: 'abc', filePath: '/f', expiresAt: null };
      post.mockResolvedValueOnce({ data: link });

      const result = await createShareLink('/f', 14);

      expect(post).toHaveBeenCalledWith('/share-links', {
        filePath: '/f',
        expiresInDays: 14,
      });
      expect(result).toEqual(link);
      expect(result).toHaveProperty('token');
    });
  });

  describe('getShareLinks', () => {
    it('returns array from GET /share-links', async () => {
      const list = [];
      get.mockResolvedValueOnce({ data: list });

      const result = await getShareLinks();

      expect(get).toHaveBeenCalledWith('/share-links');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getShareLink', () => {
    it('returns link object from GET /share-links/:token', async () => {
      const link = { token: 't1', filePath: '/a' };
      get.mockResolvedValueOnce({ data: link });

      const result = await getShareLink('t1');

      expect(get).toHaveBeenCalledWith('/share-links/t1');
      expect(result).toEqual(link);
    });
  });

  describe('updateShareLink', () => {
    it('returns updated object from PUT /share-links/:token', async () => {
      const updated = { token: 't1', expiresInDays: 30 };
      put.mockResolvedValueOnce({ data: updated });

      const result = await updateShareLink('t1', { expiresInDays: 30 });

      expect(put).toHaveBeenCalledWith('/share-links/t1', { expiresInDays: 30 });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteShareLink', () => {
    it('calls DELETE /share-links/:token', async () => {
      del.mockResolvedValueOnce(undefined);

      await deleteShareLink('t1');

      expect(del).toHaveBeenCalledWith('/share-links/t1');
    });
  });

  describe('getShareLinkUrl', () => {
    it('returns origin + /share/:token', () => {
      const url = getShareLinkUrl('my-token');

      expect(url).toBe('https://example.com/share/my-token');
    });
  });

  describe('getPublicShareLinkInfo', () => {
    it('returns parsed JSON when response ok', async () => {
      const info = { filePath: '/a', expiresAt: null };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(info),
      });

      const result = await getPublicShareLinkInfo('token');

      expect(fetch).toHaveBeenCalledWith('/api/share/token/info');
      expect(result).toEqual(info);
    });

    it('throws with response.data.errorCode when not ok', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ errorCode: 'serverErrors.shareLink.notFound' }),
      });

      await expect(getPublicShareLinkInfo('bad')).rejects.toMatchObject({
        response: { data: { errorCode: 'serverErrors.shareLink.notFound' } },
      });
    });
  });

  describe('checkMyPermissionForShare', () => {
    it('returns hasSufficientPermission from GET /share/:token/check-my-permission', async () => {
      get.mockResolvedValueOnce({ data: { hasSufficientPermission: true } });

      const result = await checkMyPermissionForShare('t1');

      expect(get).toHaveBeenCalledWith('/share/t1/check-my-permission');
      expect(result).toHaveProperty('hasSufficientPermission');
      expect(result.hasSufficientPermission).toBe(true);
    });

    it('forwards null when auth policy skips excluded 401 handling', async () => {
      get.mockResolvedValueOnce(null);

      const result = await checkMyPermissionForShare('t1');

      expect(result).toBeNull();
    });
  });

  describe('addShareLinkToMyPermissions', () => {
    it('returns message from POST /share/:token/add-to-my-permissions', async () => {
      post.mockResolvedValueOnce({ data: { message: 'Added' } });

      const result = await addShareLinkToMyPermissions('t1');

      expect(post).toHaveBeenCalledWith('/share/t1/add-to-my-permissions');
      expect(result).toHaveProperty('message');
    });
  });
});
