import { get, post, put, del } from '../apiClient';
import { createShareLink, getShareLinks, deleteShareLink, getPublicShareLinkInfo } from '../shareLinkService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

describe('shareLinkService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('createShareLink calls post with correct body', async () => {
    post.mockResolvedValue({ data: { token: 'abc' } });

    await createShareLink('/test.txt', 7);

    expect(post).toHaveBeenCalledWith('/share-links', {
      filePath: '/test.txt',
      expiresInDays: 7,
    });
  });

  it('getShareLinks calls get', async () => {
    get.mockResolvedValue({ data: [] });

    await getShareLinks();

    expect(get).toHaveBeenCalledWith('/share-links');
  });

  it('deleteShareLink calls del', async () => {
    del.mockResolvedValue({ data: { success: true } });

    await deleteShareLink('abc');

    expect(del).toHaveBeenCalledWith('/share-links/abc');
  });

  it('getPublicShareLinkInfo calls fetch', async () => {
    const mockInfo = { fileName: 'test.txt' };
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockInfo),
    });

    const result = await getPublicShareLinkInfo('abc');

    expect(global.fetch).toHaveBeenCalledWith('/api/share/abc/info');
    expect(result).toEqual(mockInfo);
  });
});
