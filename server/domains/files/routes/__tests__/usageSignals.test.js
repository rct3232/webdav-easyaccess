/**
 * Files-domain §3.4 usage-signal recording (PLAN register (a)):
 * GET /download (download | preview by ?inline), GET /preview-stream (preview),
 * POST /download-multiple (download per successfully requested node).
 * Token-authenticated requests only; share principals record nothing.
 * @see docs/spec/server/routes/files.md §2.6, docs/spec/server/store/usageStore.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('@server/test-utils');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('@server/service/composition');
const usageService = require('@server/infrastructure/usageService');

let app;
let dbCleanup;
let webdavMock;
let userId;
let userToken;
let testFileNodeId;
let testVideoNodeId;

let recordEvent;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  process.env.WEA_SKIP_BULK_WORKER = '1';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  const fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  webdavMock = createWebdavMock();
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(webdavMock),
  });

  app = require('@server/index');

  const { user, token } = await createAuthenticatedTestUser({
    username: `usage-${Date.now()}`,
  });
  userId = user.id;
  userToken = token;
  const home = await fileNodeService.createDirectory(null, user.username);
  const file = await fileNodeService.createFile(home.id, 'doc.txt');
  const video = await fileNodeService.createFile(home.id, 'clip.mp4');
  testFileNodeId = file.id;
  testVideoNodeId = video.id;
});

afterAll(async () => {
  delete process.env.WEA_SKIP_BULK_WORKER;
  composition.resetComposition();
  await dbCleanup?.();
});

beforeEach(() => {
  recordEvent = jest.fn().mockResolvedValue({ changes: 1 });
  jest.spyOn(usageService, 'getUsageService').mockReturnValue({ recordEvent });

  webdavMock.getFileContents.mockResolvedValue(Buffer.from('test content'));
  webdavMock.getFileMetadata.mockResolvedValue({
    size: 100,
    lastmod: '2024-01-01',
    mime: 'text/plain',
  });
  webdavMock.pathExists.mockResolvedValue(true);
  webdavMock.isVideoFile.mockImplementation((filename) =>
    String(filename).toLowerCase().endsWith('.mp4')
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function recordedCalls() {
  return recordEvent.mock.calls.map((call) => call[0]);
}

describe('GET /api/files/download — usage signal', () => {
  it('records a download event for an attachment download', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(200);
    expect(recordedCalls()).toEqual([
      { userId: Number(userId), nodeId: Number(testFileNodeId), action: 'download' },
    ]);
  });

  it('records a preview event for an inline download', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId, inline: 'true' });

    expect(res.status).toBe(200);
    expect(recordedCalls()).toHaveLength(1);
    expect(recordedCalls()[0].action).toBe('preview');
  });

  it('records nothing when the download fails (404)', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: 99999999 });

    expect(res.status).toBe(404);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('records nothing for share-principal downloads', async () => {
    const ShareLink = require('@server/models/ShareLink');
    const link = await ShareLink.create(testFileNodeId, userId);

    const res = await request(app)
      .get('/api/files/download')
      .set('X-Share-Token', link.token)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(200);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('a failing usage insert never breaks the download response', async () => {
    recordEvent.mockRejectedValue(new Error('usage insert exploded'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('GET /api/files/preview-stream — usage signal', () => {
  it('records a preview event per successful ticket read', async () => {
    const ticketRes = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testVideoNodeId });
    expect(ticketRes.status).toBe(200);

    const streamRes = await request(app)
      .get('/api/files/preview-stream')
      .query({ nodeId: testVideoNodeId, ticket: ticketRes.body.ticket });
    expect(streamRes.status).toBe(200);

    expect(recordedCalls()).toEqual([
      { userId: Number(userId), nodeId: Number(testVideoNodeId), action: 'preview' },
    ]);
  });
});

describe('POST /api/files/download-multiple — usage signal', () => {
  it('records one download event per requested node that streamed without error', async () => {
    const res = await request(app)
      .post('/api/files/download-multiple')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [testFileNodeId, testVideoNodeId, 99999999] });

    expect(res.status).toBe(200);
    const nodeIds = recordedCalls()
      .filter((event) => event.action === 'download')
      .map((event) => Number(event.nodeId));
    expect(nodeIds).toContain(Number(testFileNodeId));
    expect(nodeIds).toContain(Number(testVideoNodeId));
    expect(nodeIds).not.toContain(99999999);
    for (const event of recordedCalls()) {
      expect(Number(event.userId)).toBe(Number(userId));
    }
  });
});
