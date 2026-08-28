'use strict';

/**
 * Setup routes unit/integration tests.
 * Builds a minimal express app mounting the setup router directly (T5 will
 * mount it in server/index.js). Real envFileWriter writes to a temp env file;
 * the metadata store is a real isolated sqlite DB (createTestDatabase).
 * @see docs/spec/server/routes/setup.md
 */
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
const { errorHandler } = require('../../../utils/errorHandler');
const requestLogger = require('../../../middleware/requestLogger');
const { Client: MockPgClient } = require('pg');

const setupRouter = require('../routes');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-routes-'));
const ADMIN_PASSWORD = 'admin-old-password';

const WIZARD_ENV_KEYS = [
  'WEA_STORAGE_BACKEND', 'WEA_FILE_STORAGE', 'PORT', 'JWT_SECRET', 'JWT_EXPIRES_IN',
  'WEA_PG_HOST', 'WEA_PG_PORT', 'WEA_PG_DATABASE', 'WEA_PG_USER', 'WEA_PG_PASSWORD',
  'WEA_PG_SSL', 'WEA_PG_MAX', 'S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'WEBDAV_URL', 'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD', 'WEBDAV_AUTH_TYPE', 'CORS_ORIGINS', 'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_SECURE',
  'EMAIL_FROM_NAME', 'DOTENV_CONFIG_PATH', 'WEA_SQLITE_PATH',
];
const SAVED_ENV = {};

function setIncompleteBaseline() {
  for (const key of WIZARD_ENV_KEYS) {
    if (key !== 'WEA_STORAGE_BACKEND' && key !== 'WEA_SQLITE_PATH' && key !== 'WEA_FILE_STORAGE') delete process.env[key];
  }
  process.env.WEA_FILE_STORAGE = 's3';
}

function setCompleteWebdavEnv() {
  setIncompleteBaseline();
  process.env.WEA_STORAGE_BACKEND = 'sqlite';
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

function makeNotFoundError() {
  const err = new Error('NotFound');
  err.name = 'NotFound';
  return err;
}

let mockS3HeadBlob;

function setupS3HeadBlob(rejection) {
  mockS3HeadBlob = jest.fn();
  if (rejection) mockS3HeadBlob.mockRejectedValue(rejection);
  mockS3BlobStore.mockImplementation(() => ({ headBlob: mockS3HeadBlob }));
}

function makeEnvPath(label) {
  return path.join(TMP_ROOT, `.env-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

let app;
let dbCleanup;
let adminUser;

beforeAll(async () => {
  for (const key of WIZARD_ENV_KEYS) SAVED_ENV[key] = process.env[key];

  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  await initMetadataStore();
  adminUser = await User.create('admin', 'admin@webdav.local', ADMIN_PASSWORD, true);

  app = buildApp();
});

afterAll(async () => {
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
  setupS3HeadBlob(makeNotFoundError());
});

describe('GET /api/setup/status', () => {
  it('returns incomplete status with missing s3 keys and masked current values', async () => {
    setIncompleteBaseline();
    const res = await request(app).get('/api/setup/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      setup_complete: false,
      missing: ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    });
    expect(res.body.current).toMatchObject({
      WEA_STORAGE_BACKEND: 'sqlite',
      WEA_FILE_STORAGE: 's3',
    });
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
});

describe('POST /api/setup/apply', () => {
  it('sqlite + webdav: writes expected env keys, merges existing file, updates the admin password', async () => {
    const envPath = makeEnvPath('sqlite-webdav');
    fs.writeFileSync(envPath, 'CUSTOM_FLAG=keep-me\nPORT=9000\n');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app).post('/api/setup/apply').send({
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
        host: 'smtp.example.com', port: '587', user: 'mail-user',
        password: 'mail-pass', secure: false, fromName: 'WebDAV',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    const contents = fs.readFileSync(envPath, 'utf8');
    expect(contents).toContain('CUSTOM_FLAG=keep-me');
    expect(contents).toContain('PORT=5001');
    expect(contents).toContain('WEA_STORAGE_BACKEND=sqlite');
    expect(contents).toContain('WEA_FILE_STORAGE=webdav');
    expect(contents).toContain('WEBDAV_URL=https://dav.example.com');
    expect(contents).toContain('WEBDAV_USERNAME=dav-user');
    expect(contents).toContain('WEBDAV_PASSWORD=dav-pass');
    expect(contents).toContain('WEBDAV_AUTH_TYPE=auto');
    expect(contents).toContain('JWT_SECRET=super-secret-jwt');
    expect(contents).toContain('JWT_EXPIRES_IN=30m');
    expect(contents).toContain('CORS_ORIGINS=http://localhost:3000');
    expect(contents).toContain('EMAIL_HOST=smtp.example.com');
    expect(contents).toContain('EMAIL_PORT=587');
    expect(contents).toContain('EMAIL_USER=mail-user');
    expect(contents).toContain('EMAIL_PASSWORD=mail-pass');
    expect(contents).toContain('EMAIL_SECURE=false');
    expect(contents).toContain('EMAIL_FROM_NAME=WebDAV');
    expect(contents).not.toContain('WEA_PG_');
    expect(contents).not.toContain('S3_');
    expect(contents).not.toContain('ADMIN_DEFAULT_PASSWORD');

    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);

    const admin = await User.findByUsername('admin');
    expect(admin).toBeTruthy();
    expect(await bcrypt.compare('new-admin-pass', admin.password)).toBe(true);
    expect(await bcrypt.compare(ADMIN_PASSWORD, admin.password)).toBe(false);
  });

  it('sqlite + webdav: empty-string optional server/email ports are tolerated and PORT is not written', async () => {
    const envPath = makeEnvPath('sqlite-webdav-empty-port');
    fs.writeFileSync(envPath, 'CUSTOM_FLAG=keep-me\n');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app).post('/api/setup/apply').send({
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

    const contents = fs.readFileSync(envPath, 'utf8');
    expect(contents).toContain('CUSTOM_FLAG=keep-me');
    expect(contents).not.toContain('PORT=');
    expect(contents).not.toContain('EMAIL_PORT=');
    expect(contents).toContain('WEA_FILE_STORAGE=webdav');
  });

  it('postgresql + s3: writes WEA_PG_* and S3_* keys plus ADMIN_DEFAULT_PASSWORD without touching sqlite admin', async () => {
    const envPath = makeEnvPath('pg-s3');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const res = await request(app).post('/api/setup/apply').send({
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

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restart_required: true });

    const contents = fs.readFileSync(envPath, 'utf8');
    expect(contents).toContain('WEA_STORAGE_BACKEND=postgresql');
    expect(contents).toContain('WEA_PG_HOST=db.local');
    expect(contents).toContain('WEA_PG_PORT=5433');
    expect(contents).toContain('WEA_PG_DATABASE=webdav');
    expect(contents).toContain('WEA_PG_USER=pg-user');
    expect(contents).toContain('WEA_PG_PASSWORD=pg-pass');
    expect(contents).toContain('WEA_PG_SSL=true');
    expect(contents).toContain('WEA_PG_MAX=20');
    expect(contents).toContain('WEA_FILE_STORAGE=s3');
    expect(contents).toContain('S3_BUCKET=wea-bucket');
    expect(contents).toContain('AWS_REGION=us-east-1');
    expect(contents).toContain('AWS_ACCESS_KEY_ID=AKIAX');
    expect(contents).toContain('AWS_SECRET_ACCESS_KEY=s3-secret');
    expect(contents).toContain('S3_ENDPOINT=http://localhost:9010');
    expect(contents).toContain('JWT_SECRET=jwt-pg');
    expect(contents).toContain('ADMIN_DEFAULT_PASSWORD=pg-admin-pass');
    expect(contents).not.toContain('WEBDAV_URL');
    expect(contents).not.toContain('EMAIL_');

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare(ADMIN_PASSWORD, admin.password)).toBe(true);
  });

  it('returns 403 setup.complete when setup is already complete', async () => {
    setCompleteWebdavEnv();
    const res = await request(app).post('/api/setup/apply').send({
      metadata: { backend: 'sqlite' },
      file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
      admin: { password: 'whatever' },
      jwt: { secret: 's' },
    });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.complete);
  });

  it('returns 400 per-field when required blocks are missing (jwt.secret)', async () => {
    const res = await request(app).post('/api/setup/apply').send({
      metadata: { backend: 'sqlite' },
      file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
      admin: { password: 'pass' },
      jwt: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.setup.invalidPayload');
    expect(res.body.fields['jwt.secret']).toBe('required');
  });

  it('returns 400 per-field for missing s3 keys and an unknown key', async () => {
    const res = await request(app).post('/api/setup/apply').send({
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
    const res = await request(app).post('/api/setup/apply').send({
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

describe('POST /api/setup/test', () => {
  it('postgresql: 200 ok:true on a successful connection', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost', port: '5432', database: 'webdav',
      user: 'u', password: 'p', ssl: false,
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

  it('postgresql: 4xx ok:false with errorCode when the connection fails', async () => {
    MockPgClient.mockImplementation(() => {
      const client = makePgClient();
      client.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1'));
      return client;
    });

    const res = await request(app).post('/api/setup/test').send({
      target: 'postgresql',
      host: 'localhost', port: '5432', database: 'webdav',
      user: 'u', password: 'p',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.testFailed',
      message: expect.any(String),
    });
  });

  it('s3: 200 ok:true when the probe hits a missing random key (404/NoSuchKey)', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket', region: 'us-east-1',
      accessKeyId: 'AKIAX', secretAccessKey: 's3-secret',
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

  it('s3: 4xx ok:false with errorCode when the probe fails for a non-404 reason', async () => {
    setupS3HeadBlob(new Error('AccessDenied'));

    const res = await request(app).post('/api/setup/test').send({
      target: 's3',
      bucket: 'wea-bucket', region: 'us-east-1',
      accessKeyId: 'AKIAX', secretAccessKey: 's3-secret',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      errorCode: 'serverErrors.setup.testFailed',
      message: expect.any(String),
    });
  });

  it('webdav: 200 ok:true, temporarily overrides env and restores it', async () => {
    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com', username: 'dav-user', password: 'dav-pass',
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
      url: 'https://dav.example.com', username: 'dav-user', password: 'dav-pass',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errorCode: SERVER_ERROR_CODES.webdav.cannotConnect,
      message: expect.any(String),
    });
  });

  it('returns 403 setup.complete when setup is already complete', async () => {
    setCompleteWebdavEnv();
    const res = await request(app).post('/api/setup/test').send({
      target: 'webdav',
      url: 'https://dav.example.com', username: 'u', password: 'p',
    });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.complete);
  });
});

describe('request logger', () => {
  it('logs the apply request without leaking the body', async () => {
    const envPath = makeEnvPath('logger');
    process.env.DOTENV_CONFIG_PATH = envPath;

    const logSpy = jest.spyOn(console, 'log');
    logSpy.mockClear();

    await request(app).post('/api/setup/apply').send({
      metadata: { backend: 'sqlite' },
      file: { backend: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'dav-leak' },
      admin: { password: 'admin-leak' },
      jwt: { secret: 'jwt-leak' },
    });

    const logLines = logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === 'string' && line.includes('/api/setup/apply'));
    expect(logLines).toHaveLength(1);

    const entry = JSON.parse(logLines[0]);
    expect(Object.keys(entry).sort()).toEqual(['duration_ms', 'ip', 'method', 'status', 'ts', 'url', 'user_agent']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('admin-leak');
    expect(serialized).not.toContain('jwt-leak');
    expect(serialized).not.toContain('dav-leak');
  });
});
