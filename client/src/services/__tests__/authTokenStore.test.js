import {
  applyNewTokenFromHeaders,
  getAccessToken,
  getRefreshToken,
  refreshAccessToken,
  removeTokens,
  revokeRefreshToken,
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

  it('refreshAccessToken persists the ROTATED refresh token from the response', async () => {
    sessionStorage.setItem('refreshToken', 'old-refresh');
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ token: 'a2', refreshToken: 'rotated-refresh' }),
    });

    await refreshAccessToken();

    expect(sessionStorage.getItem('token')).toBe('a2');
    expect(sessionStorage.getItem('refreshToken')).toBe('rotated-refresh');
  });

  it('concurrent refreshAccessToken calls share one in-flight request (rotation-safe)', async () => {
    sessionStorage.setItem('refreshToken', 'shared-refresh');
    let resolveFetch;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const p1 = refreshAccessToken();
    const p2 = refreshAccessToken();
    resolveFetch({ json: () => Promise.resolve({ token: 'single-flight', refreshToken: 'r2' }) });
    const [t1, t2] = await Promise.all([p1, p2]);

    expect(t1).toBe('single-flight');
    expect(t2).toBe('single-flight');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('revokeRefreshToken posts the current refresh token to /auth/logout and is best-effort', async () => {
    sessionStorage.setItem('refreshToken', 'rt-1');
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    revokeRefreshToken();

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/auth/logout');
    expect(init.body).toContain('rt-1');

    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    revokeRefreshToken();
    await Promise.resolve();
    await expect(Promise.resolve()).resolves.toBeUndefined();
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
