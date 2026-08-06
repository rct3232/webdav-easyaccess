/**
 * Recent files routes integration tests (nodeId contract).
 * @see docs/api.md, docs/spec/server/routes/recentFiles.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../../test-utils');
const { createFileNodeService } = require('../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../service/composition');

let app;
let dbCleanup;
let fileNodeService;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  const webdavMock = createWebdavMock();
  const blobStore = new WebdavBlobStore(webdavMock);
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
    fileNodeService,
  });

  app = require('../../../index');
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

async function createUserWithFile() {
  const { user, token } = await createAuthenticatedTestUser({
    username: `recent-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const homeNode = await fileNodeService.createDirectory(null, user.username);
  const fileNode = await fileNodeService.createFile(homeNode.id, 'file.pdf');
  return { user, token, homeNode, fileNode };
}

describe('GET /api/recent-files', () => {
  it('returns empty array when no recent files', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-list-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/recent-files');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/recent-files', () => {
  it('adds file and returns enriched list', async () => {
    const { user, token, fileNode } = await createUserWithFile();

    const res = await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: fileNode.id });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      fileNodeId: fileNode.id,
      name: 'file.pdf',
      type: 'file',
    });
    expect(res.body[0].displayPath).toBe(`/${user.username}/file.pdf`);
  });

  it('returns 400 when fileNodeId missing or invalid', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-add2-${Date.now()}`,
    });

    for (const body of [{}, { fileNodeId: 'not-a-number' }]) {
      const res = await request(app)
        .post('/api/recent-files')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.recentFiles.pathRequired);
    }
  });

  it('returns an error when node does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-add404-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: 999999 });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
  });
});

describe('DELETE /api/recent-files', () => {
  it('clears all recent files', async () => {
    const { token, fileNode } = await createUserWithFile();
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: fileNode.id });

    const res = await request(app)
      .delete('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.recentFiles.clearedSuccess);

    const listRes = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });

  it('removes single entry by fileNodeId', async () => {
    const { token, homeNode, fileNode } = await createUserWithFile();
    const other = await fileNodeService.createFile(homeNode.id, 'other.pdf');
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: fileNode.id });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: other.id });

    const res = await request(app)
      .delete(`/api/recent-files/${fileNode.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((f) => f.fileNodeId === fileNode.id)).toBe(false);
    expect(res.body.some((f) => f.fileNodeId === other.id)).toBe(true);
  });
});
