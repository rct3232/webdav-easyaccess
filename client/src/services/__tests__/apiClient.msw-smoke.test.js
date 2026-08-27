/**
 * Smoke test: apiClient + MSW (no mocks).
 * Verifies MSW intercepts fetch requests and returns usable JSON body (2xx and 4xx).
 */
import { http, HttpResponse } from 'msw';
import { server } from '../../setupTests';
import { get, post } from '../apiClient';

describe('apiClient MSW smoke', () => {
  it('POST /auth/login returns 200 (MSW intercepts) and has JSON body', async () => {
    const res = await post('/auth/login', { username: 'smokeuser', password: 'pass123' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({
          username: 'smokeuser',
          status: 'approved',
        }),
      })
    );
  });

  it('POST /auth/login 403 returns error with response.data (for pending flow)', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { errorCode: 'serverErrors.auth.pendingApproval', status: 'pending' },
          { status: 403 }
        )
      )
    );
    try {
      await post('/auth/login', { username: 'p', password: 'p' });
      throw new Error('Expected reject');
    } catch (err) {
      expect(err.response).toBeDefined();
      expect(err.response.status).toBe(403);
      expect(err.response.data).toEqual(
        expect.objectContaining({
          errorCode: 'serverErrors.auth.pendingApproval',
          status: 'pending',
        })
      );
    }
  });

  it('403 on GET /api/files/list: triggers history.back or / redirect', async () => {
    const origHistory = window.history;
    const origLocation = window.location;
    const backMock = jest.fn();
    delete window.history;
    window.history = { ...origHistory, length: 2, back: backMock };
    delete window.location;
    window.location = { href: origLocation.href };

    server.use(
      http.get('/api/files/list', () =>
        HttpResponse.json({ errorCode: 'serverErrors.permissions.forbidden' }, { status: 403 })
      )
    );

    await get('files/list');

    expect(backMock).toHaveBeenCalled();
    window.history = origHistory;
    window.location = origLocation;
  });

  it('403 on POST /api/files/upload: no redirect, throws error', async () => {
    const origLocation = window.location;
    const origHref = origLocation.href;
    const hrefSetter = jest.fn();
    delete window.location;
    window.location = { href: origHref };
    Object.defineProperty(window.location, 'href', {
      set: hrefSetter,
      get: () => origHref,
      configurable: true,
    });

    server.use(
      http.post('/api/files/upload', () =>
        HttpResponse.json({ errorCode: 'serverErrors.permissions.forbidden' }, { status: 403 })
      )
    );

    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'x.txt');
    fd.append('path', '/');

    try {
      await post('files/upload', fd);
      throw new Error('Expected reject');
    } catch (err) {
      expect(err.response?.status).toBe(403);
      expect(hrefSetter).not.toHaveBeenCalled();
    } finally {
      window.location = origLocation;
    }
  });
});

describe('apiClient share refresh no-redirect', () => {
  it('refresh fail on share check-my-permission: throws the 401 and does not redirect to /login', async () => {
    sessionStorage.setItem('token', 'expired-jwt');
    sessionStorage.setItem('refreshToken', 'bad-refresh');

    const origLocation = window.location;
    delete window.location;
    window.location = { href: origLocation.href };

    server.use(
      http.get('/api/share/:token/check-my-permission', () =>
        HttpResponse.json({ errorCode: 'serverErrors.auth.invalidOrExpiredToken' }, { status: 401 })
      ),
      http.post('/api/auth/refresh', () =>
        HttpResponse.json({ errorCode: 'serverErrors.auth.refreshTokenInvalid' }, { status: 401 })
      )
    );

    try {
      await get('/share/abc123/check-my-permission');
      throw new Error('Expected reject');
    } catch (err) {
      expect(err.response?.status).toBe(401);
      expect(window.location.href).not.toBe('/login');
    } finally {
      window.location = origLocation;
      sessionStorage.clear();
    }
  });
});
