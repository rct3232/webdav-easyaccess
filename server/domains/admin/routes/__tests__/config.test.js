/**
 * Admin config routes tests.
 * @see docs/api.md, docs/spec/server/routes/config.md
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../../models/User', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../../models/Settings', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  getAll: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../../infrastructure/backendProbe', () => ({
  ...jest.requireActual('../../../../infrastructure/backendProbe'),
  runProbe: jest.fn(),
}));
jest.mock('../../../../infrastructure/backendHealth', () => ({
  getBackendHealth: jest.fn(),
}));

const User = require('../../../../models/User');
const Settings = require('../../../../models/Settings');
const { runProbe } = require('../../../../infrastructure/backendProbe');
const { getBackendHealth } = require('../../../../infrastructure/backendHealth');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { generateToken } = require('../../../../utils/auth');
const { setSharedResolver } = require('../../../../infrastructure/configResolver');
const { decryptSecret, encryptSecret } = require('../../../../utils/configEncryption');
const { errorHandler } = require('../../../../utils/errorHandler');
const setupModeGuard = require('../../../../middleware/setupModeGuard');
const configRoutes = require('../../routes/config');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', setupModeGuard(), configRoutes);
  app.use(errorHandler);
  return app;
}

const fakeResolver = {
  getEffectiveConfig: jest.fn(),
  invalidateCache: jest.fn(),
  // generateToken (utils/auth) reads JWT_EXPIRES_IN lazily through the shared
  // resolver, so the test harness resolver must expose the sync read too. The
  // config/test route also resolves masked secrets through getConfigSync;
  // returning undefined keeps masked effective values as '****'.
  getConfigSync: jest.fn((key) => (key === 'JWT_EXPIRES_IN' ? '30m' : undefined)),
};

const mockHealth = {
  report: jest.fn(),
  getHealth: jest.fn(),
};

function buildToken() {
  return generateToken({ id: 1, username: 'admin', token_version: 0, is_admin: 1 });
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.encrypt_secret_key;
  fakeResolver.getEffectiveConfig.mockResolvedValue({});
  setSharedResolver(fakeResolver);
  getBackendHealth.mockReturnValue(mockHealth);
  User.findById.mockResolvedValue({ id: 1, is_admin: 1 });
  app = buildApp();
});

afterEach(() => {
  setSharedResolver(null);
  delete process.env.encrypt_secret_key;
});

describe('GET /api/admin/config', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/config');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns effective config with masked secrets and source/tier', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({
      EMAIL_HOST: { value: 'smtp.gmail.com', source: 'db', tier: 'T1', secret: false },
      EMAIL_PASSWORD: { value: '****', source: 'db', tier: 'T1', secret: true },
      CORS_ORIGINS: { value: '', source: 'default', tier: 'T2', secret: false },
      PORT: { value: '5001', source: 'default', tier: 'T1', secret: false },
    });

    const res = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({
      EMAIL_HOST: { value: 'smtp.gmail.com', source: 'db', tier: 'T1', secret: false },
      EMAIL_PASSWORD: { value: '****', source: 'db', tier: 'T1', secret: true },
      CORS_ORIGINS: { value: '', source: 'default', tier: 'T2', secret: false },
      PORT: { value: '5001', source: 'default', tier: 'T1', secret: false },
    });
    expect(res.body.key_lost_warning).toBe(false);
    expect(fakeResolver.getEffectiveConfig).toHaveBeenCalledTimes(1);
  });

  it('flags key_lost_warning when encrypted rows exist without the master key', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({});
    Settings.getAll.mockResolvedValue({
      EMAIL_PASSWORD: JSON.stringify(encryptSecret('hunter2', 'some-master-key')),
    });
    delete process.env.encrypt_secret_key;

    const res = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.key_lost_warning).toBe(true);
  });

  it('does not flag key_lost_warning when the master key is present', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({});
    Settings.getAll.mockResolvedValue({
      EMAIL_PASSWORD: JSON.stringify(encryptSecret('hunter2', 'some-master-key')),
    });
    process.env.encrypt_secret_key = 'some-master-key';

    const res = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.key_lost_warning).toBe(false);
  });
});

describe('PUT /api/admin/config', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .send({ values: { EMAIL_HOST: 'smtp.gmail.com' } });
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('rejects a non-object values payload', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: 'not-an-object' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.configInvalidPayload);
    expect(Settings.set).not.toHaveBeenCalled();
  });

  it('rejects an unknown key with 400 configUnknownKey', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { NOT_A_REGISTRY_KEY: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.configUnknownKey);
    expect(res.body.params).toEqual({ key: 'NOT_A_REGISTRY_KEY' });
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
  });

  it('rejects a T0 key with 400 configT0Protected (not 403)', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { JWT_SECRET: 'new-secret' } });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.configT0Protected);
    expect(res.body.params).toEqual({ key: 'JWT_SECRET' });
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
  });

  it('writes a plaintext T2 key, invalidates cache, reports applied', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { CORS_ORIGINS: 'https://app.example.com' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledTimes(1);
    expect(Settings.set).toHaveBeenCalledWith('CORS_ORIGINS', 'https://app.example.com');
    expect(fakeResolver.invalidateCache).toHaveBeenCalledWith(['CORS_ORIGINS']);
    expect(res.body).toEqual({
      applied: ['CORS_ORIGINS'],
      restartRequired: [],
      messageCode: SERVER_MESSAGE_CODES.admin.configSaved,
    });
  });

  it('reports restartRequired for a written T1 key', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { PORT: '6000' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledWith('PORT', '6000');
    expect(fakeResolver.invalidateCache).toHaveBeenCalledWith(['PORT']);
    expect(res.body).toEqual({
      applied: [],
      restartRequired: ['PORT'],
      messageCode: SERVER_MESSAGE_CODES.admin.configSaved,
    });
  });

  it('splits applied vs restartRequired for a mixed T2+T1 write', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { CORS_ORIGINS: 'https://app.example.com', PORT: '6000' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledTimes(2);
    expect(fakeResolver.invalidateCache).toHaveBeenCalledWith(['CORS_ORIGINS', 'PORT']);
    expect(res.body.applied).toEqual(['CORS_ORIGINS']);
    expect(res.body.restartRequired).toEqual(['PORT']);
  });

  it('rejects a write to an env-sourced key with 400 configEnvSourcedProtected', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({
      PORT: { value: '5001', source: 'env', tier: 'T1', secret: false },
    });

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { PORT: '6000' } });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.configEnvSourcedProtected);
    expect(res.body.params).toEqual({ key: 'PORT' });
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
  });

  it('writes a DB-sourced T1 key (source db stays writable)', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({
      PORT: { value: '5001', source: 'db', tier: 'T1', secret: false },
    });

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { PORT: '6000' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledWith('PORT', '6000');
    expect(res.body.restartRequired).toEqual(['PORT']);
  });

  it('skips masked/blank/null secret values (keeps existing ciphertext)', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { EMAIL_PASSWORD: '****' } });

    expect(res.status).toBe(200);
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      applied: [],
      restartRequired: [],
      messageCode: SERVER_MESSAGE_CODES.admin.configSaved,
    });
  });

  it('skips empty-string and null secret values as well', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { EMAIL_PASSWORD: '', WEBDAV_PASSWORD: null } });

    expect(res.status).toBe(200);
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
  });

  it('encrypts a new secret value and stores a JSON-stringified payload', async () => {
    process.env.encrypt_secret_key = 'test-master-key';

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { EMAIL_PASSWORD: 'hunter2' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledTimes(1);
    const [calledKey, storedValue] = Settings.set.mock.calls[0];
    expect(calledKey).toBe('EMAIL_PASSWORD');
    const payload = JSON.parse(storedValue);
    expect(payload.enc).toBe('aes-256-gcm');
    expect(payload.iv).toEqual(expect.any(String));
    expect(payload.tag).toEqual(expect.any(String));
    expect(payload.data).toEqual(expect.any(String));
    expect(decryptSecret(payload, 'test-master-key')).toBe('hunter2');
    expect(fakeResolver.invalidateCache).toHaveBeenCalledWith(['EMAIL_PASSWORD']);
    expect(res.body.restartRequired).toEqual(['EMAIL_PASSWORD']);
  });

  it('reports applied for a written T2 secret key', async () => {
    process.env.encrypt_secret_key = 'test-master-key';

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { THUMBNAIL_TOKEN_SECRET: 'tok-secret' } });

    expect(res.status).toBe(200);
    expect(Settings.set).toHaveBeenCalledTimes(1);
    const [calledKey, storedValue] = Settings.set.mock.calls[0];
    expect(calledKey).toBe('THUMBNAIL_TOKEN_SECRET');
    expect(decryptSecret(JSON.parse(storedValue), 'test-master-key')).toBe('tok-secret');
    expect(fakeResolver.invalidateCache).toHaveBeenCalledWith(['THUMBNAIL_TOKEN_SECRET']);
    expect(res.body.applied).toEqual(['THUMBNAIL_TOKEN_SECRET']);
  });

  it('returns 500 configEncryptKeyMissing when a new secret value has no master key', async () => {
    delete process.env.encrypt_secret_key;

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ values: { EMAIL_PASSWORD: 'hunter2' } });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.configEncryptKeyMissing);
    expect(Settings.set).not.toHaveBeenCalled();
    expect(fakeResolver.invalidateCache).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/config/test', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/admin/config/test')
      .send({ target: 's3', S3_BUCKET: 'my-bucket' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
    expect(runProbe).not.toHaveBeenCalled();
  });

  it('merges pending values over effective config, probes s3, and reports ok', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({
      S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
      AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
      AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      S3_ENDPOINT: { value: undefined, source: 'default', tier: 'T1', secret: false },
    });
    runProbe.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/admin/config/test')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ target: 's3', S3_BUCKET: 'pending-bucket' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(runProbe).toHaveBeenCalledWith('s3', {
      bucket: 'pending-bucket',
      region: 'us-east-1',
      secretAccessKey: '****',
    });
    expect(mockHealth.report).toHaveBeenCalledWith('s3', { ok: true });
  });

  it('returns 400 ok:false with classified errorCode and reason when the probe throws', async () => {
    fakeResolver.getEffectiveConfig.mockResolvedValue({});
    const err = new Error('Connection test failed');
    err.status = 400;
    err.errorCode = 'serverErrors.setup.test.s3.accessDenied';
    err.reason = 'AccessDenied';
    runProbe.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/admin/config/test')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ target: 's3', S3_BUCKET: 'my-bucket' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: 'serverErrors.setup.test.s3.accessDenied',
      message: 'Connection test failed',
      reason: 'AccessDenied',
    });
    expect(mockHealth.report).toHaveBeenCalledWith('s3', {
      ok: false,
      code: 'auth',
      reason: 'AccessDenied',
    });
  });
});

describe('GET /api/admin/health', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/health');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with the backend health snapshot', async () => {
    mockHealth.getHealth.mockReturnValue({
      postgresql: {
        status: 'ok',
        code: undefined,
        reason: undefined,
        hint: undefined,
        lastCheckedAt: 1725000000000,
        firstFailedAt: undefined,
        consecutiveFailures: 0,
      },
      s3: {
        status: 'unknown',
        code: undefined,
        reason: undefined,
        hint: undefined,
        lastCheckedAt: undefined,
        firstFailedAt: undefined,
        consecutiveFailures: 0,
      },
      webdav: {
        status: 'fail',
        code: 'unreachable',
        reason: 'ECONNREFUSED',
        hint: 'Cannot reach the WebDAV server',
        lastCheckedAt: 1725000000000,
        firstFailedAt: 1724999900000,
        consecutiveFailures: 3,
      },
    });

    const res = await request(app)
      .get('/api/admin/health')
      .set('Authorization', `Bearer ${buildToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.backends.postgresql.status).toBe('ok');
    expect(res.body.backends.s3.status).toBe('unknown');
    expect(res.body.backends.webdav.status).toBe('fail');
    expect(res.body.backends.webdav.code).toBe('unreachable');
    expect(res.body.backends.webdav.consecutiveFailures).toBe(3);
  });
});
