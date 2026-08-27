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
  direction: 'webdav-to-s3',
  phase: 'copy',
  mode: 'dry-run',
  resume: false,
  force: false,
  dest: { type: 's3', bucket: 'test-bucket', accessKey: 'ak', secretKey: 'sk' },
};

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
  delete process.env.WEA_SKIP_MIGRATION_WORKER;
  jest.clearAllMocks();
});

describe('Route matrix: non-admin denied on every /api/admin/migration/* route', () => {
  it('returns 403 for a non-admin on all 3 migration endpoints', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `migration-nonadmin-${Date.now()}`,
      isAdmin: false,
    });
    const auth = { Authorization: `Bearer ${token}` };

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
      phase: 'copy',
      mode: 'dry-run',
      status: 'pending',
      progress: 0,
      total: 0,
      current: null,
      results: { copied: 0, skipped: 0, failed: 0, errors: [] },
      errorMessage: null,
      completedAt: null,
    });

    expect(fakeMigrationService.run).not.toHaveBeenCalled();
  });

  it('returns 400 with migrationInvalidPayload for an invalid direction', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, direction: 'sideways' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
  });

  it('returns 400 with migrationInvalidPayload for an invalid phase', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_PAYLOAD, phase: 'nuke' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.migrationInvalidPayload);
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

  it('returns 400 with migrationMissingRequired when webdav dest fields are missing', async () => {
    const token = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/migration/blobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 's3-to-webdav',
        phase: 'copy',
        mode: 'dry-run',
        dest: { type: 'webdav', url: 'http://dav' },
      });

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
      direction: 'webdav-to-s3',
      phase: 'copy',
      mode: 'dry-run',
      resume: false,
      force: false,
      destConfig: expect.objectContaining({ type: 's3', bucket: 'test-bucket', accessKey: 'ak', secretKey: 'sk' }),
      onProgress: expect.any(Function),
    }));

    const res = await waitForJobStatus(token, jobId, 'completed');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jobId,
      direction: 'webdav-to-s3',
      phase: 'copy',
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
