'use strict';

/**
 * Admin migration routes integration tests.
 * Mirrors the setup of admin.test.js (composition override with a fake
 * migrationService + in-memory MigrationJobStore) so no real migration,
 * network, or DB writes run. The WEA_SKIP_MIGRATION_WORKER seam is used to
 * disable/await the background worker deterministically.
 * @see docs/spec/server/routes/admin.md §2.2.4
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../../../test-utils');
const { initMetadataStore } = require('../../../../store/bootstrap');
const { initFfmpegOnce } = require('../../../../domains/thumbnails/services/videoProcessor');
const { MigrationJobStore } = require('../../stores/migrationJobStore');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getMigrationGate } = require('../../../../infrastructure/migrationGate');

const mockMetadataService = { scanTarget: jest.fn(), runMigration: jest.fn() };
jest.mock('../../services/metadataMigrationService', () => ({
  getService: () => mockMetadataService,
}));

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

let app;
let dbCleanup;
let composition;
let jobStore;
let fakeMigrationService;
const previousFileStorage = process.env.WEA_FILE_STORAGE;
const previousSkipWorker = process.env.WEA_SKIP_MIGRATION_WORKER;

const VALID_PAYLOAD = {
  mode: 'dry-run',
  force: false,
  dest: { type: 's3', bucket: 'test-bucket', accessKey: 'ak', secretKey: 'sk' },
};

// Backend-agnostic metadata target: the active backend depends on the env
// (sqlite under test:ci, postgresql under test:ci:pg), so the target is the
// OTHER backend.
const ACTIVE_METADATA_BACKEND = require('../../../../store/storage').getBackend();
const OTHER_METADATA_BACKEND = ACTIVE_METADATA_BACKEND === 'sqlite' ? 'postgresql' : 'sqlite';

function makeMetadataPayload(targetBackend = OTHER_METADATA_BACKEND, overrides = {}) {
  const payload = { targetBackend, wipeTarget: false };
  if (targetBackend === 'postgresql') {
    payload.pg = { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' };
  } else {
    payload.sqlitePath = '/tmp/target.db';
  }
  return { ...payload, ...overrides };
}

async function createAdminToken() {
  const { token } = await createAuthenticatedTestUser({
    username: `migration-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    isAdmin: true,
  });
  return token;
}

async function waitForJobStatus(token, jobId, expectedStatus) {
  for (let i = 0; i < 50; i += 1) {
    const res = await request(app)
      .get(`/api/admin/migration/jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    if (res.body.status === expectedStatus) return res;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} never reached status ${expectedStatus}`);
}

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
  composition = require('../../../../service/composition');
  jobStore = new MigrationJobStore();
  fakeMigrationService = { run: jest.fn() };
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(createWebdavMock()),
    migrationJobStore: jobStore,
    migrationService: fakeMigrationService,
  });
  app = require('../../../../index');
  // index.js fires initMetadataStore() + ffmpeg/webdav probes at require-time.
  // Await the same shared init promises so startup settles before teardown.
  await initMetadataStore();
  await initFfmpegOnce();
});

afterAll(async () => {
  await dbCleanup?.();
  process.env.WEA_FILE_STORAGE = previousFileStorage;
  if (previousSkipWorker === undefined) delete process.env.WEA_SKIP_MIGRATION_WORKER;
  else process.env.WEA_SKIP_MIGRATION_WORKER = previousSkipWorker;
});

beforeEach(() => {
  jobStore._jobs.clear();
  getMigrationGate().reset();
  delete process.env.WEA_SKIP_MIGRATION_WORKER;
  jest.clearAllMocks();
});

describe('Route matrix: non-admin denied on every /api/admin/migration/* route', () => {
  it('returns 403 for a non-admin on all 4 migration endpoints', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `migration-nonadmin-${Date.now()}`,
      isAdmin: false,
    });
    const auth = { Authorization: `Bearer ${token}` };

    const infoRes = await request(app)
      .get('/api/admin/migration/info')
      .set(auth);
    expect(infoRes.status).toBe(403);
    expect(infoRes.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set(auth)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(403);
    expect(postRes.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);

    const getRes = await request(app)
      .get('/api/admin/migration/jobs/some-job')
      .set(auth);
    expect(getRes.status).toBe(403);
    expect(getRes.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);

    const cancelRes = await request(app)
      .post('/api/admin/migration/jobs/some-job/cancel')
      .set(auth);
    expect(cancelRes.status).toBe(403);
    expect(cancelRes.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);
  });
});

describe('GET /api/admin/migration/info', () => {
  it('returns source and derived direction for an admin', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/info')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ source: 'webdav', direction: 'webdav-to-s3' });
  });
});

describe('POST /api/admin/migration/blobs', () => {
  it('accepts a valid dry-run payload with 202 { jobId } and records a pending job', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();

    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: expect.any(String) });

    const job = jobStore.get(res.body.jobId);
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      jobId: res.body.jobId,
      direction: 'webdav-to-s3',
      mode: 'dry-run',
      status: 'pending',
      progress: 0,
      total: 0,
      current: null,
      results: { copied: 0, skipped: 0, failed: 0, errors: [] },
      errorMessage: null,
      completedAt: null,
    });
    expect(job.phase).toBeUndefined();

    expect(fakeMigrationService.run).not.toHaveBeenCalled();
  });

  it('returns 400 with migrationInvalidPayload when dest.type does not match the derived direction', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'dry-run',
        dest: { type: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' },
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  it('accepts a payload with legacy phase/resume fields (they are ignored)', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();

    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, phase: 'finalize', resume: true });

    expect(res.status).toBe(202);
    const job = jobStore.get(res.body.jobId);
    expect(job).toMatchObject({ direction: 'webdav-to-s3', mode: 'dry-run' });
    expect(job.phase).toBeUndefined();
  });

  it('returns 400 with migrationInvalidPayload for an invalid mode', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, mode: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  it('returns 400 with migrationInvalidPayload for an invalid dest type', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, dest: { type: 'ftp', host: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  it('returns 400 with migrationMissingRequired when s3 dest fields are missing', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, dest: { type: 's3', bucket: 'test-bucket' } });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationMissingRequired);
  });

  it('returns 409 with migrationAlreadyRunning while a job is pending/running', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();

    const first = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(first.status).toBe(202);

    const second = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);

    expect(second.status).toBe(409);
    expect(second.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationAlreadyRunning);
  });

  it('runs the worker and the job reaches completed with propagated results', async () => {
    fakeMigrationService.run.mockImplementationOnce(async ({ onProgress }) => {
      onProgress({ total: 3, done: 1, current: { nodeId: 1, path: '/a.txt' }, copied: 1, skipped: 0, failed: 0 });
      onProgress({ total: 3, done: 2, current: { nodeId: 2, path: '/b.txt' }, copied: 2, skipped: 0, failed: 0 });
      onProgress({ total: 3, done: 3, current: { nodeId: 3, path: '/c.txt' }, copied: 2, skipped: 1, failed: 0 });
      return { copied: 2, skipped: 1, failed: 0, errors: [] };
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);
    const { jobId } = postRes.body;

    expect(fakeMigrationService.run).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'dry-run',
      force: false,
      destConfig: expect.objectContaining({ type: 's3', bucket: 'test-bucket', accessKey: 'ak', secretKey: 'sk' }),
      onProgress: expect.any(Function),
    }));
    expect(fakeMigrationService.run.mock.calls[0][0].direction).toBeUndefined();

    const res = await waitForJobStatus(token, jobId, 'completed');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jobId,
      direction: 'webdav-to-s3',
      mode: 'dry-run',
      status: 'completed',
      progress: 3,
      total: 3,
      current: null,
      results: { copied: 2, skipped: 1, failed: 0, errors: [] },
      errorMessage: null,
    });
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.completedAt).toBeDefined();
  });

  it('marks the job failed with errorMessage when the service rejects', async () => {
    fakeMigrationService.run.mockImplementationOnce(async () => {
      throw new Error('destination unavailable');
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);

    const res = await waitForJobStatus(token, postRes.body.jobId, 'failed');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.errorMessage).toBe('destination unavailable');
    expect(res.body.completedAt).toBeDefined();
  });

  it('propagates onProgress updates to the job while running', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    fakeMigrationService.run.mockImplementationOnce(async ({ onProgress }) => {
      onProgress({ total: 5, done: 2, current: { nodeId: 7, path: '/docs/a.txt' }, copied: 2, skipped: 0, failed: 0 });
      await gate;
      return { copied: 2, skipped: 0, failed: 0, errors: [] };
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const midRes = await request(app)
      .get(`/api/admin/migration/jobs/${postRes.body.jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(midRes.status).toBe(200);
    expect(midRes.body).toMatchObject({
      status: 'running',
      progress: 2,
      total: 5,
      current: '/docs/a.txt',
      results: { copied: 2, skipped: 0, failed: 0, errors: [] },
    });

    release();
    await waitForJobStatus(token, postRes.body.jobId, 'completed');
  });
});

describe('GET /api/admin/migration/jobs/:jobId', () => {
  it('returns 404 for an unknown job', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/jobs/does-not-exist')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationJobNotFound);
  });
});

describe('POST /api/admin/migration/jobs/:jobId/cancel', () => {
  it('returns 404 for an unknown job', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/jobs/does-not-exist/cancel')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationJobNotFound);
  });

  it('cancels a known pending job and returns 200 with messageCode + jobId', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);
    const { jobId } = postRes.body;

    const cancelRes = await request(app)
      .post(`/api/admin/migration/jobs/${jobId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({
      messageCode: SERVER_MESSAGE_CODES.admin.migrationCancelled,
      jobId,
    });

    const getRes = await request(app)
      .get(`/api/admin/migration/jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.body.status).toBe('cancelled');
    expect(getRes.body.completedAt).toBeDefined();
  });
});

describe('GET /api/migration/status (public)', () => {
  it('returns the inactive gate state without auth', async () => {
    const res = await request(app).get('/api/migration/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false, type: undefined, jobId: undefined, startedAt: undefined });
  });

  it('returns the active gate state (type/jobId/startedAt) without auth', async () => {
    const state = getMigrationGate().set({ type: 'metadata', jobId: 'status-job' });
    try {
      const res = await request(app).get('/api/migration/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(state);
    } finally {
      getMigrationGate().reset();
    }
  });
});

describe('GET /api/admin/migration/presence', () => {
  it('is admin-only and returns the non-active backend presence result', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/presence')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // The detector reports the NON-active metadata backend. Presence is
    // environment-dependent (it probes the configured backend), so only the
    // deterministic shape is asserted.
    expect(res.body.otherBackend).toBe(OTHER_METADATA_BACKEND);
    expect(typeof res.body.otherHasData).toBe('boolean');
    expect(res.body.checkedAt).toBeDefined();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/migration/presence');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/migration/target-scan', () => {
  it('returns 400 for an invalid target backend', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({ targetBackend: 'mysql' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
    expect(mockMetadataService.scanTarget).not.toHaveBeenCalled();
  });

  it('returns 400 when PG connection fields are missing', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({ targetBackend: 'postgresql', host: 'h' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationMissingRequired);
  });

  it('returns 400 when sqlitePath is missing for a sqlite target', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({ targetBackend: 'sqlite' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationMissingRequired);
  });

  it('returns 200 with the scan result for a nested pg payload', async () => {
    mockMetadataService.scanTarget.mockResolvedValueOnce({
      backend: 'postgresql',
      connected: true,
      schemaExists: true,
      tables: [{ name: 'users', rows: 3 }],
      totalRows: 3,
      checkedAt: '2026-09-01T00:00:00.000Z',
    });
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({ targetBackend: 'postgresql' })
      .send({ pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } });

    expect(res.status).toBe(200);
    expect(res.body.schemaExists).toBe(true);
    expect(mockMetadataService.scanTarget).toHaveBeenCalledWith({
      backend: 'postgresql',
      pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' },
      sqlitePath: undefined,
    });
  });

  it('returns 200 and forwards flat query params as the pg connection for a postgresql target', async () => {
    mockMetadataService.scanTarget.mockResolvedValueOnce({
      backend: 'postgresql',
      connected: true,
      schemaExists: false,
      tables: [],
      totalRows: 0,
    });
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({
        targetBackend: 'postgresql',
        host: 'h',
        port: 5433,
        database: 'd',
        user: 'u',
        password: 'p',
      });

    expect(res.status).toBe(200);
    expect(mockMetadataService.scanTarget).toHaveBeenCalledWith({
      backend: 'postgresql',
      pg: { host: 'h', port: '5433', database: 'd', user: 'u', password: 'p' },
      sqlitePath: undefined,
    });
  });

  it('returns 200 and forwards sqlitePath for a sqlite target', async () => {
    mockMetadataService.scanTarget.mockResolvedValueOnce({
      backend: 'sqlite',
      connected: true,
      schemaExists: true,
      tables: [{ name: 'settings', rows: 2 }],
      totalRows: 2,
    });
    const token = await createAdminToken();
    const res = await request(app)
      .get('/api/admin/migration/target-scan')
      .set('Authorization', `Bearer ${token}`)
      .query({ targetBackend: 'sqlite', sqlitePath: '/tmp/target.db' });

    expect(res.status).toBe(200);
    expect(mockMetadataService.scanTarget).toHaveBeenCalledWith({
      backend: 'sqlite',
      sqlitePath: '/tmp/target.db',
      pg: undefined,
    });
  });
});

describe('POST /api/admin/migration/metadata', () => {
  // Backend-agnostic: the active metadata backend depends on the env, so the
  // target is always derived as the OTHER backend (see makeMetadataPayload).
  const expectedDirection =
    ACTIVE_METADATA_BACKEND === 'sqlite' ? 'sqliteToPostgresql' : 'postgresqlToSqlite';
  const pgTargetIt = OTHER_METADATA_BACKEND === 'postgresql' ? it : it.skip;
  const sqliteTargetIt = OTHER_METADATA_BACKEND === 'sqlite' ? it : it.skip;

  const VALID_METADATA_PAYLOAD = makeMetadataPayload();

  it('returns 400 with migrationInvalidPayload for an invalid target backend', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetBackend: 'mysql' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  it('returns 400 when targetBackend equals the active backend', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(makeMetadataPayload(ACTIVE_METADATA_BACKEND));
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  pgTargetIt('returns 400 with migrationMissingRequired when pg fields are incomplete', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetBackend: 'postgresql', pg: { host: 'h' } });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationMissingRequired);
  });

  sqliteTargetIt('returns 400 when sqlitePath is missing for a sqlite target', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetBackend: 'sqlite' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationMissingRequired);
  });

  it('returns 409 while a blob job is already running', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();
    await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);

    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_METADATA_PAYLOAD);
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationAlreadyRunning);
  });

  it('returns 409 while the migration gate is already active', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();
    getMigrationGate().set({ type: 'blobs', jobId: 'already-active' });
    try {
      const res = await request(app)
        .post('/api/admin/migration/metadata')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_METADATA_PAYLOAD);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationAlreadyRunning);
    } finally {
      getMigrationGate().reset();
    }
  });

  it('accepts a valid payload with 202 { jobId } and records a metadata job', async () => {
    process.env.WEA_SKIP_MIGRATION_WORKER = '1';
    const token = await createAdminToken();

    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_METADATA_PAYLOAD);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: expect.any(String) });

    const job = jobStore.get(res.body.jobId);
    expect(job).toMatchObject({
      jobId: res.body.jobId,
      type: 'metadata',
      direction: expectedDirection,
      mode: 'apply',
      status: 'pending',
      stage: null,
      progress: { percent: 0, currentLabel: null },
    });
    expect(mockMetadataService.runMigration).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `mig-meta-nonadmin-${Date.now()}`,
      isAdmin: false,
    });
    const res = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_METADATA_PAYLOAD);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);
  });
});

describe('migration gate lifecycle', () => {
  // VALID_PAYLOAD is mode: 'dry-run' — this test verifies the cross-agent
  // decision that dry-run DOES activate the gate (the client navigates to
  // /migration after any start, and a dry-run performs real enumeration work).
  it('blobs dry-run: sets the gate on start (202) and clears it when the worker reaches a terminal state', async () => {
    let release;
    const workerGate = new Promise((resolve) => {
      release = resolve;
    });
    fakeMigrationService.run.mockImplementationOnce(async () => {
      await workerGate;
      return { copied: 1, skipped: 0, failed: 0, errors: [] };
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);

    expect(getMigrationGate().isActive()).toBe(true);
    expect(getMigrationGate().getStatus()).toMatchObject({
      active: true,
      type: 'blobs',
      jobId: postRes.body.jobId,
    });
    expect(getMigrationGate().getStatus().startedAt).toBeDefined();

    release();
    await waitForJobStatus(token, postRes.body.jobId, 'completed');
    expect(getMigrationGate().isActive()).toBe(false);
  });

  it('metadata: sets the gate on start (202) and clears it on completion', async () => {
    let release;
    const workerGate = new Promise((resolve) => {
      release = resolve;
    });
    mockMetadataService.runMigration.mockImplementationOnce(async ({ onProgress }) => {
      onProgress('copy', 'users', 2, 2);
      await workerGate;
      return { status: 'completed', tablesCopied: [{ name: 'users', rows: 2 }], totalRows: 2, schemaApplied: false, wiped: false };
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(makeMetadataPayload());
    expect(postRes.status).toBe(202);

    expect(getMigrationGate().isActive()).toBe(true);
    expect(getMigrationGate().getStatus()).toMatchObject({
      active: true,
      type: 'metadata',
      jobId: postRes.body.jobId,
    });

    release();
    const res = await waitForJobStatus(token, postRes.body.jobId, 'completed');
    expect(res.body.status).toBe('completed');
    expect(getMigrationGate().isActive()).toBe(false);
  });

  it('blobs: clears the gate when the worker fails', async () => {
    fakeMigrationService.run.mockImplementationOnce(async () => {
      throw new Error('destination unavailable');
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_PAYLOAD);
    expect(postRes.status).toBe(202);

    await waitForJobStatus(token, postRes.body.jobId, 'failed');
    expect(getMigrationGate().isActive()).toBe(false);
  });
});

describe('cancel for metadata jobs', () => {
  it('cancels a pending metadata job and the gate worker reports cancelled', async () => {
    let release;
    const workerGate = new Promise((resolve) => {
      release = resolve;
    });
    mockMetadataService.runMigration.mockImplementationOnce(async () => {
      await workerGate;
      return { status: 'cancelled' };
    });
    const token = await createAdminToken();

    const postRes = await request(app)
      .post('/api/admin/migration/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send(makeMetadataPayload());
    expect(postRes.status).toBe(202);
    const { jobId } = postRes.body;

    // Give the worker time to start (status running) before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cancelRes = await request(app)
      .post(`/api/admin/migration/jobs/${jobId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({
      messageCode: SERVER_MESSAGE_CODES.admin.migrationCancelled,
      jobId,
    });

    release();
    // The worker observes the cancelled flag and returns { status: 'cancelled' }.
    const res = await waitForJobStatus(token, jobId, 'cancelled');
    expect(res.body.status).toBe('cancelled');
    expect(getMigrationGate().isActive()).toBe(false);
  });
});

describe('gating middleware (503 migrationInProgress)', () => {
  const BLOCKED_PATHS = [
    ['get', '/api/settings/public'],
    ['get', '/api/files/anything'],
    ['get', '/api/folders/1'],
    ['get', '/api/webdav/anything'],
  ];

  it('gate inactive -> all routes proceed (no 503)', async () => {
    const token = await createAdminToken();
    const auth = { Authorization: `Bearer ${token}` };

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    for (const [method, url] of BLOCKED_PATHS) {
      const res = await request(app)[method](url).set(auth);
      expect(res.status).not.toBe(503);
    }
  });

  it('gate active -> non-allow-listed routes return 503 migrationInProgress', async () => {
    getMigrationGate().set({ type: 'blobs', jobId: 'gating-1' });
    try {
      const res = await request(app).get('/api/settings/public');
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe('migrationInProgress');
      expect(res.body.messageCode).toBe('migrationInProgress');
      expect(res.body.params).toEqual({ type: 'blobs', jobId: 'gating-1' });

      const filesRes = await request(app).get('/api/files/anything');
      expect(filesRes.status).toBe(503);
    } finally {
      getMigrationGate().reset();
    }
  });

  it('gate active -> allow-listed routes still pass', async () => {
    const token = await createAdminToken();
    const auth = { Authorization: `Bearer ${token}` };
    getMigrationGate().set({ type: 'metadata', jobId: 'gating-2' });
    try {
      // GET /api/health stays open.
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(200);
      expect(health.status).not.toBe(503);

      // POST /api/auth/login stays open (auth logic runs, not the gate).
      const login = await request(app).post('/api/auth/login').send({ username: 'x', password: 'y' });
      expect(login.status).not.toBe(503);

      // GET /api/migration/status stays open and reflects the active gate.
      const status = await request(app).get('/api/migration/status');
      expect(status.status).toBe(200);
      expect(status.body.active).toBe(true);
      expect(status.body.jobId).toBe('gating-2');

      // /api/admin/migration/* stays open (observe + cancel the running job).
      const info = await request(app).get('/api/admin/migration/info').set(auth);
      expect(info.status).toBe(200);

      const presence = await request(app).get('/api/admin/migration/presence').set(auth);
      expect(presence.status).toBe(200);
    } finally {
      getMigrationGate().reset();
    }
  });

  it('gate active -> OPTIONS preflight is not blocked', async () => {
    getMigrationGate().set({ type: 'blobs', jobId: 'gating-3' });
    try {
      const res = await request(app)
        .options('/api/files/anything')
        .set('Origin', 'http://example.test')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.status).not.toBe(503);
    } finally {
      getMigrationGate().reset();
    }
  });
});
