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

const User = require('../../../../models/User');
const Settings = require('../../../../models/Settings');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
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
  // resolver, so the test harness resolver must expose the sync read too.
  getConfigSync: jest.fn().mockReturnValue('30m'),
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
