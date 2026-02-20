/**
 * apiClient tests.
 * Uses MSW handlers to control responses. Verifies observable outcomes: response.data, error.response, error.code.
 * @see docs/TESTING_STRATEGY.md
 */
import { http, HttpResponse } from 'msw';
import { server } from '../../setupTests';
import { get, post, put, del } from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('request methods', () => {
    it('get returns response data', async () => {
      server.use(
        http.get('/api/test-get', () => HttpResponse.json({ value: 42 }))
      );

      const response = await get('/test-get');

      expect(response.data).toEqual({ value: 42 });
    });

    it('post sends body and returns response', async () => {
      server.use(
        http.post('/api/test-post', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json({ ok: true, received: body });
        })
      );

      const response = await post('/test-post', { name: 'foo' });

      expect(response.data).toEqual({ ok: true, received: { name: 'foo' } });
    });

    it('put sends body and returns response', async () => {
      server.use(
        http.put('/api/test-put', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json({ updated: true, received: body });
        })
      );

      const response = await put('/test-put', { id: 1, name: 'bar' });

      expect(response.data).toEqual({ updated: true, received: { id: 1, name: 'bar' } });
    });

    it('del returns response', async () => {
      server.use(
        http.delete('/api/test-delete', () => HttpResponse.json({ deleted: true }))
      );

      const response = await del('/test-delete');

      expect(response.data).toEqual({ deleted: true });
    });
  });

  describe('error handling', () => {
    it('rejects on 4xx', async () => {
      server.use(
        http.get('/api/test-error', () =>
          HttpResponse.json(
            { errorCode: 'serverErrors.files.notFound' },
            { status: 404 }
          )
        )
      );

      await expect(get('/test-error')).rejects.toThrow();
    });

    it('rejects on 5xx', async () => {
      server.use(
        http.get('/api/test-500', () =>
          HttpResponse.json({}, { status: 500 })
        )
      );

      await expect(get('/test-500')).rejects.toThrow();
    }, 15000);

    it('5xx retry all fail: throws last error, preserves error.response', async () => {
      server.use(
        http.get('/api/test-5xx', () =>
          HttpResponse.json(
            { errorCode: 'serverErrors.internal' },
            { status: 502 }
          )
        )
      );

      try {
        await get('/test-5xx');
        throw new Error('Expected reject');
      } catch (e) {
        expect(e.response).toBeDefined();
        expect(e.response.status).toBe(502);
        expect(e.response.data).toEqual({ errorCode: 'serverErrors.internal' });
      }
    }, 15000);
  });

  describe('401 handling', () => {
    it('401 refresh success: stores new token, retries request, returns success', async () => {
      sessionStorage.setItem('token', 'old-jwt');
      sessionStorage.setItem('refreshToken', 'valid-refresh');

      let callCount = 0;
      server.use(
        http.get('/api/test-401-retry', ({ request }) => {
          callCount++;
          const auth = request.headers.get('Authorization');
          if (callCount === 1 && auth === 'Bearer old-jwt') {
            return HttpResponse.json({ errorCode: 'serverErrors.auth.invalidOrExpiredToken' }, { status: 401 });
          }
          return HttpResponse.json({ value: 'retried' });
        }),
        http.post('/api/auth/refresh', async ({ request }) => {
          const body = await request.json();
          if (body?.refreshToken === 'valid-refresh') {
            return HttpResponse.json({ token: 'new-jwt-token' });
          }
          return HttpResponse.json({ errorCode: 'serverErrors.auth.refreshTokenInvalid' }, { status: 401 });
        })
      );

      const response = await get('/test-401-retry');

      expect(response.data).toEqual({ value: 'retried' });
      expect(sessionStorage.getItem('token')).toBe('new-jwt-token');
      expect(callCount).toBe(2);
    });

    it('401 refresh failure: removes tokens, redirects to /login', async () => {
      sessionStorage.setItem('token', 'expired-jwt');
      sessionStorage.setItem('refreshToken', 'bad-refresh');

      const origLocation = window.location;
      delete window.location;
      window.location = { href: origLocation.href };

      server.use(
        http.get('/api/test-401-fail', () =>
          HttpResponse.json({ errorCode: 'serverErrors.auth.invalidOrExpiredToken' }, { status: 401 })
        ),
        http.post('/api/auth/refresh', () =>
          HttpResponse.json({ errorCode: 'serverErrors.auth.refreshTokenInvalid' }, { status: 401 })
        )
      );

      try {
        await get('/test-401-fail');
        throw new Error('Expected reject');
      } catch (err) {
        expect(err.response?.status).toBe(401);
      }

      expect(sessionStorage.getItem('token')).toBeNull();
      expect(sessionStorage.getItem('refreshToken')).toBeNull();
      expect(window.location.href).toBe('/login');
      window.location = origLocation;
    });

    it('401 on login: does not redirect to /login', async () => {
      const origLocation = window.location;
      delete window.location;
      window.location = { href: origLocation.href };

      server.use(
        http.post('/api/auth/login', () =>
          HttpResponse.json({ errorCode: 'serverErrors.auth.invalidCredentials' }, { status: 401 })
        )
      );

      try {
        await post('/auth/login', { username: 'u', password: 'p' });
        throw new Error('Expected reject');
      } catch (err) {
        expect(err.response?.status).toBe(401);
        expect(window.location.href).not.toBe('/login');
      } finally {
        window.location = origLocation;
      }
    });

    it('401 on share check-my-permission: does not redirect to /login', async () => {
      sessionStorage.setItem('token', 'expired');
      sessionStorage.setItem('refreshToken', 'bad');

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
        await get('/share/abc/check-my-permission');
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

  describe('403 handling', () => {
    it('403 on GET files/list: history.back() or / redirect', async () => {
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

    it('403 on GET admin/users: history.back() or / redirect', async () => {
      const origHistory = window.history;
      const origLocation = window.location;
      const backMock = jest.fn();
      delete window.history;
      window.history = { ...origHistory, length: 2, back: backMock };
      delete window.location;
      window.location = { href: origLocation.href };

      server.use(
        http.get('/api/admin/users', () =>
          HttpResponse.json({ errorCode: 'serverErrors.admin.forbidden' }, { status: 403 })
        )
      );

      await get('admin/users');

      expect(backMock).toHaveBeenCalled();
      window.history = origHistory;
      window.location = origLocation;
    });

    it('403 on POST files/upload: no redirect, throws error', async () => {
      const origLocation = window.location;
      const origHref = origLocation.href;
      const hrefSetter = jest.fn();
      delete window.location;
      window.location = { ...origLocation, href: origHref };
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

    it('403 on login: no redirect, throws error', async () => {
      const origLocation = window.location;
      delete window.location;
      window.location = { href: origLocation.href };

      server.use(
        http.post('/api/auth/login', () =>
          HttpResponse.json({ errorCode: 'serverErrors.auth.pendingApproval' }, { status: 403 })
        )
      );

      try {
        await post('/auth/login', { username: 'u', password: 'p' });
        throw new Error('Expected reject');
      } catch (err) {
        expect(err.response?.status).toBe(403);
        expect(window.location.href).not.toBe('/');
      } finally {
        window.location = origLocation;
      }
    });
  });
});
