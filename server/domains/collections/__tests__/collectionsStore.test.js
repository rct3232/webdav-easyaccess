/**
 * collectionsStore facade tests for the T0.3 journaled mutators:
 * setPublishMode, batch addItems/removeItems, mergeCollections.
 * @see docs/spec/server/store/collectionsStore.md §2.1/§2.2
 */
const collectionsStore = require('@server/store/collectionsStore');
const actionJournalStore = require('@server/store/actionJournalStore');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const composition = require('@server/service/composition');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbQuery,
} = require('@server/test-utils');

let dbCleanup;
let fileNodeService;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(createWebdavMock()),
    fileNodeService,
  });
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

async function subjectRows(collectionId) {
  const rows = await dbQuery(
    `SELECT action, payload, chain_seq FROM action_journal
      WHERE domain = 'collection' AND subject = ? ORDER BY chain_seq`,
    [`collection:${collectionId}`]
  );
  return rows.rows.map((row) => ({
    action: row.action,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    chainSeq: Number(row.chain_seq),
  }));
}

describe('setPublishMode (journaled)', () => {
  it('writes publish_mode and records one journal row with an inverse', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const created = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'PM col', origin: 'user' },
      { actor: user.id }
    );

    const result = await collectionsStore.setPublishMode(created.id, 'auto', { actor: user.id });

    expect(result.publishMode).toBe('auto');
    expect(result.actionId).toBeGreaterThan(0);
    const journal = await subjectRows(created.id);
    const pmRow = journal.find((r) => r.action === 'set-publish-mode');
    expect(pmRow).toBeDefined();
    expect(pmRow.payload.inverse).toEqual({
      op: 'set-publish-mode',
      collectionId: created.id,
      publishMode: 'ask',
    });
  });
});

describe('batch addItems / removeItems (one command row each)', () => {
  it('adds several nodes in ONE journaled command whose payload carries item-level inverses', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    const a = await fileNodeService.createFile(root.id, 'a.txt');
    const b = await fileNodeService.createFile(root.id, 'b.txt');
    const created = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'Batch col', origin: 'user' },
      { actor: user.id }
    );

    const result = await collectionsStore.addItems(
      created.id,
      [a.nodeId, b.nodeId],
      user.id,
      { published: false },
      { actor: user.id }
    );
    expect(result.added).toEqual([a.nodeId, b.nodeId]);
    expect(result.actionId).toBeGreaterThan(0);

    const journal = await subjectRows(created.id);
    const addRow = journal.find((r) => r.action === 'add-items');
    expect(addRow).toBeDefined();
    expect(addRow.payload.items).toHaveLength(2);

    const items = await collectionsStore.listStoredItems(created.id);
    expect(items.map((i) => i.nodeId).sort()).toEqual([a.nodeId, b.nodeId].sort());
    expect(items.every((i) => i.published === false)).toBe(true);

    // touchMemberChange ran inside the same TX
    const col = await collectionsStore.getCollection(created.id);
    expect(col.lastMemberChangeAt).toBeTruthy();

    // idempotent re-add: duplicates report zero changes, no new members
    const dup = await collectionsStore.addItems(
      created.id,
      [a.nodeId],
      user.id,
      { published: false },
      { actor: user.id }
    );
    expect(dup.added).toEqual([]);
  });

  it('removes stored rows and inserts exclusions in ONE command; system rows auto-pin inside the TX', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-rm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    const stored = await fileNodeService.createFile(root.id, 'stored.txt');
    const derived = await fileNodeService.createFile(root.id, 'derived.txt');
    const created = await collectionsStore.createCollection(
      {
        ownerId: user.id,
        name: 'Remove col',
        origin: 'system',
        definition: { kind: 'predicate', any_of: [{ type: 'path', value: `/${user.username}` }] },
      },
      { actor: user.id }
    );
    await collectionsStore.addItems(
      created.id,
      [stored.nodeId],
      user.id,
      { published: true },
      { actor: user.id }
    );

    const result = await collectionsStore.removeItems(
      created.id,
      { storedNodeIds: [stored.nodeId], excludeNodeIds: [derived.nodeId] },
      { actor: user.id }
    );
    expect(result.removed).toEqual([stored.nodeId]);
    expect(result.excluded).toEqual([derived.nodeId]);
    expect(result.actionId).toBeGreaterThan(0);

    expect(await collectionsStore.getStoredItem(created.id, stored.nodeId)).toBeNull();
    expect(await collectionsStore.isExcluded(created.id, derived.nodeId)).toBe(true);

    // §4.9b: exclusion on a system collection auto-pins (inside the same TX)
    const col = await collectionsStore.getCollection(created.id);
    expect(col.pinned).toBe(true);
    expect(col.pinnedBy).toBe('auto');
    expect(col.lastMemberChangeAt).toBeTruthy();

    const journal = await subjectRows(created.id);
    const rmRow = journal.find((r) => r.action === 'remove-items');
    expect(rmRow).toBeDefined();
    expect(rmRow.payload.items).toHaveLength(2);
  });
});

describe('mergeCollections (one journaled command)', () => {
  async function setupPair() {
    const { user } = await createAuthenticatedTestUser({
      username: `store-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    const survivor = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'Survivor', origin: 'user' },
      { actor: user.id }
    );
    const loser = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'Loser', origin: 'user' },
      { actor: user.id }
    );
    return { user, root, survivor, loser };
  }

  it('moves members+exclusions, drops overlap duplicates, drops loser grants, flips the suggestion', async () => {
    const { user, survivor, loser } = await setupPair();
    const root = await fileNodeService.createDirectory(null, user.username);
    const shared = await fileNodeService.createFile(root.id, 'shared.txt');
    const onlySurvivor = await fileNodeService.createFile(root.id, 'only-s.txt');
    const onlyLoser = await fileNodeService.createFile(root.id, 'only-l.txt');

    await collectionsStore.addItems(survivor.id, [shared.nodeId, onlySurvivor.nodeId], user.id, {}, { actor: user.id });
    await collectionsStore.addItems(loser.id, [shared.nodeId, onlyLoser.nodeId], user.id, {}, { actor: user.id });
    await collectionsStore.addExclusion(loser.id, shared.nodeId, { actor: user.id });

    const grantee = await createAuthenticatedTestUser({ username: `store-grantee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    await collectionsStore.grantAccess(loser.id, grantee.user.id, 'viewer', user.id);

    await collectionsStore.upsertMergeSuggestion(survivor.id, loser.id, 700);

    const result = await collectionsStore.mergeCollections(survivor.id, loser.id, {
      actor: user.id,
    });

    expect(result.actionId).toBeGreaterThan(0);
    expect(result.survivor.id).toBe(survivor.id);
    expect(result.survivor.name).toBe('Survivor');
    // overlap duplicate (shared) was dropped and recorded
    expect(result.dropped.items).toEqual([shared.nodeId]);

    const survivorItems = await collectionsStore.listStoredItems(survivor.id);
    const survivorNodeIds = survivorItems.map((i) => i.nodeId).sort();
    expect(survivorNodeIds).toEqual([onlySurvivor.nodeId, onlyLoser.nodeId, shared.nodeId].sort());

    // loser is gone; its grant rows cascaded away
    expect(await collectionsStore.getCollection(loser.id)).toBeNull();
    const grants = await dbQuery('SELECT COUNT(*) AS n FROM collection_grants WHERE collection_id = ?', [
      loser.id,
    ]);
    expect(grants.rows[0].n).toBe(0);

    // suggestion flipped to merged
    const suggestion = await dbQuery(
      'SELECT state FROM collection_merge_suggestions WHERE a_id = ? AND b_id = ?',
      [Math.min(survivor.id, loser.id), Math.max(survivor.id, loser.id)]
    );
    expect(suggestion.rows[0].state).toBe('merged');

    // ONE command row on the survivor subject
    const journal = await subjectRows(survivor.id);
    expect(journal.filter((r) => r.action === 'merge')).toHaveLength(1);
    const mergeRow = journal.find((r) => r.action === 'merge');
    expect(mergeRow.payload.inverse.op).toBe('merge-collections');
    expect(mergeRow.payload.inverse.loser.items).toHaveLength(2);

    // survivor touched
    const col = await collectionsStore.getCollection(survivor.id);
    expect(col.lastMemberChangeAt).toBeTruthy();
  });
});