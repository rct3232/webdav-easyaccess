/**
 * Recent files routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/recentFiles.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../../test-utils');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../index');
});

afterAll(async () => {
  await dbCleanup?.();
});

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
  it('adds file and returns list', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-add-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/docs/file.pdf', name: 'file.pdf', type: 'file' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      path: '/docs/file.pdf',
      name: 'file.pdf',
      type: 'file',
    });
  });

  it('returns 400 when path missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-add2-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'file.pdf' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('DELETE /api/recent-files', () => {
  it('clears all recent files', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-clear-${Date.now()}`,
    });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/a.pdf' });

    const res = await request(app)
      .delete('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();

    const listRes = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBe(0);
  });

  it('removes single path', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-remove-${Date.now()}`,
    });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/remove-me.pdf', name: 'remove-me.pdf' });

    const res = await request(app)
      .delete('/api/recent-files/' + encodeURIComponent('/remove-me.pdf'))
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((f) => f.path === '/remove-me.pdf')).toBe(false);
  });
});

describe('POST /api/recent-files/apply-moves', () => {
  it('updates store with moved paths', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-apply-${Date.now()}`,
    });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/old/a.pdf', name: 'a.pdf', type: 'file' });

    const res = await request(app)
      .post('/api/recent-files/apply-moves')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: [{ oldPath: '/old/a.pdf', newPath: '/new/a.pdf' }],
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((f) => f.path === '/new/a.pdf')).toBe(true);
    expect(res.body.some((f) => f.path === '/old/a.pdf')).toBe(false);

    const listRes = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((f) => f.path === '/new/a.pdf')).toBe(true);
  });

  it('returns 400 when moves missing or not array', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-moves-val-${Date.now()}`,
    });

    for (const body of [{ moves: null }, {}, { moves: 'string' }]) {
      const res = await request(app)
        .post('/api/recent-files/apply-moves')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.recentFiles.movesRequired);
    }
  });
});

describe('POST /api/recent-files/remove-paths', () => {
  it('updates store by removing file and folder paths', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-remove-paths-${Date.now()}`,
    });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/a.txt', name: 'a.txt', type: 'file' });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/folder', name: 'folder', type: 'folder' });

    const res = await request(app)
      .post('/api/recent-files/remove-paths')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePaths: ['/a.txt'], folderPaths: ['/folder'] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((f) => f.path === '/a.txt')).toBe(false);
    expect(res.body.some((f) => f.path === '/folder')).toBe(false);

    const listRes = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((f) => f.path === '/a.txt')).toBe(false);
  });

  it('returns 400 when filePaths or folderPaths not arrays', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `recent-remove-val-${Date.now()}`,
    });

    for (const body of [{ filePaths: 'x' }, { folderPaths: {} }, { filePaths: 1, folderPaths: [] }]) {
      const res = await request(app)
        .post('/api/recent-files/remove-paths')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.recentFiles.pathsMustBeArrays);
    }
  });
});
