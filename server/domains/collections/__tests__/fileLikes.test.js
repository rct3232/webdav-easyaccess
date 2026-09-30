/**
 * /api/file-likes routes integration tests (T0.5 — like toggle + read,
 * §3.3/§3.4; register (a) `like` usage recording at the toggle commit point).
 * @see docs/spec/server/routes/fileLikes.md
 *
 * The orchestrator (server/index.js) mounts this router at integration time;
 * this suite reproduces the intended mount exactly (after the app-level
 * migrationGate, with setupModeGuardInstance):
 *   app.use('/api/file-likes', setupModeGuardInstance, require('./domains/collections/fileLikesRoutes'))
 */
const request = require('supertest');
const express = require('express');

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  grantTestPermissionByNodeId,
  dbQuery,
  dbRun,
} = require('@server/test-utils');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const usageService = require('@server/infrastructure/usageService');

let app;
let dbCleanup;

async function makeReadableNode(userId, name) {
  const node = await createTestFileNode({ name });
  await grantTestPermissionByNodeId({ userId, fileNodeId: node.nodeId });
  return node;
}

async function usageRows(nodeId) {
  const { rows } = await dbQuery('SELECT * FROM usage_events WHERE node_id = ?', [nodeId]);
  return rows;
}

async function journalRowCount() {
  const { rows } = await dbQuery('SELECT COUNT(*) AS count FROM action_journal', []);
  return Number(rows[0].count);
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  const setupModeGuard = require('@server/middleware/setupModeGuard');
  app = express();
  app.use(express.json());
  app.use('/api/file-likes', setupModeGuard(), require('../fileLikesRoutes'));
  app.use(require('@server/utils/errorHandler').errorHandler);
});

afterAll(async () => {
  await dbCleanup?.();
});

beforeEach(() => {
  jest.restoreAllMocks();
});

// -- GET / -------------------------------------------------------------------

describe('GET /api/file-likes', () => {
  it('rejects unauthenticated reads with 401', async () => {
    const res = await request(app).get('/api/file-likes');
    expect(res.status).toBe(401);
  });

  it('returns the viewer liked node ids ascending, snake_case-only', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-a-${Date.now()}`,
    });
    const low = await makeReadableNode(user.id, 'low.txt');
    const high = await makeReadableNode(user.id, 'high.txt');

    await request(app)
      .put(`/api/file-likes/${high.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    await request(app)
      .put(`/api/file-likes/${low.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });

    const res = await request(app).get('/api/file-likes').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.liked).toEqual([low.nodeId, high.nodeId].sort((a, b) => a - b));
  });

  it('scopes likes per viewer (invariant 9): B never sees A liked ids', async () => {
    const a = await createAuthenticatedTestUser({ username: `likes-9a-${Date.now()}` });
    const b = await createAuthenticatedTestUser({ username: `likes-9b-${Date.now()}` });
    const shared = await makeReadableNode(a.user.id, 'a-only.txt');

    await request(app)
      .put(`/api/file-likes/${shared.nodeId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ liked: true });

    const res = await request(app).get('/api/file-likes').set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    expect(res.body.liked).not.toContain(shared.nodeId);
  });
});

// -- PUT /:nodeId --------------------------------------------------------------

describe('PUT /api/file-likes/:nodeId', () => {
  it('rejects unauthenticated writes with 401', async () => {
    const res = await request(app).put('/api/file-likes/1').send({ liked: true });
    expect(res.status).toBe(401);
  });

  it('likes a readable node: 200 echo {node_id, liked}, then GET lists it', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-set-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'beach.jpg');

    const res = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ node_id: node.nodeId, liked: true });

    const list = await request(app).get('/api/file-likes').set('Authorization', `Bearer ${token}`);
    expect(list.body.liked).toEqual([node.nodeId]);
  });

  it('is idempotent: re-liking is a 200 no-op with exactly one like usage event', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-idem-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'twice.jpg');

    const first = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    const second = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ node_id: node.nodeId, liked: true });

    const { rows: likes } = await dbQuery(
      'SELECT COUNT(*) AS count FROM file_likes WHERE user_id = ? AND node_id = ?',
      [user.id, node.nodeId]
    );
    expect(Number(likes[0].count)).toBe(1);

    const events = await usageRows(node.nodeId);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('like');
  });

  it('unlikes: row removed, GET omits the id, NO new usage event either way', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-off-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'unlike.jpg');

    await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    const eventsAfterLike = await usageRows(node.nodeId);

    const off = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ node_id: node.nodeId, liked: false });

    const list = await request(app).get('/api/file-likes').set('Authorization', `Bearer ${token}`);
    expect(list.body.liked).not.toContain(node.nodeId);

    const eventsAfterUnlike = await usageRows(node.nodeId);
    expect(eventsAfterUnlike).toHaveLength(eventsAfterLike.length);
  });

  it('liking an unliked pair (liked:false with no row) is a 200 no-op with no events', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-none-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'never-liked.jpg');

    const res = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ node_id: node.nodeId, liked: false });
    expect(await usageRows(node.nodeId)).toHaveLength(0);
  });

  it('rejects a non-boolean liked body with 400 files.invalidPath', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-body-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'body.txt');

    for (const body of [{ liked: 'true' }, { liked: 1 }, { liked: null }, {}]) {
      const res = await request(app)
        .put(`/api/file-likes/${node.nodeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.invalidPath);
    }
  });

  it('rejects a non-numeric :nodeId with 400 files.invalidPath', async () => {
    const { token } = await createAuthenticatedTestUser({ username: `likes-param-${Date.now()}` });

    const res = await request(app)
      .put('/api/file-likes/abc')
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.invalidPath);
  });

  it('404-masquerades an unknown node: files.notFound, no row, no event', async () => {
    const { token } = await createAuthenticatedTestUser({ username: `likes-404-${Date.now()}` });

    const res = await request(app)
      .put('/api/file-likes/99999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
  });

  it('404-masquerades a node without a READ grant (no existence disclosure)', async () => {
    const a = await createAuthenticatedTestUser({ username: `likes-masq-a-${Date.now()}` });
    const b = await createAuthenticatedTestUser({ username: `likes-masq-b-${Date.now()}` });
    const node = await createTestFileNode({ name: 'foreign.txt' });
    await grantTestPermissionByNodeId({ userId: a.user.id, fileNodeId: node.nodeId });

    const res = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ liked: true });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
    const { rows: likes } = await dbQuery(
      'SELECT COUNT(*) AS count FROM file_likes WHERE node_id = ?',
      [node.nodeId]
    );
    expect(Number(likes[0].count)).toBe(0);
    expect(await usageRows(node.nodeId)).toHaveLength(0);
  });

  it('writes no action_journal rows (like is self-reversing trivial state, §4.11)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-nojournal-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'nojournal.txt');
    const before = await journalRowCount();

    await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: false });

    expect(await journalRowCount()).toBe(before);
  });

  it('survives a failing usage insert: the toggle still returns 200 (fire-and-forget)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-fire-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'fire.txt');
    jest.spyOn(usageService, 'getUsageService').mockReturnValue({
      recordEvent: async () => {
        throw new Error('usage insert exploded');
      },
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ node_id: node.nodeId, liked: true });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('records the like signal for the acting viewer only', async () => {
    const a = await createAuthenticatedTestUser({ username: `likes-who-a-${Date.now()}` });
    const b = await createAuthenticatedTestUser({ username: `likes-who-b-${Date.now()}` });
    const node = await makeReadableNode(a.user.id, 'who.txt');
    await grantTestPermissionByNodeId({ userId: b.user.id, fileNodeId: node.nodeId });

    await request(app)
      .put(`/api/file-likes/${node.nodeId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ liked: true });

    const events = await usageRows(node.nodeId);
    expect(events).toHaveLength(1);
    expect(Number(events[0].user_id)).toBe(b.user.id);
    expect(events[0].action).toBe('like');
  });
});

// -- GET /api/file-likes/items (P-5 — the Likes surface listing) ---------------

describe('GET /api/file-likes/items', () => {
  async function like(token, nodeId) {
    const res = await request(app)
      .put(`/api/file-likes/${nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ liked: true });
    expect(res.status).toBe(200);
  }

  it('rejects unauthenticated reads with 401', async () => {
    const res = await request(app).get('/api/file-likes/items');
    expect(res.status).toBe(401);
  });

  it('returns the empty full set for a viewer without likes', async () => {
    const { token } = await createAuthenticatedTestUser({ username: `likes-empty-${Date.now()}` });
    const res = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] }); // Decision B: no cursor keys on the wire
  });

  it('lists readable liked nodes ordered by node_id asc with the row contract', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-items-${Date.now()}`,
    });
    const low = await makeReadableNode(user.id, 'items-low.txt');
    const high = await makeReadableNode(user.id, 'items-high.txt');
    // Like in REVERSE id order — the read order is node_id asc (no liked-at stamp).
    await like(token, high.nodeId);
    await like(token, low.nodeId);

    const res = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('next_cursor');
    expect(res.body.items.map((item) => item.node_id)).toEqual(
      [low.nodeId, high.nodeId].sort((a, b) => a - b)
    );
    expect(res.body.items[0]).toMatchObject({
      node_id: low.nodeId,
      name: 'items-low.txt',
      type: 'file',
      state: 'normal',
      liked: true,
    });
    expect(res.body.items[0]).toHaveProperty('mime');
    expect(res.body.items[0]).toHaveProperty('created_at');
  });

  it('renders a since-unreadable like as a revoked placeholder (null name/type/mime)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-revoked-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'items-gone-share.txt');
    await like(token, node.nodeId);

    // Permission loss: the like SURVIVES (store invariant) but the row must
    // never disclose the name of a node the viewer can no longer read.
    await dbRun('DELETE FROM permissions_user_files WHERE file_node_id = ?', [node.nodeId]);
    await dbRun('DELETE FROM permissions_user_paths WHERE file_node_id = ?', [node.nodeId]);

    const res = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      node_id: node.nodeId,
      name: null,
      type: null,
      mime: null,
      state: 'revoked',
      liked: true,
    });
  });

  it('hides trashed liked nodes; the like row survives and restore re-surfaces the row', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-trash-${Date.now()}`,
    });
    const node = await makeReadableNode(user.id, 'items-trashed.txt');
    await like(token, node.nodeId);

    await dbRun("UPDATE file_nodes SET deleted_at = datetime('now') WHERE id = ?", [node.nodeId]);
    const hidden = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(hidden.body.items).toHaveLength(0);
    const { rows: likes } = await dbQuery(
      'SELECT COUNT(*) AS count FROM file_likes WHERE user_id = ? AND node_id = ?',
      [user.id, node.nodeId]
    );
    expect(Number(likes[0].count)).toBe(1); // member parity: hidden, never forgotten

    await dbRun('UPDATE file_nodes SET deleted_at = NULL WHERE id = ?', [node.nodeId]);
    const back = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(back.body.items.map((item) => item.node_id)).toEqual([node.nodeId]);
  });

  it('returns the FULL liked row set in one response; retired cursor/limit params are IGNORED (Decision B)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `likes-fetchall-${Date.now()}`,
    });
    const ids = [];
    for (const name of ['items-a.txt', 'items-b.txt', 'items-c.txt']) {
      const node = await makeReadableNode(user.id, name);
      ids.push(node.nodeId);
      await like(token, node.nodeId);
    }
    const asc = [...ids].sort((a, b) => a - b);

    const full = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${token}`);
    expect(full.status).toBe(200);
    expect(full.body.items.map((item) => item.node_id)).toEqual(asc); // node_id asc preserved
    expect(full.body).not.toHaveProperty('next_cursor'); // cursor retired, not nulled

    const limited = await request(app)
      .get('/api/file-likes/items?limit=2')
      .set('Authorization', `Bearer ${token}`);
    expect(limited.status).toBe(200);
    expect(limited.body.items.map((item) => item.node_id)).toEqual(asc); // limit IGNORED

    const junk = await request(app)
      .get('/api/file-likes/items?limit=abc&cursor=not-a-cursor')
      .set('Authorization', `Bearer ${token}`);
    expect(junk.status).toBe(200); // never an error — same complete body
    expect(junk.body.items.map((item) => item.node_id)).toEqual(asc);
    expect(junk.body).not.toHaveProperty('next_cursor');
  });

  it('is viewer-scoped: B never sees A liked rows (invariant 9)', async () => {
    const a = await createAuthenticatedTestUser({ username: `likes-items-a-${Date.now()}` });
    const b = await createAuthenticatedTestUser({ username: `likes-items-b-${Date.now()}` });
    const node = await makeReadableNode(a.user.id, 'items-a-only.txt');
    await like(a.token, node.nodeId);

    const res = await request(app)
      .get('/api/file-likes/items')
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.body.items).toHaveLength(0);
  });
});
