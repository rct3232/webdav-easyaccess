/**
 * /api/actions routes integration tests.
 * @see docs/spec/server/routes/actions.md
 *
 * The orchestrator (server/index.js) mounts this router at integration time;
 * this suite reproduces the intended mount exactly (after the app-level
 * migrationGate, with setupModeGuardInstance):
 *   app.use('/api/actions', setupModeGuardInstance, require('./domains/actions/routes'))
 */
const request = require('supertest');
const express = require('express');

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbRun,
  dbQuery,
} = require('../../../test-utils');
const collectionsStore = require('../../../store/collectionsStore');
const actionJournalStore = require('../../../store/actionJournalStore');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const actionsErrorCode = (key) => `serverErrors.actions.${key}`;

let app;
let dbCleanup;
let owner; // user A: collection owner + actor
let ownerToken;
let other; // user B: foreign actor
let otherToken;

/** Backdate created_at / expires_at of a journal row (dialect-neutral ISO binds). */
async function backdateRow(actionId, { createdDaysAgo, expiresDaysAgo } = {}) {
  const daysAgoIso = (days) => new Date(Date.now() - Number(days) * 24 * 3600 * 1000).toISOString();
  if (createdDaysAgo !== undefined) {
    await dbRun('UPDATE action_journal SET created_at = ? WHERE id = ?', [
      daysAgoIso(createdDaysAgo),
      actionId,
    ]);
  }
  if (expiresDaysAgo !== undefined) {
    await dbRun('UPDATE action_journal SET expires_at = ? WHERE id = ?', [
      daysAgoIso(expiresDaysAgo),
      actionId,
    ]);
  }
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  const ownerCtx = await createAuthenticatedTestUser({ username: `actions-owner-${Date.now()}` });
  owner = ownerCtx.user;
  ownerToken = ownerCtx.token;
  const otherCtx = await createAuthenticatedTestUser({ username: `actions-other-${Date.now()}` });
  other = otherCtx.user;
  otherToken = otherCtx.token;

  const setupModeGuard = require('../../../middleware/setupModeGuard');
  app = express();
  app.use(express.json());
  app.use('/api/actions', setupModeGuard(), require('../routes'));
  app.use(require('../../../utils/errorHandler').errorHandler);
});

afterAll(async () => {
  await dbCleanup?.();
});

beforeEach(async () => {
  await dbRun('DELETE FROM action_journal', []);
});

// -- GET / (feed) ------------------------------------------------------------

describe('GET /api/actions', () => {
  it('returns the requester rows newest first with snake_case fields and no payload', async () => {
    const collection = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Europe trip', origin: 'user' },
      { actor: owner.id }
    );
    const node = await createTestFileNode({});
    await collectionsStore.addItem(collection.id, node.nodeId, owner.id, {}, { actor: owner.id });

    const res = await request(app).get('/api/actions').set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const actions = res.body.actions;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBe(2);
    // newest first: add-item (chain 2) before create (chain 1)
    expect(actions.map((a) => a.action)).toEqual(['add-item', 'create']);
    const addRow = actions[0];
    expect(addRow).toMatchObject({
      domain: 'collection',
      subject: `collection:${collection.id}`,
      subject_label: 'Europe trip', // register (d): member-op rows capture the collection name at commit time
      actor: owner.id,
      action: 'add-item',
      status: 'applied',
      chain_seq: 2,
      is_tip: true,
      undo_available: true,
    });
    expect(actions[1].subject_label).toBe('Europe trip'); // create rows capture the name
    expect(typeof addRow.action_id).toBe('number');
    expect(typeof addRow.created_at).toBe('string');
    expect(addRow.undone_at).toBeNull();
    expect(typeof addRow.expires_at).toBe('string');
    // the inverse blob is NEVER serialized
    expect(addRow).not.toHaveProperty('payload');
    // the older create row is not the tip of its subject's applied rows
    expect(actions[1].is_tip).toBe(false);
    expect(actions[1].chain_seq).toBe(1);
  });

  it('filters by the domain enum; unknown domain → 400 actions.invalidDomain', async () => {
    const resFile = await request(app)
      .get('/api/actions?domain=file')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(resFile.status).toBe(200);
    expect(resFile.body.actions).toEqual([]);

    const resBad = await request(app)
      .get('/api/actions?domain=nope')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(resBad.status).toBe(400);
    expect(resBad.body.errorCode).toBe(actionsErrorCode('invalidDomain'));
  });

  it('scopes rows to the requester; system rows only when their subject is owned', async () => {
    const ownCollection = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Owner coll', origin: 'user' },
      { actor: owner.id }
    );
    const foreignCollection = await collectionsStore.createCollection(
      { ownerId: other.id, name: 'Foreign coll', origin: 'user' },
      { actor: other.id }
    );

    // silent system act on the owner's collection (scoped to the victim-owner)
    const systemOnOwn = await actionJournalStore.commitChange(
      'collection',
      `collection:${ownCollection.id}`,
      { actor: 'system', action: 'auto-archive' },
      { inverse: { op: 'restore-collection', collectionId: ownCollection.id } },
      async () => null
    );
    // silent system act on somebody else's collection must NOT leak here
    const systemOnForeign = await actionJournalStore.commitChange(
      'collection',
      `collection:${foreignCollection.id}`,
      { actor: 'system', action: 'auto-create' },
      { inverse: { op: 'delete-collection', collectionId: foreignCollection.id } },
      async () => null
    );

    const res = await request(app).get('/api/actions').set('Authorization', `Bearer ${ownerToken}`);
    const ids = res.body.actions.map((a) => a.action_id);
    expect(ids).toContain(systemOnOwn.id);
    expect(ids).not.toContain(systemOnForeign.id);

    // the foreign user's own rows are invisible to the owner…
    const otherRes = await request(app)
      .get('/api/actions')
      .set('Authorization', `Bearer ${otherToken}`);
    const otherIds = otherRes.body.actions.map((a) => a.action_id);
    expect(otherIds).toContain(systemOnForeign.id);
    expect(otherIds).not.toContain(systemOnOwn.id);

    // …and their action id 404s on undo for the owner (masquerade, not 403)
    const masquerade = await request(app)
      .post(`/api/actions/${systemOnForeign.id}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(masquerade.status).toBe(404);
    expect(masquerade.body.errorCode).toBe(actionsErrorCode('notFound'));
  });

  it('keeps the fixed 30-day window: older rows drop, expired rows inside the window stay', async () => {
    const collection = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Window coll', origin: 'user' },
      { actor: owner.id }
    );
    const old = await actionJournalStore.commitChange(
      'collection',
      `collection:${collection.id}`,
      { actor: owner.id, action: 'old-act', subjectLabel: 'Window coll' },
      { inverse: { op: 'noop' } },
      async () => null
    );
    await backdateRow(old.id, { createdDaysAgo: 40 });

    const expiring = await actionJournalStore.commitChange(
      'collection',
      `collection:${collection.id}`,
      { actor: owner.id, action: 'fresh-act', subjectLabel: 'Window coll' },
      { inverse: { op: 'noop' } },
      async () => null
    );
    await backdateRow(expiring.id, { createdDaysAgo: 20, expiresDaysAgo: 1 });
    await actionJournalStore.expireJournalRows();

    const res = await request(app).get('/api/actions').set('Authorization', `Bearer ${ownerToken}`);
    const byId = Object.fromEntries(res.body.actions.map((a) => [a.action_id, a]));
    expect(byId[old.id]).toBeUndefined();
    expect(byId[expiring.id]).toBeDefined();
    expect(byId[expiring.id].status).toBe('expired');
    expect(byId[expiring.id].undo_available).toBe(false);
    expect(byId[expiring.id].subject_label).toBe('Window coll');
  });

  it('requires a token (401) and rejects invalid tokens (403)', async () => {
    const anon = await request(app).get('/api/actions');
    expect(anon.status).toBe(401);

    const bad = await request(app).get('/api/actions').set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(403);
  });
});

// -- POST /:id/undo ----------------------------------------------------------

describe('POST /api/actions/:id/undo', () => {
  it('tip undo reverses the effect, flips the row, then refuses a second undo', async () => {
    const collection = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Undo coll', origin: 'user' },
      { actor: owner.id }
    );
    const node = await createTestFileNode({ name: 'undo-item.txt' });
    const added = await collectionsStore.addItem(
      collection.id,
      node.nodeId,
      owner.id,
      {},
      { actor: owner.id }
    );

    const res = await request(app)
      .post(`/api/actions/${added.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      action_id: added.actionId,
      status: 'undone',
      items_undone: 1,
      items_skipped: 0,
    });
    expect(typeof res.body.undone_at).toBe('string');
    expect(res.body.cascade_undone).toEqual([]);

    // the inverse actually ran: the item row is gone again
    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM collection_items WHERE collection_id = ? AND node_id = ?',
      [collection.id, node.nodeId]
    );
    expect(Number(rows[0].cnt)).toBe(0);

    const again = await request(app)
      .post(`/api/actions/${added.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.errorCode).toBe(actionsErrorCode('alreadyUndone'));
  });

  it('non-tip undo → 409 cascadeConfirmRequired with laterChanges; confirmCascade undoes tip..target', async () => {
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Cascade coll', origin: 'user' },
      { actor: owner.id }
    );
    const nodeA = await createTestFileNode({ name: 'cascade-a.txt' });
    const nodeB = await createTestFileNode({ name: 'cascade-b.txt' });
    const addA = await collectionsStore.addItem(
      created.id,
      nodeA.nodeId,
      owner.id,
      {},
      { actor: owner.id }
    );
    const addB = await collectionsStore.addItem(
      created.id,
      nodeB.nodeId,
      owner.id,
      {},
      { actor: owner.id }
    );

    const first = await request(app)
      .post(`/api/actions/${created.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(first.status).toBe(409);
    expect(first.body.errorCode).toBe(actionsErrorCode('cascadeConfirmRequired'));
    expect(first.body.params).toEqual({ laterChanges: 2 });
    // nothing was executed
    expect((await actionJournalStore.getAction(created.actionId)).status).toBe('applied');

    const second = await request(app)
      .post(`/api/actions/${created.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ confirmCascade: true });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('undone');
    expect([...second.body.cascade_undone].sort()).toEqual([addA.actionId, addB.actionId].sort());
    expect(second.body.items_undone).toBe(3);
    expect(second.body.items_skipped).toBe(0);

    // create-undo deletes the collection row; the member rows cascaded with it
    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM collections WHERE id = ?', [
      created.id,
    ]);
    expect(Number(rows[0].cnt)).toBe(0);
    expect((await actionJournalStore.getAction(addA.actionId)).status).toBe('undone');
    expect((await actionJournalStore.getAction(addB.actionId)).status).toBe('undone');
    expect((await actionJournalStore.getAction(created.actionId)).status).toBe('undone');
  });

  it('refuses with fingerprintMismatch and keeps the row applied when the subject moved on', async () => {
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Fingerprint coll', origin: 'user' },
      { actor: owner.id }
    );
    const node = await createTestFileNode({ name: 'fp.txt' });
    const added = await collectionsStore.addItem(
      created.id,
      node.nodeId,
      owner.id,
      {},
      { actor: owner.id }
    );
    // subject mutated out from under the inverse — non-journaled external delete
    await dbRun('DELETE FROM collection_items WHERE collection_id = ? AND node_id = ?', [
      created.id,
      node.nodeId,
    ]);

    const res = await request(app)
      .post(`/api/actions/${added.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(actionsErrorCode('fingerprintMismatch'));
    expect((await actionJournalStore.getAction(added.actionId)).status).toBe('applied');
  });

  it('command-unit rows apply per item and report mixed results', async () => {
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Command coll', origin: 'user' },
      { actor: owner.id }
    );
    const nodes = [];
    for (let i = 0; i < 11; i += 1) {
      const node = await createTestFileNode({ name: `cmd-${i}.txt` });
      await dbRun(
        'INSERT INTO collection_items (collection_id, node_id, added_by, published) VALUES (?, ?, ?, ?)',
        [created.id, node.nodeId, owner.id, true]
      );
      nodes.push(node.nodeId);
    }
    const ghost = (await createTestFileNode({ name: 'cmd-ghost.txt' })).nodeId; // never a member
    const items = [...nodes, ghost].map((nodeId) => ({
      op: 'remove-item',
      collectionId: created.id,
      nodeId,
    }));
    const command = await actionJournalStore.commitChange(
      'collection',
      `collection:${created.id}`,
      { actor: owner.id, action: 'add-items' },
      { inverse: { op: 'noop' }, items },
      async () => null
    );

    const res = await request(app)
      .post(`/api/actions/${command.id}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action_id: command.id, items_undone: 11, items_skipped: 1 });
    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM collection_items WHERE collection_id = ?',
      [created.id]
    );
    expect(Number(rows[0].cnt)).toBe(0);
  });

  it('undo round-trips REAL store command rows (add-items / remove-items with nested item inverses)', async () => {
    // RCA 2026-09-23 (found by E2E-COLLECTION-008): the store facade writes
    // command-unit journal payloads as `items:[{nodeId, kind, inverse:{op,…}}]`
    // — the executor must apply the NESTED inverse per item. A flat-only
    // reader marked the row undone while silently skipping every item.
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: `Cmd real ${Date.now()}`, origin: 'user' },
      { actor: owner.id }
    );
    const nodeA = (await createTestFileNode({ name: `cmd-real-a-${Date.now()}.txt` })).nodeId;
    const nodeB = (await createTestFileNode({ name: `cmd-real-b-${Date.now()}.txt` })).nodeId;

    const add = await collectionsStore.addItems(
      created.id,
      [nodeA, nodeB],
      owner.id,
      {},
      {
        actor: owner.id,
      }
    );
    expect(await collectionsStore.getStoredItem(created.id, nodeA)).toBeTruthy();

    const remove = await collectionsStore.removeItems(
      created.id,
      { storedNodeIds: [nodeA, nodeB], excludeNodeIds: [] },
      { actor: owner.id }
    );
    expect(await collectionsStore.getStoredItem(created.id, nodeA)).toBeFalsy();

    // Tip undo (remove-items): both stored members return.
    const undoRemove = await request(app)
      .post(`/api/actions/${remove.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(undoRemove.status).toBe(200);
    expect(undoRemove.body).toMatchObject({ status: 'undone', items_undone: 2, items_skipped: 0 });
    expect(await collectionsStore.getStoredItem(created.id, nodeA)).toBeTruthy();
    expect(await collectionsStore.getStoredItem(created.id, nodeB)).toBeTruthy();

    // Chain undo of add-items (now the applied tip): both members leave.
    const undoAdd = await request(app)
      .post(`/api/actions/${add.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(undoAdd.status).toBe(200);
    expect(undoAdd.body).toMatchObject({ status: 'undone', items_undone: 2, items_skipped: 0 });
    expect(await collectionsStore.getStoredItem(created.id, nodeA)).toBeFalsy();
    expect(await collectionsStore.getStoredItem(created.id, nodeB)).toBeFalsy();
  });

  it('expired rows refuse undo with actions.expired', async () => {
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Expired coll', origin: 'user' },
      { actor: owner.id }
    );
    await backdateRow(created.actionId, { expiresDaysAgo: 1 });
    await actionJournalStore.expireJournalRows();
    expect((await actionJournalStore.getAction(created.actionId)).status).toBe('expired');

    const res = await request(app)
      .post(`/api/actions/${created.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(actionsErrorCode('expired'));
  });

  it('permanent-delete purges the subject rows — the undo id 404s (invariant 10)', async () => {
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: 'Purged coll', origin: 'user' },
      { actor: owner.id }
    );
    await collectionsStore.deleteCollectionPermanent(created.id);

    const res = await request(app)
      .post(`/api/actions/${created.actionId}/undo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(actionsErrorCode('notFound'));
  });

  it('unknown ids 404', async () => {
    const res = await request(app)
      .post('/api/actions/999999999/undo')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(actionsErrorCode('notFound'));
  });
});

// -- mount contract ----------------------------------------------------------

describe('setup-mode mount guard', () => {
  it('returns the setup.incomplete guard response while setup is incomplete', async () => {
    const prevWorker = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app)
        .get('/api/actions')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.incomplete);
    } finally {
      process.env.JEST_WORKER_ID = prevWorker;
    }
  });
});
