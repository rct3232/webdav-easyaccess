/**
 * adminService tests.
 * Verifies public API: correct endpoints and return shapes per spec.
 * @see docs/spec/client/services/adminService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post, put, del } from '../apiClient';

import {
  getPendingUsers,
  getUsers,
  getSettings,
  updateSettings,
  getConfig,
  getConfigStatus,
  updateConfig,
  approveUser,
  rejectUser,
  deleteUser,
  createUser,
  cleanupOrphaned,
  ensureHomeOwnerAdmin,
  testConfig,
  getAdminHealth,
  getPublicHealth,
} from '../adminService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

describe('adminService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPendingUsers', () => {
    it('returns array from GET /admin/users/pending', async () => {
      const pending = [{ id: 'p1', username: 'u1', status: 'pending' }];
      get.mockResolvedValueOnce({ data: pending });

      const result = await getPendingUsers();

      expect(get).toHaveBeenCalledWith('/admin/users/pending');
      expect(result).toEqual(pending);
      expect(Array.isArray(result)).toBe(true);
    });

    it('rejects when request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getPendingUsers()).rejects.toThrow();
    });
  });

  describe('getUsers', () => {
    it('returns array from GET /admin/users', async () => {
      const users = [{ id: '1', username: 'admin' }];
      get.mockResolvedValueOnce({ data: users });

      const result = await getUsers();

      expect(get).toHaveBeenCalledWith('/admin/users');
      expect(result).toEqual(users);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getSettings', () => {
    it('returns settings object from GET /admin/settings', async () => {
      const settings = { registration_enabled: 'true' };
      get.mockResolvedValueOnce({ data: settings });

      const result = await getSettings();

      expect(get).toHaveBeenCalledWith('/admin/settings');
      expect(result).toEqual(settings);
      expect(result).toHaveProperty('registration_enabled');
    });
  });

  describe('updateSettings', () => {
    it('calls PUT /admin/settings with settings body', async () => {
      put.mockResolvedValueOnce(undefined);

      await updateSettings({ registration_enabled: 'false' });

      expect(put).toHaveBeenCalledWith('/admin/settings', { registration_enabled: 'false' });
    });
  });

  describe('getConfig', () => {
    it('returns the config map from GET /admin/config', async () => {
      const config = {
        EMAIL_HOST: { value: 'smtp.gmail.com', source: 'db', tier: 'T2', secret: false },
        PORT: { value: '5001', source: 'default', tier: 'T1', secret: false },
      };
      get.mockResolvedValueOnce({ data: { config } });

      const result = await getConfig();

      expect(get).toHaveBeenCalledWith('/admin/config');
      expect(result).toEqual(config);
      expect(result.EMAIL_HOST).toHaveProperty('source', 'db');
    });

    it('returns an empty map when the response has no config payload', async () => {
      get.mockResolvedValueOnce({ data: {} });

      const result = await getConfig();

      expect(result).toEqual({});
    });

    it('rejects when request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getConfig()).rejects.toThrow();
    });
  });

  describe('getConfigStatus', () => {
    it('returns the full response payload including key_lost_warning', async () => {
      get.mockResolvedValueOnce({
        data: {
          config: { PORT: { value: '5001', source: 'default', tier: 'T1', secret: false } },
          key_lost_warning: true,
        },
      });

      const result = await getConfigStatus();

      expect(get).toHaveBeenCalledWith('/admin/config');
      expect(result).toEqual({
        config: { PORT: { value: '5001', source: 'default', tier: 'T1', secret: false } },
        key_lost_warning: true,
      });
    });
  });

  describe('updateConfig', () => {
    it('calls PUT /admin/config with { values } and returns the applied/restartRequired response', async () => {
      const resultData = {
        applied: ['EMAIL_HOST'],
        restartRequired: ['PORT'],
        messageCode: 'serverMessages.admin.configSaved',
      };
      put.mockResolvedValueOnce({ data: resultData });

      const result = await updateConfig({ EMAIL_HOST: 'smtp.example.com' });

      expect(put).toHaveBeenCalledWith('/admin/config', {
        values: { EMAIL_HOST: 'smtp.example.com' },
      });
      expect(result).toEqual(resultData);
      expect(result).toHaveProperty('restartRequired');
    });
  });

  describe('approveUser', () => {
    it('calls POST /admin/users/:id/approve', async () => {
      post.mockResolvedValueOnce(undefined);

      await approveUser('user-123');

      expect(post).toHaveBeenCalledWith('/admin/users/user-123/approve');
    });
  });

  describe('rejectUser', () => {
    it('calls POST /admin/users/:id/reject', async () => {
      post.mockResolvedValueOnce(undefined);

      await rejectUser('user-456');

      expect(post).toHaveBeenCalledWith('/admin/users/user-456/reject');
    });
  });

  describe('deleteUser', () => {
    it('calls DELETE /admin/users/:id', async () => {
      del.mockResolvedValueOnce(undefined);

      await deleteUser('user-789');

      expect(del).toHaveBeenCalledWith('/admin/users/user-789');
    });
  });

  describe('createUser', () => {
    it('calls POST /admin/users with username, email, password', async () => {
      post.mockResolvedValueOnce(undefined);

      await createUser({
        username: 'newuser',
        email: 'new@example.com',
        password: 'secret',
      });

      expect(post).toHaveBeenCalledWith('/admin/users', {
        username: 'newuser',
        email: 'new@example.com',
        password: 'secret',
      });
    });
  });

  describe('cleanupOrphaned', () => {
    it('returns result object from POST /admin/cleanup/orphaned', async () => {
      const resultData = { deleted: 3, errors: [] };
      post.mockResolvedValueOnce({ data: resultData });

      const result = await cleanupOrphaned();

      expect(post).toHaveBeenCalledWith('/admin/cleanup/orphaned', {});
      expect(result).toEqual(resultData);
      expect(result).toHaveProperty('deleted');
    });
  });

  describe('ensureHomeOwnerAdmin', () => {
    it('returns result object from POST /admin/permissions/ensure-home-owner-admin', async () => {
      const resultData = { updated: 1 };
      post.mockResolvedValueOnce({ data: resultData });

      const result = await ensureHomeOwnerAdmin();

      expect(post).toHaveBeenCalledWith('/admin/permissions/ensure-home-owner-admin', {});
      expect(result).toEqual(resultData);
    });
  });

  describe('testConfig', () => {
    it('calls POST /admin/config/test with { target, ...values } and returns the response data', async () => {
      const resultData = { ok: true };
      post.mockResolvedValueOnce({ data: resultData });

      const result = await testConfig('webdav', {
        WEBDAV_URL: 'https://example.com/webdav',
        WEBDAV_USERNAME: 'user',
      });

      expect(post).toHaveBeenCalledWith('/admin/config/test', {
        target: 'webdav',
        WEBDAV_URL: 'https://example.com/webdav',
        WEBDAV_USERNAME: 'user',
      });
      expect(result).toEqual(resultData);
    });

    it('normalizes an error body into { ok: false, errorCode, message, reason }', async () => {
      const err = new Error('Request failed');
      err.response = {
        data: {
          ok: false,
          errorCode: 'serverErrors.setup.test.pg.unreachable',
          message: 'Connection test failed',
          reason: 'ECONNREFUSED',
        },
      };
      post.mockRejectedValueOnce(err);

      await expect(
        testConfig('webdav', { WEBDAV_URL: 'https://bad.example.com' })
      ).rejects.toMatchObject({
        message: 'Connection test failed',
        errorCode: 'serverErrors.setup.test.pg.unreachable',
        reason: 'ECONNREFUSED',
      });
    });

    it('falls back to a generic error when the error body has no payload', async () => {
      post.mockRejectedValueOnce(new Error('Network down'));

      await expect(testConfig('s3', { S3_BUCKET: 'bucket' })).rejects.toThrow('Network down');
    });
  });

  describe('getAdminHealth', () => {
    it('returns the backends snapshot from GET /admin/health', async () => {
      const health = {
        backends: {
          postgresql: { status: 'ok' },
          s3: { status: 'unknown' },
          webdav: { status: 'ok' },
        },
      };
      get.mockResolvedValueOnce({ data: health });

      const result = await getAdminHealth();

      expect(get).toHaveBeenCalledWith('/admin/health');
      expect(result).toEqual(health);
      expect(result).toHaveProperty('backends');
      expect(result.backends.postgresql).toHaveProperty('status', 'ok');
    });
  });

  describe('getPublicHealth', () => {
    it('returns backends status strings from GET /health', async () => {
      const health = {
        status: 'ok',
        messageCode: 'serverMessages.api.healthOk',
        backends: { postgresql: 'ok', s3: 'unknown', webdav: 'ok' },
      };
      get.mockResolvedValueOnce({ data: health });

      const result = await getPublicHealth();

      expect(get).toHaveBeenCalledWith('/health');
      expect(result).toEqual(health);
      expect(result.backends).toEqual({ postgresql: 'ok', s3: 'unknown', webdav: 'ok' });
    });
  });
});
