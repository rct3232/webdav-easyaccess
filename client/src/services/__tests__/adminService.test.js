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
  getAdminReports,
  getAdminReport,
  repairAdminReport,
  getAiAdminSummary,
  getAiReembedPreview,
  startAiReembed,
  getSettingsJournal,
  undoSettingsAction,
  probeLlmRole,
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
    it('returns the full response payload from GET /admin/config', async () => {
      get.mockResolvedValueOnce({
        data: {
          config: { PORT: { value: '5001', source: 'default', tier: 'T1', secret: false } },
        },
      });

      const result = await getConfigStatus();

      expect(get).toHaveBeenCalledWith('/admin/config');
      expect(result).toEqual({
        config: { PORT: { value: '5001', source: 'default', tier: 'T1', secret: false } },
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

      expect(post).toHaveBeenCalledWith(
        '/admin/config/test',
        {
          target: 'webdav',
          WEBDAV_URL: 'https://example.com/webdav',
          WEBDAV_USERNAME: 'user',
        },
        { maxRetries: 0 }
      );
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

  describe('getAdminReports', () => {
    it('returns the response data from GET /admin/reports', async () => {
      const payload = {
        reports: [
          { id: 2, kind: 'gc', status: 'ok', payload: { tier1: {} }, created_at: 'x' },
          { id: 1, kind: 'failsafe', status: 'partial', payload: null, created_at: 'y' },
        ],
      };
      get.mockResolvedValueOnce({ data: payload });

      const result = await getAdminReports();

      expect(get).toHaveBeenCalledWith('/admin/reports');
      expect(result).toEqual(payload);
      expect(Array.isArray(result.reports)).toBe(true);
    });

    it('rejects when request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getAdminReports()).rejects.toThrow();
    });
  });

  describe('getAdminReport', () => {
    it('returns the response data from GET /admin/reports/:id', async () => {
      const payload = {
        report: { id: 7, kind: 'cleanup', status: 'ok', payload: {}, created_at: 'z' },
      };
      get.mockResolvedValueOnce({ data: payload });

      const result = await getAdminReport(7);

      expect(get).toHaveBeenCalledWith('/admin/reports/7');
      expect(result).toEqual(payload);
      expect(result.report).toHaveProperty('id', 7);
    });

    it('propagates the 404 reportNotFound error like the siblings', async () => {
      const err = new Error('Request failed');
      err.response = {
        status: 404,
        data: {
          errorCode: 'serverErrors.admin.reportNotFound',
          params: { reportId: 99 },
        },
      };
      get.mockRejectedValueOnce(err);

      await expect(getAdminReport(99)).rejects.toBe(err);
    });
  });

  describe('repairAdminReport', () => {
    it('calls POST /admin/reports/:id/repair with { action } and returns the response data', async () => {
      const resultData = {
        messageCode: 'serverMessages.admin.reportRepaired',
        report: { id: 1, kind: 'failsafe', status: 'ok', payload: {}, created_at: 'a' },
        result: { backfilled: 3, nullCount: 0, errors: [] },
      };
      post.mockResolvedValueOnce({ data: resultData });

      const result = await repairAdminReport(1, { action: 'content_hash' });

      expect(post).toHaveBeenCalledWith('/admin/reports/1/repair', {
        action: 'content_hash',
        nodeId: undefined,
        repairAction: undefined,
      });
      expect(result).toEqual(resultData);
      expect(result).toHaveProperty('report');
    });

    it('sends nodeId and repairAction for the repair-sync delegation', async () => {
      post.mockResolvedValueOnce({ data: {} });

      await repairAdminReport(4, { action: 'repair-sync', nodeId: 12, repairAction: 'auto' });

      expect(post).toHaveBeenCalledWith('/admin/reports/4/repair', {
        action: 'repair-sync',
        nodeId: 12,
        repairAction: 'auto',
      });
    });

    it('sends nodeId for the perm-delete delegation', async () => {
      post.mockResolvedValueOnce({ data: {} });

      await repairAdminReport(4, { action: 'perm-delete', nodeId: 9 });

      expect(post).toHaveBeenCalledWith('/admin/reports/4/repair', {
        action: 'perm-delete',
        nodeId: 9,
        repairAction: undefined,
      });
    });

    it('propagates repair errors without normalization', async () => {
      const err = new Error('Request failed');
      err.response = {
        status: 400,
        data: { errorCode: 'serverErrors.admin.repairNotAvailable', params: {} },
      };
      post.mockRejectedValueOnce(err);

      await expect(repairAdminReport(2, { action: 'content_hash' })).rejects.toBe(err);
    });
  });

  describe('AI admin wrappers', () => {
    it('GETs the polled summary and read-only preview', async () => {
      get.mockResolvedValueOnce({ data: { pipeline: {} } });
      await expect(getAiAdminSummary()).resolves.toEqual({ pipeline: {} });
      expect(get).toHaveBeenCalledWith('/admin/ai/summary');

      get.mockResolvedValueOnce({ data: { plan: { union_count: 2 } } });
      await expect(getAiReembedPreview()).resolves.toEqual({ plan: { union_count: 2 } });
      expect(get).toHaveBeenCalledWith('/admin/ai/reembed/preview');
    });

    it('POSTs the launcher and returns its job/undo envelope', async () => {
      const payload = {
        job_ids: [1],
        enqueued: 1,
        generation: 2,
        undo: { action_id: 9 },
      };
      post.mockResolvedValueOnce({ data: payload });

      await expect(startAiReembed()).resolves.toEqual(payload);
      expect(post).toHaveBeenCalledWith('/admin/ai/reembed', {});
    });

    it('reads and undoes settings-domain journal rows', async () => {
      const feed = { actions: [{ action_id: 4, domain: 'settings' }] };
      get.mockResolvedValueOnce({ data: feed });
      await expect(getSettingsJournal()).resolves.toEqual(feed);
      expect(get).toHaveBeenCalledWith('/actions', { params: { domain: 'settings' } });

      post.mockResolvedValueOnce({ data: { status: 'undone' } });
      await expect(undoSettingsAction(4)).resolves.toEqual({ status: 'undone' });
      expect(post).toHaveBeenCalledWith('/actions/4/undo', {});
    });

    it('probes an LLM role through the config/test target', async () => {
      post.mockResolvedValueOnce({ data: { ok: true, role: 'chat' } });
      await expect(probeLlmRole('chat')).resolves.toEqual({ ok: true, role: 'chat' });
      expect(post).toHaveBeenCalledWith(
        '/admin/config/test',
        { target: 'llm', role: 'chat' },
        { maxRetries: 0 }
      );
    });
  });
});
