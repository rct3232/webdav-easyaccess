'use strict';

/**
 * Setup routes unit/integration tests.
 * Builds a minimal express app mounting the setup router directly (T5 will
 * mount it in server/index.js). envFileWriter is mocked so the test can assert
 * exactly which (T0) keys reach .env; the metadata store is a real isolated
 * sqlite DB (createTestDatabase). SQLite-only: the suite self-skips under
 * test:ci:pg (RUN_UNDER_PG), where the storage backend is postgresql.
 * @see docs/spec/server/routes/setup.md
 */
const mockWriteEnv = jest.fn();
jest.mock('../../../infrastructure/envFileWriter', () => {
  const actual = jest.requireActual('../../../infrastructure/envFileWriter');
  return { ...actual, writeEnv: mockWriteEnv };
});

const mockWebdavTestConnection = jest.fn();
jest.mock('../../../infrastructure/webdavTest', () => ({
  testConnection: mockWebdavTestConnection,
}));

jest.mock('pg', () => ({ Client: jest.fn() }));

const mockS3BlobStore = jest.fn();
jest.mock('../../../infrastructure/adapters/blobstore/S3BlobStore', () => mockS3BlobStore);

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createTestDatabase } = require('../../../test-utils');
const { initMetadataStore } = require('../../../store/bootstrap');
const User = require('../../../models/User');
const Settings = require('../../../models/Settings');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const { errorHandler } = require('../../../utils/errorHandler');
const requestLogger = require('../../../middleware/requestLogger');
const { Client: MockPgClient } = require('pg');

// This suite drives the setup wizard against a real isolated sqlite metadata
// store (SQLite-only). Under test:ci:pg the storage backend boots as
// postgresql, where initMetadataStore would reach storage.getPgPool() -> the
// jest-mocked 'pg' (Client only, no Pool) and throw. So on a PG backend run
// the whole suite self-declares SQLite-only: every test is skipped and the
// suite-level DB bootstrap is bypassed.
// Backend selection is presence-based: PostgreSQL only when all four WEA_DB_*
// identity keys are present in the environment.
const DB_IDENTITY_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];
const RUN_UNDER_PG = DB_IDENTITY_KEYS.every((key) => process.env[key]);

// Bind describe to skip when the storage backend is postgresql (SQLite-only suite).
const describeIfSqlite = RUN_UNDER_PG ? describe.skip : describe;

const setupRouter = require('../routes');
const setupCore = require('../setupCore');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-routes-'));
const ADMIN_PASSWORD = 'admin-old-password';

const WIZARD_ENV_KEYS = [
  'WEA_FILE_STORAGE',
  'PORT',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'WEA_DB_HOST',
  'WEA_DB_PORT',
  'WEA_DB_DATABASE',
  'WEA_DB_USER',
  'WEA_DB_PASSWORD',
  'WEA_DB_SSL',
  'WEA_DB_MAX',
  'S3_BUCKET',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'WEBDAV_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
  'CORS_ORIGINS',
  'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'EMAIL_SECURE',
  'EMAIL_FROM_NAME',
  'DOTENV_CONFIG_PATH',
  'WEA_SQLITE_PATH',
];
const SAVED_ENV = {};

function setIncompleteBaseline() {
  for (const key of WIZARD_ENV_KEYS) {
    if (key !== 'WEA_SQLITE_PATH' && key !== 'WEA_FILE_STORAGE') delete process.env[key];
  }
  // No WEA_DB_* identity key set → the metadata backend defaults to sqlite.
  for (const key of DB_IDENTITY_KEYS) delete process.env[key];
  delete process.env.WEA_STORAGE_BACKEND;
  process.env.WEA_FILE_STORAGE = 's3';
}

function setCompleteWebdavEnv() {
  setIncompleteBaseline();
  process.env.WEA_FILE_STORAGE = 'webdav';
  process.env.WEBDAV_URL = 'https://dav.example.com';
  process.env.WEBDAV_USERNAME = 'dav-user';
  process.env.WEBDAV_PASSWORD = 'dav-pass';
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestLogger());
  app.use('/api/setup', setupRouter);
  app.use(errorHandler);
  return app;
}

function makePgClient() {
  return {
    connect: jest.fn().mockResolvedValue(),
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(),
  };
}

function makeNoSuchKeyError() {
  const err = new Error('The specified key does not exist.');
  err.name = 'NoSuchKey';
  err.code = 'NoSuchKey';
  return err;
}

let mockS3HeadBlob;
let mockS3ListObjects;

function setupS3HeadBlob(rejection) {
  mockS3HeadBlob = jest.fn();
  if (rejection) mockS3HeadBlob.mockRejectedValue(rejection);
  setupS3ListObjects();
  mockS3BlobStore.mockImplementation(() => ({
    headBlob: mockS3HeadBlob,
    client: { send: mockS3ListObjects },
  }));
}

function setupS3ListObjects(rejection) {
  mockS3ListObjects = jest.fn();
  if (rejection) mockS3ListObjects.mockRejectedValue(rejection);
  else mockS3ListObjects.mockResolvedValue({ Contents: [] });
}

function makeEnvPath(label) {
  return path.join(TMP_ROOT, `.env-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

let app;
let dbCleanup;
let adminUser;

beforeAll(async () => {
  if (RUN_UNDER_PG) return;

  for (const key of WIZARD_ENV_KEYS) SAVED_ENV[key] = process.env[key];

  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  await initMetadataStore();
  adminUser = await User.create('admin', 'admin@webdav.local', ADMIN_PASSWORD, true);

  app = buildApp();
});

afterAll(async () => {
  if (RUN_UNDER_PG) return;

  for (const key of WIZARD_ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  await dbCleanup?.();
});

beforeEach(async () => {
  setIncompleteBaseline();
  await User.updatePassword(adminUser.id, ADMIN_PASSWORD);
  jest.clearAllMocks();
  mockWebdavTestConnection.mockResolvedValue({ success: true });
  MockPgClient.mockImplementation(() => makePgClient());
  setupS3HeadBlob(makeNoSuchKeyError());
});

describeIfSqlite('GET /api/setup/status', () => {
  it('returns incomplete status with missing s3 keys and masked current values', async () => {
    setIncompleteBaseline();
    const res = await request(app).get('/api/setup/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      setup_complete: false,
      missing: ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    });
    expect(res.body.current).toMatchObject({
      WEA_FILE_STORAGE: 's3',
    });
    // Metadata-backend T0 keys are never part of `current` (wizard-writable only).
    expect(res.body.current.WEA_DB_HOST).toBeUndefined();
    expect(res.body.current.JWT_SECRET).toBeUndefined();
  });

  it('returns complete status when the effective config is fully resolvable', async () => {
    setCompleteWebdavEnv();
    const res = await request(app).get('/api/setup/status');

    expect(res.status).toBe(200);
    expect(res.body.setup_complete).toBe(true);
    expect(res.body.missing).toEqual([]);
    expect(res.body.current.WEBDAV_URL).toBe('https://dav.example.com');
  });

  it('masks secrets in the current block', async () => {
    setIncompleteBaseline();
    process.env.JWT_SECRET = 'super-secret';
    process.env.WEBDAV_PASSWORD = 'webdav-secret';

    const res = await request(app).get('/api/setup/status');

    expect(res.body.current.JWT_SECRET).toBe('****');
    expect(res.body.current.WEBDAV_PASSWORD).toBe('****');
  });

  it('does not return a key_lost_warning field (masking is presentation-only)', async () => {
    setIncompleteBaseline();
    const getAllSpy = jest.spyOn(Settings, 'getAll').mockResolvedValue({
      EMAIL_PASSWORD: 'smtp-secret',
    });

    try {
      const res = await request(app).get('/api/setup/status');

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('key_lost_warning');
      expect(res.body.current.EMAIL_PASSWORD).toBe('****');
    } finally {
      getAllSpy.mockRestore();
    }
  });
});

describeIfSqlite('POST /api/setup/apply', () => {
  let settingsSetSpy;
  let invalidateSpy;

  beforeEach(() => {
    settingsSetSpy = jest
      .spyOn(Settings, 'set')
      .mockImplementation(async () => ({ success: true }));
    invalidateSpy = jest.spyOn(getSharedResolver(), 'invalidateCache');
  });

  afterEach(() => {
    settingsSetSpy.mockRestore();
    invalidateSpy.mockRestore();
  });

  it('sqlite + webdav: writes only T0 keys to .env, non-T0 keys to the DB (secrets plaintext), updates the admin password', async () => {
    const envPath = makeEnvPath('sqlite-webdav');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 'webdav',
          url: 'https://dav.example.com',
          username: 'dav-user',
          password: 'dav-pass',
          authType: 'auto',
        },
        admin: { password: 'new-admin-pass' },
        jwt: { secret: 'super-secret-jwt', expiresIn: '30m' },
        server: { port: '5001', corsOrigins: 'http://localhost:3000' },
        email: {
          host: 'smtp.example.com',
          port: '587',
          user: 'mail-user',
          password: 'mail-pass',
          secure: false,
          fromName: 'WebDAV',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    expect(mockWriteEnv).toHaveBeenCalledTimes(1);
    const [, envEntries] = mockWriteEnv.mock.calls[0];
    expect(Object.keys(envEntries).sort()).toEqual(['JWT_SECRET']);
    expect(envEntries.JWT_SECRET).toBe('super-secret-jwt');
    expect(envEntries).not.toHaveProperty('encrypt_secret_key');
    // Metadata-backend T0 keys (the WEA_DB_* block) are never written to .env.
    expect(envEntries).not.toHaveProperty('WEA_DB_HOST');
    expect(envEntries).not.toHaveProperty('WEA_DB_PASSWORD');
    expect(envEntries).not.toHaveProperty('WEA_FILE_STORAGE');
    expect(envEntries).not.toHaveProperty('WEBDAV_URL');
    expect(envEntries).not.toHaveProperty('EMAIL_HOST');
    expect(envEntries).not.toHaveProperty('ADMIN_DEFAULT_PASSWORD');

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(Object.keys(written).sort()).toEqual([
      'CORS_ORIGINS',
      'EMAIL_FROM_NAME',
      'EMAIL_HOST',
      'EMAIL_PASSWORD',
      'EMAIL_PORT',
      'EMAIL_SECURE',
      'EMAIL_USER',
      'JWT_EXPIRES_IN',
      'PORT',
      'WEA_FILE_STORAGE',
      'WEBDAV_AUTH_TYPE',
      'WEBDAV_PASSWORD',
      'WEBDAV_URL',
      'WEBDAV_USERNAME',
    ]);
    expect(written.WEA_FILE_STORAGE).toBe('webdav');
    expect(written.WEBDAV_URL).toBe('https://dav.example.com');
    expect(written.WEBDAV_USERNAME).toBe('dav-user');
    expect(written.WEBDAV_AUTH_TYPE).toBe('auto');
    expect(written.PORT).toBe('5001');
    expect(written.CORS_ORIGINS).toBe('http://localhost:3000');
    expect(written.JWT_EXPIRES_IN).toBe('30m');
    expect(written.EMAIL_HOST).toBe('smtp.example.com');
    expect(written.EMAIL_PORT).toBe('587');
    expect(written.EMAIL_USER).toBe('mail-user');
    expect(written.EMAIL_SECURE).toBe('false');
    expect(written.EMAIL_FROM_NAME).toBe('WebDAV');
    expect(written.WEBDAV_PASSWORD).toBe('dav-pass');
    expect(written.EMAIL_PASSWORD).toBe('mail-pass');
    // Metadata-backend T0 keys are never stored as settings rows.
    expect(written).not.toHaveProperty('WEA_DB_HOST');
    expect(written).not.toHaveProperty('WEA_DB_PASSWORD');
    expect(written).not.toHaveProperty('JWT_SECRET');

    const admin = await User.findByUsername('admin');
    expect(admin).toBeTruthy();
    expect(await bcrypt.compare('new-admin-pass', admin.password)).toBe(true);
    expect(await bcrypt.compare(ADMIN_PASSWORD, admin.password)).toBe(false);

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('sqlite + webdav: empty-string optional server/email ports are tolerated and PORT/EMAIL_PORT are not stored', async () => {
    const envPath = makeEnvPath('sqlite-webdav-empty-port');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 'webdav',
          url: 'https://dav.example.com',
          username: 'dav-user',
          password: 'dav-pass',
          authType: 'auto',
        },
        admin: { password: 'new-admin-pass' },
        jwt: { secret: 'super-secret-jwt', expiresIn: '30m' },
        server: { port: '', corsOrigins: '' },
        email: { host: '', port: '', user: '', password: '', secure: false, fromName: '' },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    const [, envEntries] = mockWriteEnv.mock.calls[0];
    expect(Object.keys(envEntries).sort()).toEqual(['JWT_SECRET']);
    expect(envEntries).not.toHaveProperty('encrypt_secret_key');
    expect(envEntries).not.toHaveProperty('WEA_DB_HOST');
    expect(envEntries).not.toHaveProperty('PORT');
    expect(envEntries).not.toHaveProperty('EMAIL_PORT');

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written).not.toHaveProperty('PORT');
    expect(written).not.toHaveProperty('EMAIL_PORT');
    expect(written).not.toHaveProperty('EMAIL_HOST');
    expect(written).not.toHaveProperty('CORS_ORIGINS');
    expect(written.WEA_FILE_STORAGE).toBe('webdav');
    expect(written.WEBDAV_URL).toBe('https://dav.example.com');
    expect(written.JWT_EXPIRES_IN).toBe('30m');
    expect(written.EMAIL_SECURE).toBe('false');
  });

  it('sqlite + s3: a masked (unchanged) secret is dropped and keeps its existing stored value', async () => {
    const envPath = makeEnvPath('sqlite-s3-masked');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 's3',
          bucket: 'webdav-temp',
          region: 'us-east-1',
          accessKeyId: 'admin',
          secretAccessKey: '****',
          endpoint: 'http://10.0.0.104:9000',
        },
        admin: { password: 'new-admin-pass' },
        jwt: { secret: 'super-secret-jwt', expiresIn: '30m' },
        server: { port: '5001', corsOrigins: '' },
        email: { host: '', port: '', user: '', password: '', secure: false, fromName: '' },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(written.S3_BUCKET).toBe('webdav-temp');
    expect(written.AWS_ACCESS_KEY_ID).toBe('admin');
    expect(written.S3_ENDPOINT).toBe('http://10.0.0.104:9000');
  });

  it('postgresql metadata backend is rejected 400 with fields.metadata = notAllowed and a clear message', async () => {
    const envPath = makeEnvPath('pg-masked-password');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: {
          backend: 'postgresql',
          host: 'db.local',
          port: '5433',
          database: 'webdav',
          user: 'pg-user',
          password: '****',
          ssl: false,
        },
        file: {
          backend: 's3',
          bucket: 'wea-bucket',
          region: 'us-east-1',
          accessKeyId: 'AKIAX',
          secretAccessKey: 's3-secret',
          endpoint: 'http://localhost:9010',
        },
        admin: { password: 'pg-admin-pass' },
        jwt: { secret: 'jwt-pg' },
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.setup.invalidPayload');
    expect(res.body.fields).toEqual({ metadata: 'notAllowed' });
    expect(res.body.message).toContain('environment variables');

    // Rejected before any write: .env untouched, DB untouched, no PG connection.
    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(settingsSetSpy).not.toHaveBeenCalled();
    expect(MockPgClient).not.toHaveBeenCalled();
  });

  it('postgresql metadata is rejected even with a complete payload and writes nothing to .env or the DB', async () => {
    const envPath = makeEnvPath('pg-s3');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: {
          backend: 'postgresql',
          host: 'db.local',
          port: '5433',
          database: 'webdav',
          user: 'pg-user',
          password: 'pg-pass',
          ssl: true,
          max: '20',
        },
        file: {
          backend: 's3',
          bucket: 'wea-bucket',
          region: 'us-east-1',
          accessKeyId: 'AKIAX',
          secretAccessKey: 's3-secret',
          endpoint: 'http://localhost:9010',
        },
        admin: { password: 'pg-admin-pass' },
        jwt: { secret: 'jwt-pg' },
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.setup.invalidPayload');
    expect(res.body.fields).toEqual({ metadata: 'notAllowed' });

    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(settingsSetSpy).not.toHaveBeenCalled();
    expect(MockPgClient).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();

    const admin = await User.findByUsername('admin');
    expect(admin).toBeTruthy();
    expect(await bcrypt.compare(ADMIN_PASSWORD, admin.password)).toBe(true);
  });

  it('returns 403 setup.complete when setup is already complete', async () => {
    setCompleteWebdavEnv();
    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
        admin: { password: 'whatever' },
        jwt: { secret: 's' },
      });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.complete);
  });

  it('accepts an empty jwt block (blank secret) and writes no .env partition', async () => {
    const envPath = makeEnvPath('sqlite-webdav-no-jwt');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 'webdav',
          url: 'https://dav.example.com',
          username: 'u',
          password: 'p',
        },
        admin: { password: 'new-admin-pass' },
        jwt: { secret: '' },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    // No supplied JWT secret -> the T0 .env partition is empty and the .env
    // write is skipped entirely (JWT_SECRET absent; ephemeral per boot).
    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(fs.existsSync(envPath)).toBe(false);

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written.WEA_FILE_STORAGE).toBe('webdav');
    expect(written.WEBDAV_URL).toBe('https://dav.example.com');
    expect(written).not.toHaveProperty('JWT_SECRET');
    expect(written).not.toHaveProperty('JWT_EXPIRES_IN');

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('new-admin-pass', admin.password)).toBe(true);
  });

  it('accepts a payload with no jwt block at all', async () => {
    const envPath = makeEnvPath('sqlite-webdav-no-jwt-block');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 'webdav',
          url: 'https://dav.example.com',
          username: 'u',
          password: 'p',
        },
        admin: { password: 'new-admin-pass' },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });
    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(fs.existsSync(envPath)).toBe(false);

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written).not.toHaveProperty('JWT_SECRET');
  });

  it('returns 400 per-field for missing s3 keys and an unknown key', async () => {
    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite', foo: 'bar' },
        file: { backend: 's3', bucket: 'wea-bucket' },
        admin: { password: 'pass' },
        jwt: { secret: 's' },
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.setup.invalidPayload');
    expect(res.body.fields['metadata.foo']).toBe('unknown');
    expect(res.body.fields['file.region']).toBe('required');
    expect(res.body.fields['file.accessKeyId']).toBe('required');
    expect(res.body.fields['file.secretAccessKey']).toBe('required');
  });

  it('returns 400 per-field for an invalid server port and an unknown top-level key', async () => {
    const res = await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
        admin: { password: 'pass' },
        jwt: { secret: 's' },
        server: { port: '99999' },
        unexpected: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.fields['server.port']).toBe('invalid');
    expect(res.body.fields.unexpected).toBe('unknown');
  });
});

describeIfSqlite('POST /api/setup/test', () => {
  it('postgresql: 200 ok:true on a successful connection', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'p',
      ssl: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(MockPgClient).toHaveBeenCalledTimes(1);
    expect(MockPgClient.mock.calls[0][0]).toMatchObject({
      host: 'localhost',
      port: 5432,
      database: 'webdav',
      user: 'u',
      password: 'p',
      ssl: false,
    });
  });

  it('postgresql: 4xx ok:false with errorCode pg.unreachable and reason when the connection is refused', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    err.code = 'ECONNREFUSED';
    err.errno = -111;
    err.address = '127.0.0.1';
    err.port = 5432;
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'p',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.pg.unreachable',
      message: 'Connection test failed',
      reason: 'ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('postgresql: 4xx errorCode pg.authFailed on pg code 28P01', async () => {
    const err = new Error('password authentication failed for user "u"');
    err.code = '28P01';
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'wrong',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.pg.authFailed',
      message: 'Connection test failed',
      reason: '28P01',
    });
  });

  it('postgresql: 4xx errorCode pg.databaseMissing on pg code 3D000', async () => {
    const err = new Error('database "webdav" does not exist');
    err.code = '3D000';
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'p',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.pg.databaseMissing',
      message: 'Connection test failed',
      reason: '3D000',
    });
  });

  it('postgresql: 4xx generic test.failed with reason for unclassified errors', async () => {
    const err = new Error('unexpected driver error');
    err.code = 'XX000';
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'p',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.failed',
      message: 'Connection test failed',
      reason: 'XX000',
    });
  });

  it('postgresql: reason is trimmed to 200 chars max', async () => {
    const err = new Error('driver detail '.repeat(40));
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
      port: '5432',
      database: 'webdav',
      user: 'u',
      password: 'p',
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.setup.test.failed');
    expect(res.body.reason).toBeDefined();
    expect(res.body.reason.length).toBeLessThanOrEqual(200);
  });

  it('s3: 200 ok:true when the probe hits a missing random key (NoSuchKey)', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
      endpoint: 'http://localhost:9010',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const probeKey = mockS3HeadBlob.mock.calls[0][0];
    expect(probeKey).toMatch(/^__wea_setup_probe_/);
    expect(mockS3BlobStore.mock.calls[0][0]).toMatchObject({
      bucket: 'wea-bucket',
      region: 'us-east-1',
      endpoint: 'http://localhost:9010',
    });
  });

  it('s3: 200 ok:true when the probe hits a missing key reported as NotFound (real AWS/MinIO 404)', async () => {
    const err = new Error('Not Found');
    err.name = 'NotFound';
    err.$metadata = { httpStatusCode: 404 };
    setupS3HeadBlob(err);

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('s3: 4xx errorCode s3.accessDenied and reason on HTTP 403/AccessDenied', async () => {
    const err = new Error('Access Denied');
    err.name = 'AccessDenied';
    err.code = 'AccessDenied';
    err.$metadata = { httpStatusCode: 403 };
    setupS3HeadBlob(err);

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.s3.accessDenied',
      message: 'Connection test failed',
      reason: 'AccessDenied',
    });
  });

  it('s3: 4xx errorCode s3.bucketMissing when ListObjectsV2 gets HTTP 404/NoSuchBucket', async () => {
    const err = new Error('The specified bucket does not exist');
    err.name = 'NoSuchBucket';
    err.code = 'NoSuchBucket';
    err.$metadata = { httpStatusCode: 404 };
    setupS3ListObjects(err);

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'missing-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.s3.bucketMissing',
      message: 'Connection test failed',
      reason: 'NoSuchBucket',
    });
  });

  it('s3: 4xx errorCode s3.unreachable on ECONNREFUSED', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:9000');
    err.code = 'ECONNREFUSED';
    setupS3ListObjects(err);

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
      endpoint: 'http://localhost:9000',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.s3.unreachable',
      message: 'Connection test failed',
      reason: 'ECONNREFUSED',
    });
  });

  it('s3: 4xx errorCode s3.accessDenied when ListObjectsV2 gets HTTP 403/AccessDenied', async () => {
    const err = new Error('Access Denied');
    err.name = 'AccessDenied';
    err.code = 'AccessDenied';
    err.$metadata = { httpStatusCode: 403 };
    setupS3ListObjects(err);

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.s3.accessDenied',
      message: 'Connection test failed',
      reason: 'AccessDenied',
    });
  });

  it('s3: 4xx generic test.failed with reason for unclassified errors', async () => {
    setupS3ListObjects(new Error('some unexpected driver error'));

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAX',
      secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.failed',
      message: 'Connection test failed',
      reason: 'some unexpected driver error',
    });
  });

  it('webdav: 200 ok:true, temporarily overrides env and restores it', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com',
      username: 'dav-user',
      password: 'dav-pass',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockWebdavTestConnection).toHaveBeenCalledTimes(1);
    expect(process.env.WEBDAV_URL).toBeUndefined();
    expect(process.env.WEBDAV_PASSWORD).toBeUndefined();
  });

  it('webdav: 4xx ok:false with errorCode when the connection test throws', async () => {
    mockWebdavTestConnection.mockRejectedValue(
      Object.assign(new Error('cannot connect'), {
        status: 400,
        errorCode: SERVER_ERROR_CODES.webdav.cannotConnect,
      })
    );

    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com',
      username: 'dav-user',
      password: 'dav-pass',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: SERVER_ERROR_CODES.webdav.cannotConnect,
      message: expect.any(String),
    });
  });

  it('webdav: 4xx body includes a trimmed reason when the error carries one', async () => {
    mockWebdavTestConnection.mockRejectedValue(
      Object.assign(new Error(SERVER_ERROR_CODES.api.webdavTestFailed), {
        status: 400,
        errorCode: SERVER_ERROR_CODES.api.webdavTestFailed,
        params: { reason: 'socket hang up' },
      })
    );

    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com',
      username: 'dav-user',
      password: 'dav-pass',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: SERVER_ERROR_CODES.api.webdavTestFailed,
      message: 'Connection test failed',
      reason: 'socket hang up',
    });
  });

  it('returns 403 setup.complete when setup is already complete', async () => {
    setCompleteWebdavEnv();
    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com',
      username: 'u',
      password: 'p',
    });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.complete);
  });

  it('missing required fields keeps serverErrors.setup.testFailed with the short message and no reason', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: 'serverErrors.setup.testFailed',
      message: 'Missing required fields: port, database, user, password',
    });
    expect(res.body.reason).toBeUndefined();
  });

  it('unsupported target keeps serverErrors.setup.testFailed with the short message and no reason', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'ftp',
      url: 'ftp://example.com',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: 'serverErrors.setup.testFailed',
      message: 'Unsupported target: ftp',
    });
    expect(res.body.reason).toBeUndefined();
  });
});

describeIfSqlite('POST /api/setup/prefill', () => {
  function setupPgRows(rows) {
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.query.mockResolvedValue({ rows });
      return client;
    });
  }

  const pgMetadata = {
    backend: 'postgresql',
    host: 'db.local',
    port: '5432',
    database: 'webdav',
    user: 'u',
    password: 'p',
    ssl: false,
  };

  it('postgresql: prefills plaintext config and masks secret rows', async () => {
    setupPgRows([
      { key: 'EMAIL_HOST', value: 'smtp.example.com' },
      { key: 'EMAIL_PASSWORD', value: 'smtp-pw' },
    ]);

    const res = await request(app).post('/api/setup/prefill').send({ metadata: pgMetadata });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      current: { EMAIL_HOST: 'smtp.example.com', EMAIL_PASSWORD: '****' },
    });
    expect(MockPgClient).toHaveBeenCalledTimes(1);
    expect(MockPgClient.mock.calls[0][0]).toMatchObject({
      host: 'db.local',
      port: 5432,
      database: 'webdav',
      user: 'u',
      password: 'p',
      ssl: false,
    });
  });

  it('postgresql: a plaintext secret row is masked and never surfaced', async () => {
    setupPgRows([{ key: 'EMAIL_PASSWORD', value: 'smtp-pw' }]);

    const res = await request(app).post('/api/setup/prefill').send({ metadata: pgMetadata });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ current: { EMAIL_PASSWORD: '****' } });
  });

  it('postgresql: a missing settings table (42P01) yields empty rows', async () => {
    const err = new Error('relation "settings" does not exist');
    err.code = '42P01';
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.query.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/prefill').send({ metadata: pgMetadata });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ current: {} });
  });

  it('sqlite metadata returns empty current (sqlite is prefilled via /status)', async () => {
    const res = await request(app)
      .post('/api/setup/prefill')
      .send({
        metadata: { backend: 'sqlite' },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ current: {} });
    expect(MockPgClient).not.toHaveBeenCalled();
  });

  it('postgresql: connect rejection is classified with the connection-test error codes', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    err.code = 'ECONNREFUSED';
    err.errno = -111;
    err.address = '127.0.0.1';
    err.port = 5432;
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(err);
      return client;
    });

    const res = await request(app).post('/api/setup/prefill').send({ metadata: pgMetadata });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.test.pg.unreachable',
      message: 'Connection test failed',
      reason: 'ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('missing required fields keeps serverErrors.setup.testFailed with the short message', async () => {
    const res = await request(app)
      .post('/api/setup/prefill')
      .send({
        metadata: { backend: 'postgresql', host: 'localhost' },
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: 'serverErrors.setup.testFailed',
      message: 'Missing required fields: port, database, user, password',
    });
  });

  it('returns 403 setup.complete when setup is already complete', async () => {
    setCompleteWebdavEnv();
    const res = await request(app).post('/api/setup/prefill').send({ metadata: pgMetadata });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.complete);
  });
});

describeIfSqlite('request logger', () => {
  it('logs the apply request without leaking the body', async () => {
    const envPath = makeEnvPath('logger');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const logSpy = jest.spyOn(console, 'log');
    logSpy.mockClear();

    await request(app)
      .post('/api/setup/apply')
      .send({
        metadata: { backend: 'sqlite' },
        file: {
          backend: 'webdav',
          url: 'https://dav.example.com',
          username: 'u',
          password: 'dav-leak',
        },
        admin: { password: 'admin-leak' },
        jwt: { secret: 'jwt-leak' },
      });

    const logLines = logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === 'string' && line.includes('/api/setup/apply'));
    expect(logLines).toHaveLength(1);

    const entry = JSON.parse(logLines[0]);
    expect(Object.keys(entry).sort()).toEqual([
      'duration_ms',
      'ip',
      'method',
      'status',
      'ts',
      'url',
      'user_agent',
    ]);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('admin-leak');
    expect(serialized).not.toContain('jwt-leak');
    expect(serialized).not.toContain('dav-leak');
  });
});

describeIfSqlite('setupCore (shared apply core)', () => {
  let settingsSetSpy;
  let invalidateSpy;

  function validWebdavPayload() {
    return {
      metadata: { backend: 'sqlite' },
      file: {
        backend: 'webdav',
        url: 'https://dav.example.com',
        username: 'dav-user',
        password: 'dav-pass',
        authType: 'auto',
      },
      admin: { password: 'core-admin-pass' },
      jwt: { secret: 'core-jwt-secret', expiresIn: '30m' },
      server: { port: '5001', corsOrigins: 'http://localhost:3000' },
      email: {
        host: 'smtp.example.com',
        port: '587',
        user: 'mail-user',
        password: 'mail-pass',
        secure: false,
        fromName: 'WebDAV',
      },
    };
  }

  beforeEach(() => {
    settingsSetSpy = jest
      .spyOn(Settings, 'set')
      .mockImplementation(async () => ({ success: true }));
    invalidateSpy = jest.spyOn(getSharedResolver(), 'invalidateCache');
    process.env.DOTENV_CONFIG_PATH = makeEnvPath('setupcore');
  });

  afterEach(() => {
    settingsSetSpy.mockRestore();
    invalidateSpy.mockRestore();
  });

  it('validateApplyPayload: returns null for a valid payload and error detail otherwise', () => {
    expect(setupCore.validateApplyPayload(validWebdavPayload())).toBeNull();
    expect(setupCore.validateApplyPayload('nope')).toEqual({
      errorCode: 'serverErrors.setup.invalidPayload',
      message: 'Invalid setup payload',
      fields: { body: 'invalid' },
    });
    // The jwt block is optional: an empty block or a completely absent block is
    // valid (the server falls back to an ephemeral per-boot secret).
    expect(
      setupCore.validateApplyPayload({
        metadata: { backend: 'sqlite' },
        file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
        admin: { password: 'pass' },
        jwt: {},
      })
    ).toBeNull();
    expect(
      setupCore.validateApplyPayload({
        metadata: { backend: 'sqlite' },
        file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
        admin: { password: 'pass' },
      })
    ).toBeNull();
  });

  it('validateApplyPayload: postgresql metadata is rejected with the wizard message', () => {
    const result = setupCore.validateApplyPayload({
      metadata: { backend: 'postgresql', host: 'db.local' },
      file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
      admin: { password: 'pass' },
      jwt: { secret: 's' },
    });
    expect(result.errorCode).toBe('serverErrors.setup.invalidPayload');
    expect(result.fields).toEqual({ metadata: 'notAllowed' });
    expect(result.message).toContain('environment variables');
  });

  it('buildEnvEntries + partitionEntries: T0 (non-metadata) goes to .env, the rest to DB', () => {
    const entries = setupCore.buildEnvEntries(validWebdavPayload());
    expect(entries.WEA_FILE_STORAGE).toBe('webdav');
    expect(entries.JWT_SECRET).toBe('core-jwt-secret');
    expect(entries.EMAIL_SECURE).toBe('false');

    const { envEntries, dbEntries } = setupCore.partitionEntries(entries);
    expect(Object.keys(envEntries).sort()).toEqual(['JWT_SECRET']);
    expect(dbEntries).not.toHaveProperty('JWT_SECRET');
    expect(dbEntries.WEA_FILE_STORAGE).toBe('webdav');
    expect(dbEntries.WEBDAV_PASSWORD).toBe('dav-pass');

    // Metadata-backend T0 keys are excluded from the .env partition entirely.
    const pgT0 = setupCore.partitionEntries({ WEA_DB_HOST: 'db.local' });
    expect(pgT0.envEntries).toEqual({});
    expect(pgT0.dbEntries).toEqual({});
  });

  it('buildEnvEntries + partitionEntries: without a supplied secret the entries carry no JWT_SECRET and the .env partition is empty', () => {
    const noJwtEntries = setupCore.buildEnvEntries({
      metadata: { backend: 'sqlite' },
      file: {
        backend: 'webdav',
        url: 'https://dav.example.com',
        username: 'dav-user',
        password: 'dav-pass',
      },
      admin: { password: 'core-admin-pass' },
    });
    expect(noJwtEntries.WEA_FILE_STORAGE).toBe('webdav');
    expect(noJwtEntries).not.toHaveProperty('JWT_SECRET');
    expect(noJwtEntries).not.toHaveProperty('JWT_EXPIRES_IN');

    const { envEntries, dbEntries } = setupCore.partitionEntries(noJwtEntries);
    expect(envEntries).toEqual({});
    expect(dbEntries.WEA_FILE_STORAGE).toBe('webdav');
    expect(dbEntries).not.toHaveProperty('JWT_SECRET');
  });

  it('applySetup: valid webdav payload applies wizard-identically and returns restart_required', async () => {
    const result = await setupCore.applySetup(validWebdavPayload());

    expect(result).toEqual({ restart_required: true });
    expect(mockWriteEnv).toHaveBeenCalledTimes(1);
    const [, envEntries] = mockWriteEnv.mock.calls[0];
    expect(Object.keys(envEntries).sort()).toEqual(['JWT_SECRET']);
    expect(envEntries.JWT_SECRET).toBe('core-jwt-secret');
    expect(envEntries).not.toHaveProperty('encrypt_secret_key');

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written.WEA_FILE_STORAGE).toBe('webdav');
    expect(written.WEBDAV_URL).toBe('https://dav.example.com');
    expect(written.WEBDAV_PASSWORD).toBe('dav-pass');
    expect(written.EMAIL_PASSWORD).toBe('mail-pass');
    expect(invalidateSpy).toHaveBeenCalled();

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('core-admin-pass', admin.password)).toBe(true);
    expect(await bcrypt.compare(ADMIN_PASSWORD, admin.password)).toBe(false);
  });

  it('applySetup: rejects an invalid payload with the typed 400 error and writes nothing', async () => {
    const payload = validWebdavPayload();
    delete payload.file.url;

    await expect(setupCore.applySetup(payload)).rejects.toMatchObject({
      errorCode: 'serverErrors.setup.invalidPayload',
      message: 'Invalid setup payload',
      fields: { 'file.url': 'required' },
    });
    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(settingsSetSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('applySetup: an empty jwt block applies cleanly, writes no .env partition and no JWT rows', async () => {
    const payload = validWebdavPayload();
    payload.jwt = {};

    const result = await setupCore.applySetup(payload);
    expect(result).toEqual({ restart_required: true });

    // The .env partition is empty (no supplied JWT secret) so writeEnv is
    // skipped entirely and no JWT_SECRET/JWT_EXPIRES_IN row is persisted.
    expect(mockWriteEnv).not.toHaveBeenCalled();
    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written.WEA_FILE_STORAGE).toBe('webdav');
    expect(written.WEBDAV_PASSWORD).toBe('dav-pass');
    expect(written).not.toHaveProperty('JWT_SECRET');
    expect(written).not.toHaveProperty('JWT_EXPIRES_IN');
    expect(invalidateSpy).toHaveBeenCalled();

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('core-admin-pass', admin.password)).toBe(true);
  });

  it('applySetup: a payload without a jwt block writes no .env partition and keeps .env absent', async () => {
    const payload = validWebdavPayload();
    delete payload.jwt;

    const envPath = makeEnvPath('setupcore-no-jwt');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const result = await setupCore.applySetup(payload);
    expect(result).toEqual({ restart_required: true });
    expect(mockWriteEnv).not.toHaveBeenCalled();
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('applySetup: a masked (unchanged) secret is dropped, not overwritten', async () => {
    const payload = {
      metadata: { backend: 'sqlite' },
      file: {
        backend: 's3',
        bucket: 'webdav-temp',
        region: 'us-east-1',
        accessKeyId: 'admin',
        secretAccessKey: '****',
      },
      admin: { password: 'core-admin-pass' },
      jwt: { secret: 'core-jwt-secret' },
    };

    const result = await setupCore.applySetup(payload);
    expect(result).toEqual({ restart_required: true });

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(written.S3_BUCKET).toBe('webdav-temp');
    expect(mockWriteEnv).toHaveBeenCalledTimes(1);
  });

  it('applySetup: writes only JWT_SECRET to .env (no master key is ever written)', async () => {
    const result = await setupCore.applySetup(validWebdavPayload());
    expect(result).toEqual({ restart_required: true });

    const [, envEntries] = mockWriteEnv.mock.calls[0];
    expect(Object.keys(envEntries).sort()).toEqual(['JWT_SECRET']);
    expect(envEntries).not.toHaveProperty('encrypt_secret_key');

    const written = Object.fromEntries(settingsSetSpy.mock.calls);
    expect(written.WEBDAV_PASSWORD).toBe('dav-pass');
  });
});
