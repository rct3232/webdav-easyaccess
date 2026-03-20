import {
  handle401RefreshFailure,
  handle403,
  is403RedirectableRequest,
  shouldSkipAuthNavigation,
} from '../authNavigationPolicy';

describe('authNavigationPolicy', () => {
  it('is403RedirectableRequest matches only GET /api/files/list and GET /api/admin/*', () => {
    expect(is403RedirectableRequest({ method: 'GET', url: '/api/files/list' })).toBe(true);
    expect(is403RedirectableRequest({ method: 'GET', url: '/api/admin/users' })).toBe(true);
    expect(is403RedirectableRequest({ method: 'GET', url: 'files/list' })).toBe(false);
    expect(is403RedirectableRequest({ method: 'GET', url: '/files/list' })).toBe(false);
    expect(is403RedirectableRequest({ method: 'POST', url: '/api/admin/users' })).toBe(false);
  });

  it('shouldSkipAuthNavigation returns true for auth and share exclusion cases', () => {
    expect(shouldSkipAuthNavigation({ url: '/api/auth/login' })).toBe(true);
    expect(shouldSkipAuthNavigation({ url: '/api/auth/register' })).toBe(true);
    expect(
      shouldSkipAuthNavigation({
        url: '/api/files/list',
        headers: { 'X-Share-Token': 'share-token' },
      })
    ).toBe(true);
    expect(shouldSkipAuthNavigation({ url: '/api/share/token/check-my-permission' })).toBe(true);
    expect(shouldSkipAuthNavigation({ url: '/api/files/list' })).toBe(false);
  });

  it('handle403 calls history.back for redirectable requests when history is available', () => {
    const originalHistory = window.history;
    const back = jest.fn();
    delete window.history;
    window.history = { ...originalHistory, length: 2, back };

    handle403({ method: 'GET', url: '/api/files/list' }, new Error('forbidden'));

    expect(back).toHaveBeenCalledTimes(1);
    window.history = originalHistory;
  });

  it('handle403 rethrows for excluded or non-redirectable requests', () => {
    const excludedError = new Error('excluded');
    expect(() =>
      handle403(
        { method: 'GET', url: '/api/auth/login' },
        excludedError
      )
    ).toThrow(excludedError);

    const nonRedirectableError = new Error('non-redirectable');
    expect(() =>
      handle403(
        { method: 'POST', url: '/api/files/upload' },
        nonRedirectableError
      )
    ).toThrow(nonRedirectableError);
  });

  it('handle401RefreshFailure navigates to /login', () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: originalLocation.href };

    handle401RefreshFailure();

    expect(window.location.href).toBe('/login');
    window.location = originalLocation;
  });
});
