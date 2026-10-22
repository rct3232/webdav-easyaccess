'use strict';

/**
 * /api/dashboard routes integration tests (T0.10 — Storage dashboard v1).
 * @see docs/spec/server/routes/dashboard.md
 *
 * The orchestrator (server/index.js) mounts this router at integration time;
 * this suite reproduces the intended mount exactly (after the app-level
 * migrationGate, with setupModeGuardInstance):
 *   app.use('/api/dashboard', setupModeGuardInstance, require('./domains/dashboard/routes'))
 */
const request = require('supertest');
const express = require('express');

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbQuery,
  grantTestPermissionByNodeId,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const composition = require('@server/service/composition');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

let app;
let dbCleanup;
let fileNodeService;

async function storageUser(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `dashrt-${tag}-${Date.now()}`,
  });
  const home = await fileNodeService.createDirectory(null, user.username);
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: home.id, permission: 'admin' });
  return { user, token, homeId: home.id };
}

async function addFile(parentId, name, { size = 100, hash } = {}) {
  const node = await createTestFileNode({ name, type: 'file', parentId });
  await createFileNodesStore().upsertCache(node.nodeId, size, 'text/plain', hash ?? null);
  return node;
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  composition.__setCompositionForTests({
    fileStorageMode: 's3',
    blobStore: {
      downloadBlob: jest.fn(),
      headBlob: jest.fn().mockResolvedValue(null),
      moveBlob: jest.fn().mockResolvedValue(undefined),
      deleteBlob: jest.fn().mockResolvedValue(undefined),
    },
    fileNodeService,
  });

  const setupModeGuard = require('@server/middleware/setupModeGuard');
  app = express();
  app.use(express.json());
  app.use('/api/dashboard', setupModeGuard(), require('../routes'));
  app.use(require('@server/utils/errorHandler').errorHandler);
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

// -- GET / -------------------------------------------------------------------

describe('GET /api/dashboard', () => {
  it('rejects unauthenticated reads with 401', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns snake_case-only hygiene + suggestions + trash from one read', async () => {
    const { token, homeId } = await storageUser('shape');
    const hash = `rt-dup-${Date.now()}`;
    const a = await addFile(homeId, 'a.bin', { hash, size: 120 });
    const b = await addFile(homeId, 'b.bin', { hash, size: 120 });
    await addFile(homeId, 'solo.bin', { hash: `rt-solo-${Date.now()}` });
    const nullA = await addFile(homeId, 'n1.bin', { hash: null, size: 500 });
    const nullB = await addFile(homeId, 'n2.bin', { hash: null, size: 500 });
    await addFile(homeId, 'plain.bin', { hash: `rt-hashed-live-${Date.now()}` });
    const trashedFolderFile = await addFile(homeId, 'folder-inner.bin', { size: 40 });
    const folder = await createTestFileNode({ name: 'gone', type: 'directory', parentId: homeId });
    await addFile(folder.nodeId, 'deep.bin', { size: 60 });
    await createFileNodesStore().markSubtreeDeleted([
      Number(folder.nodeId),
      Number(trashedFolderFile.nodeId),
    ]);
    // the folder's inner file must travel with the subtree marking
    const deep = (
      await dbQuery("SELECT id FROM file_nodes WHERE name = 'deep.bin' AND parent_id = ?", [
        folder.nodeId,
      ])
    ).rows[0];
    await createFileNodesStore().markSubtreeDeleted([Number(deep.id)]);

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 120 },
      suggestions: [
        {
          node_id: Number(b.nodeId),
          kind: 'exact_dup',
          path: expect.stringContaining('/'),
          size_bytes: 120,
          reason: { kind: 'exact_dup', keep_node_id: Number(a.nodeId) },
        },
      ],
      trash: {
        item_count: 2, // folder-inner.bin + deep.bin (child of the trashed folder)
        total_bytes: 100,
        oldest_deleted_at: expect.any(String),
        retention_days: 30,
      },
    });
    // NULL content_hash rows never group (register (b)) and never suggest
    const suggestionIds = res.body.suggestions.map((row) => row.node_id);
    expect(suggestionIds).not.toContain(Number(nullA.nodeId));
    expect(suggestionIds).not.toContain(Number(nullB.nodeId));
    // camelCase leakage guard: every serialized key is snake_case
    for (const key of Object.keys(res.body)) expect(key).not.toMatch(/[A-Z]/);
  });

  it('zeroes (not 404) for a user without a root node', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `dashrt-noroot-${Date.now()}`,
    });
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toEqual({
      group_count: 0,
      duplicate_count: 0,
      reclaimable_bytes: 0,
    });
    expect(res.body.suggestions).toEqual([]);
    expect(res.body.trash).toEqual({
      item_count: 0,
      total_bytes: 0,
      oldest_deleted_at: null,
      retention_days: 30,
    });
  });

  it('never mixes users: another user identical content is absent', async () => {
    const { user, token, homeId } = await storageUser('iso-a');
    const stranger = await storageUser('iso-b');
    const hash = `rt-iso-${Date.now()}`;
    await addFile(homeId, 'mine-1.bin', { hash });
    await addFile(homeId, 'mine-2.bin', { hash });
    await addFile(stranger.homeId, 'theirs-1.bin', { hash });
    await addFile(stranger.homeId, 'theirs-2.bin', { hash });

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.body.duplicates.group_count).toBe(1);
    const resStranger = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(resStranger.body.duplicates.group_count).toBe(1);
    const mineIds = res.body.suggestions.map((row) => row.node_id);
    const theirs = await dbQuery("SELECT id FROM file_nodes WHERE name LIKE 'theirs-%.bin'", []);
    for (const row of theirs.rows) expect(mineIds).not.toContain(Number(row.id));
    void user;
  });
});

// -- POST /suggestions/accept --------------------------------------------------

describe('POST /api/dashboard/suggestions/accept', () => {
  it('rejects unauthenticated accepts with 401', async () => {
    const res = await request(app)
      .post('/api/dashboard/suggestions/accept')
      .send({ nodeIds: [1] });
    expect(res.status).toBe(401);
  });

  it('validates nodeIds: missing/empty/over-cap ⇒ 400 dashboard.emptyNodeIds', async () => {
    const { token } = await storageUser('val');
    for (const body of [
      {},
      { nodeIds: [] },
      { nodeIds: 'nope' },
      { nodeIds: Array.from({ length: 201 }, (_, i) => i + 1) },
    ]) {
      const res = await request(app)
        .post('/api/dashboard/suggestions/accept')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.dashboard.emptyNodeIds);
    }
  });

  it('trashes own accepted rows, rejects foreign/trashed/unknown ids, journals nothing', async () => {
    const { user, token, homeId } = await storageUser('acc');
    const stranger = await storageUser('acc-stranger');
    const keep = await addFile(homeId, 'keep-one.bin', { size: 100 });
    const dup = await addFile(homeId, 'drop-one.bin', { size: 100 });
    const foreign = await addFile(stranger.homeId, 'foreign.bin', {});
    const already = await addFile(homeId, 'already.bin', {});
    await createFileNodesStore().markSubtreeDeleted([Number(already.nodeId)]);

    const journalBefore = Number(
      (await dbQuery('SELECT COUNT(*) AS count FROM action_journal', [])).rows[0].count
    );

    const res = await request(app)
      .post('/api/dashboard/suggestions/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nodeIds: [Number(dup.nodeId), Number(foreign.nodeId), Number(already.nodeId), 999999999],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      trashed: [Number(dup.nodeId)],
      rejected_not_owned: [Number(foreign.nodeId), Number(already.nodeId), 999999999],
      skipped: [],
    });

    const after = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    // only the kept member remains → no group, no suggestion
    expect(after.body.duplicates.group_count).toBe(0);
    expect(after.body.suggestions).toEqual([]);

    const { rows } = await dbQuery('SELECT deleted_at FROM file_nodes WHERE id = ?', [
      Number(keep.nodeId),
    ]);
    expect(rows[0].deleted_at).toBeNull();
    expect(
      Number((await dbQuery('SELECT COUNT(*) AS count FROM action_journal', [])).rows[0].count)
    ).toBe(journalBefore);
    void user;
  });
});

// ---------------------------------------------------------------------------
// Admin operator gate (owner pivot 2026-10-01, routes spec §2.3): the Storage
// dashboard is a personal-storage surface — non-admin only. Both routes
// respond 403 serverErrors.collections.forbidden for admin requesters.
// ---------------------------------------------------------------------------

describe('admin operator gate (dashboard 403 for admin requesters)', () => {
  async function adminStorageUser(tag) {
    const { user, token } = await createAuthenticatedTestUser({
      username: `dashopadm-${tag}-${Date.now()}`,
      isAdmin: true,
    });
    const home = await fileNodeService.createDirectory(null, user.username);
    return { user, token, homeId: home.id };
  }

  it('GET /api/dashboard → 403 forbidden', async () => {
    const admin = await adminStorageUser('read');
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.collections.forbidden);
  });

  it('POST /api/dashboard/suggestions/accept → 403 forbidden, trashes nothing', async () => {
    const admin = await adminStorageUser('accept');
    const journalBefore = Number(
      (await dbQuery('SELECT COUNT(*) AS count FROM action_journal', [])).rows[0].count
    );

    const res = await request(app)
      .post('/api/dashboard/suggestions/accept')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nodeIds: [Number(admin.homeId)] });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.collections.forbidden);

    const { rows } = await dbQuery('SELECT deleted_at FROM file_nodes WHERE id = ?', [
      Number(admin.homeId),
    ]);
    expect(rows[0].deleted_at).toBeNull();
    const journalAfter = Number(
      (await dbQuery('SELECT COUNT(*) AS count FROM action_journal', [])).rows[0].count
    );
    expect(journalAfter).toBe(journalBefore);
  });
});

describe('GET /api/dashboard — vector near-dup block', () => {
  const llmModelsStore = require('@server/store/llmModelsStore');
  const embeddingsStore = require('@server/store/embeddingsStore');
  const presets = require('@server/infrastructure/adapters/llm/presets');

  const THETA = presets.getPresetByFamilyRole('embedded', 'embed').profile.thetaDup;

  afterEach(async () => {
    await dbQuery('DELETE FROM embeddings', []);
    await dbQuery("DELETE FROM llm_models WHERE role = 'embed'", []);
  });

  async function activateEmbedModel() {
    const { id } = await llmModelsStore.upsertModel({
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'embeddinggemma-2-ONNX',
      modelRevision: null,
      precision: 'q4',
      maxInputChars: 8192,
      chunkBudget: 4,
      batchSize: 8,
      enabled: true,
    });
    return id;
  }

  it('serializes near_duplicates + near_dup rows snake_case (θ from the profile)', async () => {
    const { user, token, homeId } = await storageUser('neardup');
    void user;
    const a = await addFile(homeId, 'near-a.txt', { hash: `rt-nd-a-${Date.now()}`, size: 100 });
    const b = await addFile(homeId, 'near-b.txt', { hash: `rt-nd-b-${Date.now()}`, size: 140 });

    const modelId = await activateEmbedModel();
    const t = THETA + 0.001;
    await embeddingsStore.upsert(Number(a.nodeId), {
      modelId,
      dim: 4,
      vector: [1, 0, 0, 0],
      source: 'fulltext',
      contentHash: null,
    });
    await embeddingsStore.upsert(Number(b.nodeId), {
      modelId,
      dim: 4,
      vector: [t, Math.sqrt(1 - t * t), 0, 0],
      source: 'fulltext',
      contentHash: null,
    });

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.near_duplicates).toEqual({ group_count: 1, duplicate_count: 2 });
    const nearRows = res.body.suggestions.filter((row) => row.kind === 'near_dup');
    expect(nearRows).toHaveLength(1);
    const keepId = Math.min(Number(a.nodeId), Number(b.nodeId));
    const memberId = Math.max(Number(a.nodeId), Number(b.nodeId));
    expect(nearRows[0]).toEqual({
      node_id: memberId,
      kind: 'near_dup',
      path: expect.stringContaining('/'),
      size_bytes: memberId === Number(b.nodeId) ? 140 : 100,
      reason: { kind: 'near_dup', keep_node_id: keepId },
    });
    for (const key of Object.keys(res.body)) expect(key).not.toMatch(/[A-Z]/);
  });

  it('omits the near_duplicates key entirely when no embed model is active', async () => {
    const { token, homeId } = await storageUser('nearoff');
    await addFile(homeId, 'solo.txt', { hash: `rt-nd-off-${Date.now()}` });

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('near_duplicates');
    expect(res.body.suggestions.every((row) => row.kind === 'exact_dup')).toBe(true);
  });
});
