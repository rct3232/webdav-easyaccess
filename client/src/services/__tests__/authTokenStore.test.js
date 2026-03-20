import {
  applyNewTokenFromHeaders,
  getAccessToken,
  getRefreshToken,
  refreshAccessToken,
  removeTokens,
  setAccessToken,
  setRefreshToken,
} from '../authTokenStore';

describe('authTokenStore', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads tokens from the sessionStorage keys', () => {
    sessionStorage.setItem('token', 'access-token');
    sessionStorage.setItem('refreshToken', 'refresh-token');

    expect(getAccessToken()).toBe('access-token');
    expect(getRefreshToken()).toBe('refresh-token');
  });

  it('removeTokens clears both token keys', () => {
    setAccessToken('access-token');
    setRefreshToken('refresh-token');

    removeTokens();

    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('refreshToken')).toBeNull();
  });

  it('applyNewTokenFromHeaders stores x-new-token and dispatches token-refreshed', () => {
    const listener = jest.fn();
    window.addEventListener('token-refreshed', listener);

    const token = applyNewTokenFromHeaders({ 'x-new-token': 'fresh-token' });

    expect(token).toBe('fresh-token');
    expect(sessionStorage.getItem('token')).toBe('fresh-token');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('token-refreshed', listener);
  });

  it('refreshAccessToken posts the stored refresh token and stores the new access token', async () => {
    const listener = jest.fn();
    window.addEventListener('token-refreshed', listener);
    sessionStorage.setItem('refreshToken', 'refresh-token');
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ token: 'new-access-token' }),
    });

    const token = await refreshAccessToken();

    expect(token).toBe('new-access-token');
    expect(sessionStorage.getItem('token')).toBe('new-access-token');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('token-refreshed', listener);
  });

  it('refreshAccessToken failure removes tokens and throws', async () => {
    sessionStorage.setItem('token', 'old-access-token');
    sessionStorage.setItem('refreshToken', 'bad-refresh-token');
    global.fetch = jest.fn().mockRejectedValue(new Error('refresh failed'));

    await expect(refreshAccessToken()).rejects.toThrow('refresh failed');
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('refreshToken')).toBeNull();
  });
});
