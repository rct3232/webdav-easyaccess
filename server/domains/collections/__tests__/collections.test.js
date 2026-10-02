/**
 * Collections routes integration tests (§3.1/§3.2 ops, snake_case wire).
 * @see docs/spec/server/routes/collections.md
 * @see docs/api.md (collections rows), docs/TESTING_STRATEGY.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbRun,
  dbQuery,
} = require('@server/test-utils');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('@server/service/composition');
const collectionsStore = require('@server/store/collectionsStore');

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

  app = require('@server/index');
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

beforeEach(jest.clearAllMocks);

async function createUserWithRoot(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `col-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
}

async function createCollectionViaApi(token, body = {}) {
  return request(app)
    .post('/api/collections')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'My collection', ...body });
}

function codes() {
  return SERVER_ERROR_CODES;
}

// supertest leaves a 204 body as '' (no JSON body) — normalize for assertions
function resBody(res) {
  return typeof res.text === 'string' && Object.keys(res.body).length === 0 ? res.text : res.body;
}

// ---------------------------------------------------------------------------
// Lifecycle chain (create → list → rename → archive → restore → delete)
// ---------------------------------------------------------------------------

describe('collection lifecycle (create/list/rename/archive/restore/delete)', () => {
  it('creates a manual collection and returns a snake_case row with an undo pointer', async () => {
    const { token } = await createUserWithRoot('create');

    const res = await createCollectionViaApi(token, { name: 'Europe trip' });

    expect(res.status).toBe(201);
    expect(res.body.undo.action_id).toBeGreaterThan(0);
    const row = res.body.collection;
    expect(row).toMatchObject({
      owner_id: expect.any(Number),
      name: 'Europe trip',
      origin: 'user',
      status: 'active',
      publish_mode: 'ask',
      pinned: false,
      name_locked: false,
      granted_role: null,
      item_count: 0,
      archived_at: null,
    });
    expect(typeof row.collection_id).toBe('number');
    expect(typeof row.created_at).toBe('string');
    expect(typeof row.updated_at).toBe('string');
    // camelCase leakage is forbidden on new endpoints
    expect(row.collectionId).toBeUndefined();
    expect(row.publishMode).toBeUndefined();
  });

  it('lists under default sort=activity with include=mine,shared; unknown sort/include are 400', async () => {
    const { token } = await createUserWithRoot('list');

    await createCollectionViaApi(token, { name: 'B list' });
    await createCollectionViaApi(token, { name: 'A list' });

    const list = await request(app).get('/api/collections').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.collections)).toBe(true);
    expect(list.body.collections).toHaveLength(2);
    // Same-second creates tie on activity_score/last_member_change/created_at;
    // the deterministic contract is the id-DESC tie-break (newest first,
    // routes/collections.md §2.4; RCA 2026-09-23), so 'A list' leads.
    expect(list.body.collections.map((c) => c.name)).toEqual(['A list', 'B list']);

    const byName = await request(app)
      .get('/api/collections?sort=name')
      .set('Authorization', `Bearer ${token}`);
    expect(byName.status).toBe(200);
    expect(byName.body.collections.map((c) => c.name)).toEqual(['A list', 'B list']);

    const badSort = await request(app)
      .get('/api/collections?sort=bogus')
      .set('Authorization', `Bearer ${token}`);
    expect(badSort.status).toBe(400);
    expect(badSort.body.errorCode).toBe(codes().collections.invalidSort);

    const badInclude = await request(app)
      .get('/api/collections?include=mine,bogus')
      .set('Authorization', `Bearer ${token}`);
    expect(badInclude.status).toBe(400);
    expect(badInclude.body.errorCode).toBe(codes().collections.invalidInclude);
  });

  it('activity sort orders by activity_score desc with created_at fallback while scores are zero', async () => {
    const { token } = await createUserWithRoot('actsort');

    // created_at truncates to whole seconds — keep the fallback chain deterministic
    const first = await createCollectionViaApi(token, { name: 'older first' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await createCollectionViaApi(token, { name: 'newer second' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const winner = await createCollectionViaApi(token, { name: 'score winner' });

    // All scores zero → fallback chain (last_member_change_at/created_at) decides.
    await dbRun('UPDATE collections SET activity_score = 0 WHERE owner_id = ?', [
      first.body.collection.owner_id,
    ]);
    await dbRun(`UPDATE collections SET activity_score = 5 WHERE id = ?`, [
      winner.body.collection.collection_id,
    ]);

    const res = await request(app).get('/api/collections').set('Authorization', `Bearer ${token}`);
    const names = res.body.collections.map((c) => c.name);
    expect(names[0]).toBe('score winner');
    // fallback: newest created first among zero-score rows
    expect(names.slice(1)).toEqual(['newer second', 'older first']);

    // stale timestamps stay stable
    expect(second.body.collection.collection_id).toBeGreaterThan(
      first.body.collection.collection_id
    );
  });

  it('rename locks the name; archive/restore guard their states; delete requires archive', async () => {
    const { token } = await createUserWithRoot('rename');
    const created = await createCollectionViaApi(token, { name: 'Trip' });
    const id = created.body.collection.collection_id;

    const renamed = await request(app)
      .put(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Trip renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.collection.name_locked).toBe(true);
    expect(renamed.body.collection.name).toBe('Trip renamed');
    expect(renamed.body.undo.action_id).toBeGreaterThan(0);

    const archive = await request(app)
      .post(`/api/collections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`);
    expect(archive.status).toBe(200);
    expect(archive.body.collection.status).toBe('archived');
    expect(archive.body.undo.action_id).toBeGreaterThan(0);

    const again = await request(app)
      .post(`/api/collections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);
    expect(again.body.errorCode).toBe(codes().collections.alreadyArchived);

    const restore = await request(app)
      .post(`/api/collections/${id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    expect(restore.status).toBe(200);
    expect(restore.body.collection.status).toBe('active');

    const notArchived = await request(app)
      .post(`/api/collections/${id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    expect(notArchived.status).toBe(409);
    expect(notArchived.body.errorCode).toBe(codes().collections.notArchived);

    const activeDelete = await request(app)
      .delete(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(activeDelete.status).toBe(409);
    expect(activeDelete.body.errorCode).toBe(codes().collections.notArchived);

    await request(app)
      .post(`/api/collections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`);

    const del = await request(app)
      .delete(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
    expect(resBody(del)).toBe('');

    const gone = await request(app)
      .get(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);
    expect(gone.body.errorCode).toBe(codes().collections.notFound);
  });

  it('name collisions on create and restore auto-suffix instead of erroring', async () => {
    const { token } = await createUserWithRoot('suffix');

    const a = await createCollectionViaApi(token, { name: 'Photos' });
    expect(a.status).toBe(201);
    const b = await createCollectionViaApi(token, { name: 'Photos' });
    expect(b.status).toBe(201);
    expect(b.body.collection.name).toBe('Photos (2)');
    const c = await createCollectionViaApi(token, { name: 'Photos' });
    expect(c.body.collection.name).toBe('Photos (3)');

    // restore collision: archive b, then create "Photos" again, restore b.
    await request(app)
      .post(`/api/collections/${b.body.collection.collection_id}/archive`)
      .set('Authorization', `Bearer ${token}`);
    const c2 = await createCollectionViaApi(token, { name: 'Photos (2)' });
    expect(c2.status).toBe(201);
    const restored = await request(app)
      .post(`/api/collections/${b.body.collection.collection_id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    expect(restored.status).toBe(200);
    expect(restored.body.collection.name).toBe('Photos (2) (2)');
  });

  it('validates create payloads (missing/invalid name)', async () => {
    const { token } = await createUserWithRoot('nameval');

    const missing = await request(app)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.errorCode).toBe(codes().collections.nameRequired);

    const blank = await request(app)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.errorCode).toBe(codes().collections.nameRequired);

    const reserved = await request(app)
      .post('/api/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '.wea-trash' });
    expect(reserved.status).toBe(400);
    expect(reserved.body.errorCode).toBe(codes().collections.invalidName);
  });
});

// ---------------------------------------------------------------------------
// Access control: 404 masquerade, viewer 403, editor rules
// ---------------------------------------------------------------------------

describe('access control (masquerade + role rules)', () => {
  it('hides ungranted collections behind 404 for reads and mutations', async () => {
    const owner = await createUserWithRoot('masq-owner');
    const stranger = await createUserWithRoot('masq-stranger');

    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;

    const get = await request(app)
      .get(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(get.status).toBe(404);
    expect(get.body.errorCode).toBe(codes().collections.notFound);

    const items = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(items.status).toBe(404);

    const mutate = await request(app)
      .put(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ name: 'Nope' });
    expect(mutate.status).toBe(404);
  });

  it('grants a viewer read access without definition; viewer mutations are 403', async () => {
    const owner = await createUserWithRoot('viewer-owner');
    const viewer = await createUserWithRoot('viewer-grantee');

    const created = await createCollectionViaApi(owner.token, { name: 'Shared one' });
    const id = created.body.collection.collection_id;

    const grant = await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });
    expect(grant.status).toBe(201);
    expect(grant.body.grant).toMatchObject({ grantee_id: viewer.user.id, role: 'viewer' });
    expect(grant.body.undo.action_id).toBeGreaterThan(0);

    const list = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${viewer.token}`);
    const sharedRow = list.body.collections.find((c) => c.collection_id === id);
    expect(sharedRow).toBeDefined();
    expect(sharedRow.granted_role).toBe('viewer');
    expect(sharedRow.definition).toBeUndefined();
    expect(sharedRow.owner_id).toBe(owner.user.id);

    const add = await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ nodeIds: [1] });
    expect(add.status).toBe(403);
    expect(add.body.errorCode).toBe(codes().collections.forbidden);

    const put = await request(app)
      .put(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: 'Nope' });
    expect(put.status).toBe(403);

    const grants = await request(app)
      .get(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(grants.status).toBe(403);

    // owner sees the definition-bearing row with granted_role null
    const ownerList = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${owner.token}`);
    const ownRow = ownerList.body.collections.find((c) => c.collection_id === id);
    expect(ownRow.granted_role).toBeNull();
    expect('definition' in ownRow).toBe(true);
  });

  it('revokes a grant instantly and 404s unknown grant rows', async () => {
    const owner = await createUserWithRoot('revoke-owner');
    const viewer = await createUserWithRoot('revoke-viewer');
    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;

    await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });

    const revoke = await request(app)
      .delete(`/api/collections/${id}/grants?userId=${viewer.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ grantee_id: viewer.user.id, revoked: true });
    expect(revoke.body.undo.action_id).toBeGreaterThan(0);

    const after = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(after.status).toBe(404);

    const missing = await request(app)
      .delete(`/api/collections/${id}/grants?userId=${viewer.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe(codes().collections.grantNotFound);

    const unknownUser = await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: 999999, role: 'viewer' });
    expect(unknownUser.status).toBe(404);
    expect(unknownUser.body.errorCode).toBe(codes().collections.granteeNotFound);

    const badRole = await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'admin' });
    expect(badRole.status).toBe(400);
    expect(badRole.body.errorCode).toBe(codes().collections.invalidRole);
  });
});

// ---------------------------------------------------------------------------
// Grantee self-revocation — DELETE /:id/grants/me (P-1 Path 1)
// ---------------------------------------------------------------------------

describe('grants/me — recipient self-revocation (P-1 Path 1)', () => {
  async function grantViaApi(ownerToken, id, userId, role) {
    return request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, role });
  }

  it('a granted viewer self-revokes: row drops from the shared list, response mirrors the owner DELETE', async () => {
    const owner = await createUserWithRoot('me-viewer-owner');
    const viewer = await createUserWithRoot('me-viewer-grantee');
    const created = await createCollectionViaApi(owner.token, { name: 'Given to me' });
    const id = created.body.collection.collection_id;
    await grantViaApi(owner.token, id, viewer.user.id, 'viewer');

    const before = await request(app)
      .get('/api/collections?include=mine,shared')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(before.body.collections.map((c) => c.collection_id)).toContain(id);

    const revoke = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ grantee_id: viewer.user.id, revoked: true });
    expect(revoke.body.undo.action_id).toBeGreaterThan(0);

    const after = await request(app)
      .get('/api/collections?include=mine,shared')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(after.body.collections.map((c) => c.collection_id)).not.toContain(id);

    const items = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(items.status).toBe(404);
    expect(items.body.errorCode).toBe(codes().collections.notFound);

    const grants = await request(app)
      .get(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(grants.body.grants).toEqual([]);
  });

  it('an editor grantee self-revokes through the same endpoint', async () => {
    const owner = await createUserWithRoot('me-editor-owner');
    const editor = await createUserWithRoot('me-editor-grantee');
    const created = await createCollectionViaApi(owner.token, { name: 'Editable share' });
    const id = created.body.collection.collection_id;
    await grantViaApi(owner.token, id, editor.user.id, 'editor');

    const revoke = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ grantee_id: editor.user.id, revoked: true });

    const access = await request(app)
      .get(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(access.status).toBe(404);
  });

  it('404s grantNotFound for owner self-calls; a revoked grantee re-calling 404-masquerades', async () => {
    const owner = await createUserWithRoot('me-owner-self');
    const viewer = await createUserWithRoot('me-double-grantee');
    const created = await createCollectionViaApi(owner.token, { name: 'Mine' });
    const id = created.body.collection.collection_id;

    const ownerSelf = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerSelf.status).toBe(404);
    expect(ownerSelf.body.errorCode).toBe(codes().collections.grantNotFound);

    await grantViaApi(owner.token, id, viewer.user.id, 'viewer');
    const first = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(first.status).toBe(200);

    // no grant row left → the caller is zero-access → 404 masquerade (not grantNotFound)
    const second = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(second.status).toBe(404);
    expect(second.body.errorCode).toBe(codes().collections.notFound);
  });

  it('404-masquerades zero-access callers and unknown collections (existence never leaks)', async () => {
    const owner = await createUserWithRoot('me-mask-owner');
    const stranger = await createUserWithRoot('me-mask-stranger');
    const created = await createCollectionViaApi(owner.token, { name: 'Private' });
    const id = created.body.collection.collection_id;

    const strangerCall = await request(app)
      .delete(`/api/collections/${id}/grants/me`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(strangerCall.status).toBe(404);
    expect(strangerCall.body.errorCode).toBe(codes().collections.notFound);

    const unknownId = await request(app)
      .delete('/api/collections/99999999/grants/me')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(unknownId.status).toBe(404);
    expect(unknownId.body.errorCode).toBe(codes().collections.notFound);
  });
});

// ---------------------------------------------------------------------------
// Membership: add/remove, publish gate, digest, enrichment
// ---------------------------------------------------------------------------

describe('member view (stored ∪ derived − exclusions)', () => {
  async function setupOwnerWithNodes(tag) {
    const ctx = await createUserWithRoot(`items-${tag}`);
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const beach = await fileNodeService.createFile(travel.id, 'beach.jpg');
    const stay = await fileNodeService.createFile(ctx.root.id, 'stay.jpg');
    return { ...ctx, travel, beach, stay };
  }

  function systemDefCollection(ownerId, name, definition) {
    return collectionsStore.createCollection(
      { ownerId, name, origin: 'system', definition },
      { actor: ownerId }
    );
  }

  it('composes stored ∪ derived − exclusions, hides trashed, renders revoked placeholders', async () => {
    const ctx = await setupOwnerWithNodes('compose');
    const system = await systemDefCollection(ctx.user.id, 'Travel shots', {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    });

    const other = await createUserWithRoot('compose-foreign');
    const foreignFile = await fileNodeService.createFile(other.root.id, 'foreign.png');
    await grantTestPermissionByNodeId({
      userId: ctx.user.id,
      fileNodeId: foreignFile.id,
      permission: 'read',
    });

    // stored member: /stay.jpg via API
    const add = await request(app)
      .post(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.stay.id, foreignFile.id] });
    expect(add.status).toBe(200);
    expect(add.body.added).toEqual([ctx.stay.id, foreignFile.id]);
    expect(add.body.undo.action_id).toBeGreaterThan(0);

    const items = await request(app)
      .get(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(items.status).toBe(200);
    const byNode = new Map(items.body.items.map((i) => [i.node_id, i]));

    // derived member (path rule) + stored member + foreign member chip
    expect(byNode.get(ctx.beach.id)).toMatchObject({
      membership: 'derived',
      state: 'normal',
      published: false,
      reason: `path:/${ctx.user.username}/travel`,
      shared_excluded: false,
      added_by: null,
      liked: false,
    });
    expect(byNode.get(ctx.stay.id)).toMatchObject({
      membership: 'stored',
      state: 'normal',
      added_by: ctx.user.id,
    });
    expect(byNode.get(foreignFile.id)).toMatchObject({
      membership: 'stored',
      state: 'normal',
      shared_excluded: true,
    });
    expect(items.body).not.toHaveProperty('next_cursor'); // Decision B: key absent, not nulled
    // owner-only key present
    expect(typeof items.body.publish_pending_count).toBe('number');

    // trashed member is hidden, row kept
    await dbRun("UPDATE file_nodes SET deleted_at = datetime('now') WHERE id = ?", [ctx.stay.id]);
    // revoked member: permission rows removed → unreadable → placeholder with null name
    await dbRun('DELETE FROM permissions_user_files WHERE file_node_id = ?', [foreignFile.id]);
    await dbRun('DELETE FROM permissions_user_paths WHERE file_node_id = ?', [foreignFile.id]);

    const after = await request(app)
      .get(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    const afterByNode = new Map(after.body.items.map((i) => [i.node_id, i]));
    expect(afterByNode.has(ctx.stay.id)).toBe(false);
    expect(afterByNode.get(foreignFile.id)).toMatchObject({
      state: 'revoked',
      name: null,
      type: null,
    });
  });

  it('returns the FULL member set in one response; retired cursor/limit params are IGNORED (Decision B)', async () => {
    const ctx = await setupOwnerWithNodes('fetch-all');
    const system = await systemDefCollection(ctx.user.id, 'All files', {
      kind: 'predicate',
      all_of: [{ type: 'path', value: `/${ctx.user.username}` }],
    });

    const add = await request(app)
      .post(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.beach.id, ctx.stay.id] });
    expect(add.status).toBe(200);

    const full = await request(app)
      .get(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(full.status).toBe(200);
    const fullIds = full.body.items.map((i) => i.node_id);
    expect(fullIds.length).toBeGreaterThanOrEqual(3); // the whole set — no slice, no page join
    // all scores absent → node_id asc (order of the retired keyset, preserved)
    expect([...fullIds]).toEqual([...fullIds].sort((a, b) => a - b));
    expect(full.body).not.toHaveProperty('next_cursor');
    // owner-only key stays; digest only with since
    expect(typeof full.body.publish_pending_count).toBe('number');
    expect(full.body.digest).toBeUndefined();

    // the retired params are IGNORED, never an error — complete body every time
    const limited = await request(app)
      .get(`/api/collections/${system.id}/items?limit=2`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(limited.status).toBe(200);
    expect(limited.body.items.map((i) => i.node_id)).toEqual(fullIds); // limit IGNORED (would cap at 2)

    const junk = await request(app)
      .get(`/api/collections/${system.id}/items?limit=abc&cursor=not-a-cursor`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(junk.status).toBe(200);
    expect(junk.body.items.map((i) => i.node_id)).toEqual(fullIds);
    expect(junk.body).not.toHaveProperty('next_cursor');
  });

  it('returns digest counts for since and advances the visit cursor on read', async () => {
    const ctx = await setupOwnerWithNodes('digest');
    const system = await systemDefCollection(ctx.user.id, 'Digest col', {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    });

    const first = await request(app)
      .get(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(first.status).toBe(200);
    expect(first.body.digest).toBeUndefined();

    // `since` after the first read: the derived member predates it, the add below follows it
    const since = new Date();
    // sqlite timestamps truncate to whole seconds — keep `since` strictly behind the add
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // add a stored member after `since`
    await request(app)
      .post(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.stay.id] });

    const withSince = await request(app)
      .get(`/api/collections/${system.id}/items?since=${encodeURIComponent(since.toISOString())}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(withSince.status).toBe(200);
    expect(withSince.body.digest).toEqual({ added_since: 1, removed_since: 0 });

    // remove it, then ask again with a fresh since (cursor advanced by the read above)
    await request(app)
      .delete(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.stay.id] });

    const fresh = new Date();
    const second = await request(app)
      .get(`/api/collections/${system.id}/items?since=${encodeURIComponent(fresh.toISOString())}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(second.status).toBe(200);
    expect(second.body.digest).toEqual({ added_since: 0, removed_since: 0 });
  });

  it('publish gate: ask-mode new members are invisible to grantees; auto flips; pending count is owner-only', async () => {
    const owner = await createUserWithRoot('publish-owner');
    const viewer = await createUserWithRoot('publish-viewer');
    const created = await createCollectionViaApi(owner.token, { name: 'Publish col' });
    const id = created.body.collection.collection_id;
    const file = await fileNodeService.createFile(owner.root.id, 'shared.txt');

    await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });

    // ask mode (default): stored rows start published=false
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [file.id] });

    const ownerItems = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerItems.body.publish_pending_count).toBe(1);
    expect(ownerItems.body.items).toHaveLength(1);
    expect(ownerItems.body.items[0].published).toBe(false);

    const viewerItems = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(viewerItems.body.items).toHaveLength(0);
    expect(viewerItems.body.publish_pending_count).toBeUndefined();

    // auto mode publishes on add
    await request(app)
      .put(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ publishMode: 'auto' });
    const file2 = await fileNodeService.createFile(owner.root.id, 'auto.txt');
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [file2.id] });

    const viewerAfter = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(viewerAfter.body.items).toHaveLength(1);
    expect(viewerAfter.body.items[0].published).toBe(true);

    const badMode = await request(app)
      .put(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ publishMode: 'sometimes' });
    expect(badMode.status).toBe(400);
    expect(badMode.body.errorCode).toBe(codes().collections.invalidPublishMode);
  });

  it('add validates nodeIds and reports unreadable nodes while adding the rest', async () => {
    const ctx = await setupOwnerWithNodes('addval');
    const created = await createCollectionViaApi(ctx.token);
    const id = created.body.collection.collection_id;
    const stranger = await createUserWithRoot('addval-other');
    const strangerFile = await fileNodeService.createFile(stranger.root.id, 'secret.txt');

    for (const body of [
      {},
      { nodeIds: [] },
      { nodeIds: ['abc'] },
      { nodeIds: Array.from({ length: 201 }, (_, i) => i + 1) },
    ]) {
      const res = await request(app)
        .post(`/api/collections/${id}/items`)
        .set('Authorization', `Bearer ${ctx.token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(codes().collections.emptyNodeIds);
    }

    const partial = await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.beach.id, strangerFile.id] });
    expect(partial.status).toBe(200);
    expect(partial.body.added).toEqual([ctx.beach.id]);
    expect(partial.body.rejected_not_readable).toEqual([strangerFile.id]);

    const duplicate = await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.beach.id] });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.added).toEqual([]);
    expect(duplicate.body.already_members).toEqual([ctx.beach.id]);
  });

  it('remove splits stored deletes from derived exclusions and ignores user-origin exclusions', async () => {
    const ctx = await setupOwnerWithNodes('remove');
    const system = await systemDefCollection(ctx.user.id, 'Remove col', {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    });
    await request(app)
      .post(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.stay.id] });

    const res = await request(app)
      .delete(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.stay.id, ctx.beach.id] });
    expect(res.status).toBe(200);
    expect(res.body.removed).toEqual([ctx.stay.id]);
    expect(res.body.excluded).toEqual([ctx.beach.id]);
    expect(res.body.ignored).toEqual([]);
    expect(res.body.undo.action_id).toBeGreaterThan(0);

    // the node itself is untouched (membership-only)
    const node = await fileNodeService.getNode(ctx.beach.id);
    expect(node).not.toBeNull();

    // excluded derived node no longer resolves
    const items = await request(app)
      .get(`/api/collections/${system.id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(items.body.items.some((i) => i.node_id === ctx.beach.id)).toBe(false);

    // user-origin: derived match would land in ignored (no stored row → ignored)
    const userCol = await createCollectionViaApi(ctx.token, { name: 'User origin' });
    const userRes = await request(app)
      .delete(`/api/collections/${userCol.body.collection.collection_id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.beach.id] });
    expect(userRes.status).toBe(200);
    expect(userRes.body.ignored).toEqual([ctx.beach.id]);
  });

  it('editor can remove what they added but not owner-added rows', async () => {
    const owner = await createUserWithRoot('editor-owner');
    const editor = await createUserWithRoot('editor-user');
    const created = await createCollectionViaApi(owner.token, { name: 'Editor col' });
    const id = created.body.collection.collection_id;

    await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: editor.user.id, role: 'editor' });

    const ownerFile = await fileNodeService.createFile(owner.root.id, 'owner-file.txt');
    const editorFile = await fileNodeService.createFile(editor.root.id, 'editor-file.txt');
    await grantTestPermissionByNodeId({
      userId: editor.user.id,
      fileNodeId: ownerFile.id,
      permission: 'read',
    });

    // editor adds their own file
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ nodeIds: [editorFile.id] });
    // owner adds their file
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [ownerFile.id] });

    const ok = await request(app)
      .delete(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ nodeIds: [editorFile.id] });
    expect(ok.status).toBe(200);
    expect(ok.body.removed).toEqual([editorFile.id]);

    const denied = await request(app)
      .delete(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ nodeIds: [ownerFile.id] });
    expect(denied.status).toBe(403);
    expect(denied.body.errorCode).toBe(codes().collections.forbidden);
  });
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe('preview endpoints', () => {
  async function setupPreviewUser(tag) {
    const ctx = await createUserWithRoot(`preview-${tag}`);
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    await fileNodeService.createFile(travel.id, 'beach.jpg');
    await fileNodeService.createFile(travel.id, 'map.png');
    await fileNodeService.createFile(ctx.root.id, 'note.txt');
    return { ...ctx, travel };
  }

  it('dry-runs a predicate definition with zero LLM configuration', async () => {
    const ctx = await setupPreviewUser('rule');

    const res = await request(app)
      .post('/api/collections/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      });
    expect(res.status).toBe(200);
    // the travel directory itself matches the prefix rule (files + folder)
    expect(res.body.count).toBe(3);
    expect(res.body.sample).toHaveLength(3);
    expect(
      res.body.sample.every((s) => typeof s.node_id === 'number' && typeof s.name === 'string')
    ).toBe(true);
    expect(res.body.sample_truncated).toBe(false);
  });

  it('rejects 0 or 2 preview targets and malformed definitions', async () => {
    const ctx = await setupPreviewUser('targets');

    const none = await request(app)
      .post('/api/collections/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({});
    expect(none.status).toBe(400);
    expect(none.body.errorCode).toBe(codes().collections.previewTargetRequired);

    const both = await request(app)
      .post('/api/collections/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ seedNodeId: 123, definition: { kind: 'predicate', any_of: [] } });
    expect(both.status).toBe(400);
    expect(both.body.errorCode).toBe(codes().collections.previewTargetRequired);

    const badDef = await request(app)
      .post('/api/collections/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ definition: { kind: 'predicate', any_of: [{ type: 'wat' }] } });
    expect(badDef.status).toBe(400);
    expect(badDef.body.errorCode).toBe(codes().collections.invalidDefinition);
  });

  it('seed preview without an embed role is 409 ai.notConfigured', async () => {
    const ctx = await setupPreviewUser('seed');

    const res = await request(app)
      .post('/api/collections/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ seedNodeId: ctx.travel.id });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(codes().ai.notConfigured);

    const seedCreate = await request(app)
      .post('/api/collections')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ name: 'Seed col', seedNodeId: ctx.travel.id });
    expect(seedCreate.status).toBe(409);
    expect(seedCreate.body.errorCode).toBe(codes().ai.notConfigured);
  });

  it('preview of an existing collection is owner-only and dry-runs the stored definition', async () => {
    const owner = await createUserWithRoot('prev-existing');
    const created = await createCollectionViaApi(owner.token, { name: 'Manual col' });
    const id = created.body.collection.collection_id;

    const empty = await request(app)
      .post(`/api/collections/${id}/preview`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(empty.status).toBe(200);
    expect(empty.body.count).toBe(0);
    expect(empty.body.sample).toEqual([]);

    const stranger = await createUserWithRoot('prev-stranger');
    // ungranted reads masquerade as 404 (routes spec §2.4.2 blanket Decision)
    const masqueraded = await request(app)
      .post(`/api/collections/${id}/preview`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({});
    expect(masqueraded.status).toBe(404);
    expect(masqueraded.body.errorCode).toBe(codes().collections.notFound);
  });
});

// ---------------------------------------------------------------------------
// Merge lifecycle
// ---------------------------------------------------------------------------

describe('merge suggestions and execution', () => {
  async function setupMergePair(tag, { score = 812 } = {}) {
    const ctx = await createUserWithRoot(`merge-${tag}`);
    const a = await createCollectionViaApi(ctx.token, { name: 'Europe' });
    const b = await createCollectionViaApi(ctx.token, { name: '2026 trip' });
    const aId = a.body.collection.collection_id;
    const bId = b.body.collection.collection_id;
    return { ...ctx, aId, bId, score };
  }

  it('lists pending suggestions owned by the requester, score desc', async () => {
    const ctx = await setupMergePair('list');
    const stranger = await createUserWithRoot('merge-stranger');

    await collectionsStore.upsertMergeSuggestion(ctx.aId, ctx.bId, ctx.score);

    const res = await request(app)
      .get('/api/collections/merge-suggestions')
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    const row = res.body.suggestions[0];
    expect(row).toMatchObject({
      suggestion_id: expect.any(Number),
      a_id: ctx.aId,
      a_name: 'Europe',
      b_id: ctx.bId,
      b_name: '2026 trip',
      score: ctx.score,
    });
    expect(typeof row.overlap_count).toBe('number');
    expect(typeof row.merged_count).toBe('number');

    // a stranger owning neither side sees nothing
    const strangerRes = await request(app)
      .get('/api/collections/merge-suggestions')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(strangerRes.body.suggestions).toHaveLength(0);
  });

  it('executes a merge: survivor absorbs, loser is gone, suggestion flips to merged', async () => {
    const ctx = await setupMergePair('exec');
    await request(app)
      .post(`/api/collections/${ctx.aId}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.root.id] });
    await request(app)
      .post(`/api/collections/${ctx.bId}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [ctx.root.id] });

    const res = await request(app)
      .post(`/api/collections/${ctx.aId}/merge/${ctx.bId}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body.survivor).toMatchObject({
      collection_id: ctx.aId,
      name: 'Europe',
    });
    expect(res.body.absorbed_id).toBe(ctx.bId);
    expect(res.body.undo.action_id).toBeGreaterThan(0);

    const loser = await request(app)
      .get(`/api/collections/${ctx.bId}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(loser.status).toBe(404);

    const suggestions = await request(app)
      .get('/api/collections/merge-suggestions')
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(suggestions.body.suggestions).toHaveLength(0);
    // the pair's suggestion row is flipped to 'merged' and then cascaded away
    // with the loser row (FK cascade on both sides of the pair)
    const states = await dbQuery(
      'SELECT state FROM collection_merge_suggestions WHERE a_id = ? AND b_id = ?',
      [Math.min(ctx.aId, ctx.bId), Math.max(ctx.aId, ctx.bId)]
    );
    expect(states.rows).toHaveLength(0);
  });

  it('merges any owned active pair without a suggestion row; same-id merge is 400', async () => {
    const ctx = await setupMergePair('noSuggestion');

    const same = await request(app)
      .post(`/api/collections/${ctx.aId}/merge/${ctx.aId}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(same.status).toBe(400);
    expect(same.body.errorCode).toBe(codes().collections.mergeSameCollection);

    const res = await request(app)
      .post(`/api/collections/${ctx.aId}/merge/${ctx.bId}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body.absorbed_id).toBe(ctx.bId);
  });

  it('dismiss defers and reject permanently suppresses the pair', async () => {
    const ctx = await setupMergePair('dismiss');
    await collectionsStore.upsertMergeSuggestion(ctx.aId, ctx.bId, 500);

    const dismiss = await request(app)
      .post(`/api/collections/${ctx.aId}/merge-dismiss`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ otherId: ctx.bId });
    expect(dismiss.status).toBe(200);
    expect(dismiss.body).toMatchObject({ suggestion_id: expect.any(Number), state: 'dismissed' });
    expect(typeof dismiss.body.dismissed_at).toBe('string');

    const missing = await request(app)
      .post(`/api/collections/${ctx.aId}/merge-dismiss`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ otherId: ctx.bId });
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe(codes().collections.suggestionNotFound);

    // reject is terminal: a dismissed pair has no PENDING row, so reject 404s
    // until evolution re-suggests; here a fresh pair proves the reject path.
    const reject = await request(app)
      .post(`/api/collections/${ctx.aId}/merge-reject`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ otherId: ctx.bId });
    expect(reject.status).toBe(404);
    expect(reject.body.errorCode).toBe(codes().collections.suggestionNotFound);

    const otherPair = await setupMergePair('reject');
    await collectionsStore.upsertMergeSuggestion(otherPair.aId, otherPair.bId, 500);
    const reject2 = await request(app)
      .post(`/api/collections/${otherPair.aId}/merge-reject`)
      .set('Authorization', `Bearer ${otherPair.token}`)
      .send({ otherId: otherPair.bId });
    expect(reject2.status).toBe(200);
    expect(reject2.body.state).toBe('rejected');
    expect(typeof reject2.body.rejected_at).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// for-nodes
// ---------------------------------------------------------------------------

describe('POST /for-nodes membership chips', () => {
  it('returns one entry per requested node including derived membership', async () => {
    const ctx = await createUserWithRoot('fornodes');
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const beach = await fileNodeService.createFile(travel.id, 'beach.jpg');
    const stay = await fileNodeService.createFile(ctx.root.id, 'stay.txt');

    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Travel rule',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    const manual = await createCollectionViaApi(ctx.token);
    await request(app)
      .post(`/api/collections/${manual.body.collection.collection_id}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [stay.id] });

    const res = await request(app)
      .post('/api/collections/for-nodes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [beach.id, stay.id] });
    expect(res.status).toBe(200);
    expect(res.body.memberships).toEqual([
      {
        node_id: beach.id,
        collection_ids: expect.arrayContaining([system.id]),
      },
      {
        node_id: stay.id,
        collection_ids: expect.arrayContaining([manual.body.collection.collection_id]),
      },
    ]);

    const empty = await request(app)
      .post('/api/collections/for-nodes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.errorCode).toBe(codes().collections.emptyNodeIds);
  });
});

// ---------------------------------------------------------------------------
// Wire contract: undo pointers and setup-mode guard
// ---------------------------------------------------------------------------

describe('wire contract invariants', () => {
  it('GET / rows carry preview_items (≤4 newest-added, revoked never) and items carry mime (P-3)', async () => {
    const ctx = await createUserWithRoot('preview-wire');
    const created = await createCollectionViaApi(ctx.token, { name: 'Preview wire' });
    const collectionId = created.body.collection.collection_id;

    const files = [];
    for (let i = 0; i < 5; i += 1) {
      files.push(await fileNodeService.createFile(ctx.root.id, `wire${i}.jpg`));
    }
    await request(app)
      .post(`/api/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ nodeIds: files.map((f) => f.id) });

    const items = await request(app)
      .get(`/api/collections/${collectionId}/items`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(items.status).toBe(200);
    expect(items.body.items[0]).toHaveProperty('mime');

    const list = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(list.status).toBe(200);
    const row = list.body.collections.find((c) => c.collection_id === collectionId);
    expect(row.preview_items).toHaveLength(4);
    // same-second adds: deterministic node_id DESC tie-break (newest ids first)
    expect(row.preview_items.map((p) => p.node_id)).toEqual([
      files[4].id,
      files[3].id,
      files[2].id,
      files[1].id,
    ]);
    expect(Object.keys(row.preview_items[0]).sort()).toEqual(['mime', 'name', 'node_id', 'type']);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/collections');
    expect(res.status).toBe(401);
  });

  it('carries no undo pointer on permanent delete', async () => {
    const ctx = await createUserWithRoot('no-undo');
    const created = await createCollectionViaApi(ctx.token);
    const id = created.body.collection.collection_id;
    await request(app)
      .post(`/api/collections/${id}/archive`)
      .set('Authorization', `Bearer ${ctx.token}`);

    const res = await request(app)
      .delete(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(res.status).toBe(204);
    expect(resBody(res)).toBe('');
  });

  it('mount sits behind the setup-mode guard while setup is incomplete', async () => {
    const prevWorker = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app).get('/api/collections');
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe(codes().setup.incomplete);
    } finally {
      process.env.JEST_WORKER_ID = prevWorker;
    }
  });
});

// ---------------------------------------------------------------------------
// PUT /:id/items/publish (P-4)
// ---------------------------------------------------------------------------

describe('PUT /:id/items/publish (P-4 member publish)', () => {
  it('flips a stored ask-mode member and flips grantee visibility', async () => {
    const owner = await createUserWithRoot('pub-r-owner');
    const viewer = await createUserWithRoot('pub-r-viewer');
    const travel = await fileNodeService.createDirectory(owner.root.id, 'ptravel');
    const beach = await fileNodeService.createFile(travel.id, 'pub-beach.jpg');

    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [beach.id] });
    await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });

    // pre: invisible to the viewer (publish gate), pending for the owner
    const before = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(before.body.items.map((i) => i.node_id)).not.toContain(beach.id);
    const ownerView = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerView.body.publish_pending_count).toBe(1);

    const pub = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [beach.id], published: true });
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ published: [beach.id], ignored: [] });
    expect(pub.body.undo.action_id).toBeGreaterThan(0);

    const after = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(after.body.items.map((i) => i.node_id)).toContain(beach.id);
    const ownerAfter = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerAfter.body.publish_pending_count).toBe(0);
  });

  it('ignores non-members (nothing grafted), returns undo:null for an all-ignored batch', async () => {
    const owner = await createUserWithRoot('pub-r-ign');
    const other = await createUserWithRoot('pub-r-ign-other');
    const foreign = await fileNodeService.createFile(other.root.id, 'pub-foreign.txt');

    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;
    const res = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [foreign.id], published: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ published: [], ignored: [foreign.id], undo: null });
    const items = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(items.body.items).toHaveLength(0);
  });

  it('validates the body: empty nodeIds → 400 emptyNodeIds, non-boolean published → 400 invalidPublishMode', async () => {
    const owner = await createUserWithRoot('pub-r-val');
    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;

    const empty = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [], published: true });
    expect(empty.status).toBe(400);
    expect(empty.body.errorCode).toBe(codes().collections.emptyNodeIds);

    const badFlag = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [1], published: 'yes' });
    expect(badFlag.status).toBe(400);
    expect(badFlag.body.errorCode).toBe(codes().collections.invalidPublishMode);
  });

  it('viewer grantee → 403; ungranted stranger → 404 masquerade', async () => {
    const owner = await createUserWithRoot('pub-r-acl');
    const viewer = await createUserWithRoot('pub-r-acl-viewer');
    const stranger = await createUserWithRoot('pub-r-acl-stranger');
    const travel = await fileNodeService.createDirectory(owner.root.id, 'atravel');
    const beach = await fileNodeService.createFile(travel.id, 'acl-beach.jpg');

    const created = await createCollectionViaApi(owner.token);
    const id = created.body.collection.collection_id;
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [beach.id] });
    await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });

    const denied = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ nodeIds: [beach.id], published: true });
    expect(denied.status).toBe(403);
    expect(denied.body.errorCode).toBe(codes().collections.forbidden);

    const masq = await request(app)
      .put(`/api/collections/${id}/items/publish`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ nodeIds: [beach.id], published: true });
    expect(masq.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Admin operator gate (owner pivot 2026-10-01, routes spec §2.3): collections
// are a personal-storage surface — the ADMIN actor NEVER participates. Every
// endpoint responds 403 serverErrors.collections.forbidden for admin
// requesters (requireNonAdmin), and admin-as-grantee is banned at creation.
// The file-ACL admin-owns-everything convention must not launder a 200 here.
// ---------------------------------------------------------------------------

describe('admin operator gate (403 on every collections endpoint)', () => {
  async function createAdminWithRoot(tag) {
    const { user, token } = await createAuthenticatedTestUser({
      username: `opadm-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      isAdmin: true,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    return { user, token, root };
  }

  const CALLS = [
    ['get', '/api/collections'],
    ['post', '/api/collections', { name: 'Admin set' }],
    ['get', '/api/collections/1'],
    ['put', '/api/collections/1', { name: 'renamed', pinned: true }],
    ['post', '/api/collections/1/archive'],
    ['post', '/api/collections/1/restore'],
    ['delete', '/api/collections/1'],
    ['get', '/api/collections/1/items'],
    ['post', '/api/collections/1/items', { nodeIds: [1] }],
    ['delete', '/api/collections/1/items', { nodeIds: [1] }],
    ['put', '/api/collections/1/items/publish', { nodeIds: [1], published: true }],
    ['post', '/api/collections/preview', { seedNodeId: 1 }],
    ['post', '/api/collections/1/preview'],
    ['get', '/api/collections/merge-suggestions'],
    ['post', '/api/collections/for-nodes', { nodeIds: [1] }],
    ['post', '/api/collections/1/merge/2'],
    ['post', '/api/collections/1/merge-dismiss', { otherId: 2 }],
    ['post', '/api/collections/1/merge-reject', { otherId: 2 }],
    ['get', '/api/collections/1/grants'],
    ['post', '/api/collections/1/grants', { userId: 1, role: 'viewer' }],
    ['delete', '/api/collections/1/grants?userId=1'],
    ['delete', '/api/collections/1/grants/me'],
  ];

  it.each(CALLS)(
    '%s %s responds 403 forbidden for an admin requester',
    async (verb, path, body) => {
      const admin = await createAdminWithRoot('gate');
      const call = request(app)[verb](path).set('Authorization', `Bearer ${admin.token}`);
      const res = await (body ? call.send(body) : call);
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe(codes().collections.forbidden);
    }
  );

  it('gates deep list/read/create flows even against otherwise-valid admin requests', async () => {
    const admin = await createAdminWithRoot('deep');
    const owner = await createUserWithRoot('deep-owner');
    const created = await createCollectionViaApi(owner.token, { name: 'Deep' });
    const id = created.body.collection.collection_id;
    const beach = await fileNodeService.createFile(owner.root.id, 'deep-beach.jpg');
    await request(app)
      .post(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeIds: [beach.id] });

    const list = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(403);
    expect(list.body.errorCode).toBe(codes().collections.forbidden);

    const read = await request(app)
      .get(`/api/collections/${id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(read.status).toBe(403);

    const items = await request(app)
      .get(`/api/collections/${id}/items`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(items.status).toBe(403);

    const made = await createCollectionViaApi(admin.token, { name: 'Admin deep' });
    expect(made.status).toBe(403);
    const after = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(after.body.collections.filter((row) => row.name.startsWith('Admin'))).toHaveLength(0);
  });

  it('rejects granting collection access to an ADMIN grantee (403 ban at creation)', async () => {
    const admin = await createAdminWithRoot('gban');
    const owner = await createUserWithRoot('gban-owner');
    const created = await createCollectionViaApi(owner.token, { name: 'GrantBan' });
    const id = created.body.collection.collection_id;

    const banned = await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: admin.user.id, role: 'viewer' });
    expect(banned.status).toBe(403);
    expect(banned.body.errorCode).toBe(codes().collections.forbidden);

    // non-admin grantee still succeeds (regression guard)
    const viewer = await createUserWithRoot('gban-viewer');
    const ok = await request(app)
      .post(`/api/collections/${id}/grants`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.user.id, role: 'viewer' });
    expect(ok.status).toBe(201);
  });

  it('keeps non-admin routes fully functional under the gate (regression)', async () => {
    const owner = await createUserWithRoot('gate-owner');
    const made = await createCollectionViaApi(owner.token, { name: 'StillMine' });
    expect(made.status).toBe(201);
    const listed = await request(app)
      .get('/api/collections')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.collections.map((row) => row.name)).toContain('StillMine');
  });
});
