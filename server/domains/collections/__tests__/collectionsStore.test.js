/**
 * collectionsStore facade tests for the T0.3 journaled mutators:
 * setPublishMode, batch addItems/removeItems, mergeCollections.
 * @see docs/spec/server/store/collectionsStore.md §2.1/§2.2
 */
const collectionsStore = require('@server/store/collectionsStore');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const composition = require('@server/service/composition');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const { createTestDatabase, createAuthenticatedTestUser, dbQuery } = require('@server/test-utils');

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

describe('updateCollectionProperties (atomic composite)', () => {
  async function setupPropsFixture(tag) {
    const { user: owner } = await createAuthenticatedTestUser({
      username: `store-props-${tag}-o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const { user: grantee } = await createAuthenticatedTestUser({
      username: `store-props-${tag}-g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const { user: added } = await createAuthenticatedTestUser({
      username: `store-props-${tag}-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const created = await collectionsStore.createCollection(
      { ownerId: owner.id, name: `Props ${tag}`, origin: 'user' },
      { actor: owner.id }
    );
    return { owner, grantee, added, created };
  }

  it('applies name/pin/publish/grants in ONE journal row with nested atomic inverses', async () => {
    const { owner, grantee, added, created } = await setupPropsFixture('one');
    await collectionsStore.grantAccess(created.id, grantee.id, 'viewer', owner.id, {
      actor: owner.id,
    });
    await collectionsStore.upsertDigestCursor(grantee.id, created.id, new Date().toISOString());

    const result = await collectionsStore.updateCollectionProperties(
      created.id,
      {
        name: 'Props renamed',
        pinned: true,
        publishMode: 'auto',
        grants: {
          upsert: [{ granteeId: added.id, role: 'editor' }],
          revoke: [grantee.id],
        },
      },
      { actor: owner.id }
    );

    expect(result).toMatchObject({
      name: 'Props renamed',
      pinned: true,
      pinnedBy: 'user',
      publishMode: 'auto',
      nameLocked: true,
    });
    expect(result.actionId).toBeGreaterThan(0);

    const journal = await subjectRows(created.id);
    const composite = journal.filter((row) => row.action === 'update-properties');
    expect(composite).toHaveLength(1);
    expect(composite[0].payload.atomic).toBe(true);
    expect(composite[0].payload.items.map((item) => item.inverse.op)).toEqual([
      'rename-collection',
      'set-pinned',
      'set-publish-mode',
      'grant-access',
      'revoke-access',
    ]);

    expect(await collectionsStore.getGrant(created.id, grantee.id)).toBeNull();
    expect(await collectionsStore.getDigestCursor(grantee.id, created.id)).toBeNull();
    const grant = await collectionsStore.getGrant(created.id, added.id);
    expect(grant).toMatchObject({ role: 'editor' });
    expect(await collectionsStore.isHiddenFor(added.id, created.id)).toBe(false);
  });

  it('a first grant clears hidden; an existing role change preserves it; no-change patches write nothing', async () => {
    const { owner, grantee, created } = await setupPropsFixture('hidden');
    await collectionsStore.setVisible(grantee.id, created.id, true);

    await collectionsStore.updateCollectionProperties(
      created.id,
      { grants: { upsert: [{ granteeId: grantee.id, role: 'viewer' }] } },
      { actor: owner.id }
    );
    expect(await collectionsStore.isHiddenFor(grantee.id, created.id)).toBe(false);

    await collectionsStore.setVisible(grantee.id, created.id, true);
    await collectionsStore.updateCollectionProperties(
      created.id,
      { grants: { upsert: [{ granteeId: grantee.id, role: 'editor' }] } },
      { actor: owner.id }
    );
    expect(await collectionsStore.getGrant(created.id, grantee.id)).toMatchObject({
      role: 'editor',
    });
    expect(await collectionsStore.isHiddenFor(grantee.id, created.id)).toBe(true);

    const before = (await subjectRows(created.id)).length;
    const noChange = await collectionsStore.updateCollectionProperties(
      created.id,
      {
        name: created.name,
        pinned: false,
        publishMode: 'ask',
        grants: { upsert: [{ granteeId: grantee.id, role: 'editor' }] },
      },
      { actor: owner.id }
    );
    expect(noChange.actionId).toBeNull();
    expect((await subjectRows(created.id)).length).toBe(before);
  });

  it('a failing later write rolls back earlier fields and writes NO journal row', async () => {
    const { owner, created } = await setupPropsFixture('rollback');
    const before = await collectionsStore.getCollection(created.id);

    await expect(
      collectionsStore.updateCollectionProperties(
        created.id,
        { name: 'Never applied', publishMode: 'bogus' },
        { actor: owner.id }
      )
    ).rejects.toBeTruthy();

    const after = await collectionsStore.getCollection(created.id);
    expect(after.name).toBe(before.name);
    expect(after.publishMode).toBe(before.publishMode);
    expect(
      (await subjectRows(created.id)).filter((row) => row.action === 'update-properties')
    ).toHaveLength(0);
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
      [a.id, b.id],
      user.id,
      { published: false },
      { actor: user.id }
    );
    expect(result.added).toEqual([a.id, b.id]);
    expect(result.actionId).toBeGreaterThan(0);

    const journal = await subjectRows(created.id);
    const addRow = journal.find((r) => r.action === 'add-items');
    expect(addRow).toBeDefined();
    expect(addRow.payload.items).toHaveLength(2);

    const items = await collectionsStore.listStoredItems(created.id);
    expect(items.map((i) => i.nodeId).sort()).toEqual([a.id, b.id].sort());
    expect(items.every((i) => i.published === false)).toBe(true);

    // touchMemberChange ran inside the same TX
    const col = await collectionsStore.getCollection(created.id);
    expect(col.lastMemberChangeAt).toBeTruthy();

    // idempotent re-add: duplicates report zero changes, no new members
    const dup = await collectionsStore.addItems(
      created.id,
      [a.id],
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
      [stored.id],
      user.id,
      { published: true },
      { actor: user.id }
    );

    const result = await collectionsStore.removeItems(
      created.id,
      { storedNodeIds: [stored.id], excludeNodeIds: [derived.id] },
      { actor: user.id }
    );
    expect(result.removed).toEqual([stored.id]);
    expect(result.excluded).toEqual([derived.id]);
    expect(result.actionId).toBeGreaterThan(0);

    expect(await collectionsStore.getStoredItem(created.id, stored.id)).toBeNull();
    expect(await collectionsStore.isExcluded(created.id, derived.id)).toBe(true);

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
    const { user, root, survivor, loser } = await setupPair();
    const shared = await fileNodeService.createFile(root.id, 'shared.txt');
    const onlySurvivor = await fileNodeService.createFile(root.id, 'only-s.txt');
    const onlyLoser = await fileNodeService.createFile(root.id, 'only-l.txt');

    await collectionsStore.addItems(
      survivor.id,
      [shared.id, onlySurvivor.id],
      user.id,
      {},
      { actor: user.id }
    );
    await collectionsStore.addItems(
      loser.id,
      [shared.id, onlyLoser.id],
      user.id,
      {},
      { actor: user.id }
    );
    await collectionsStore.addExclusion(loser.id, shared.id, { actor: user.id });

    const grantee = await createAuthenticatedTestUser({
      username: `store-grantee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await collectionsStore.grantAccess(loser.id, grantee.user.id, 'viewer', user.id);

    await collectionsStore.upsertMergeSuggestion(survivor.id, loser.id, 700);

    const result = await collectionsStore.mergeCollections(survivor.id, loser.id, {
      actor: user.id,
    });

    expect(result.actionId).toBeGreaterThan(0);
    expect(result.survivor.id).toBe(survivor.id);
    expect(result.survivor.name).toBe('Survivor');
    // overlap duplicate (shared) was dropped and recorded
    expect(result.dropped.items).toEqual([shared.id]);

    const survivorItems = await collectionsStore.listStoredItems(survivor.id);
    const survivorNodeIds = survivorItems.map((i) => i.nodeId).sort();
    expect(survivorNodeIds).toEqual([onlySurvivor.id, onlyLoser.id, shared.id].sort());

    // loser is gone; its grant rows cascaded away
    expect(await collectionsStore.getCollection(loser.id)).toBeNull();
    const grants = await dbQuery(
      'SELECT COUNT(*) AS n FROM collection_grants WHERE collection_id = ?',
      [loser.id]
    );
    expect(grants.rows[0].n).toBe(0);

    // suggestion flipped to merged, then cascaded away with the loser row
    // (collection_merge_suggestions FK-cascades on both sides; the state flip
    // is opportunistic — §2.9 merge)
    const suggestion = await dbQuery(
      'SELECT state FROM collection_merge_suggestions WHERE a_id = ? AND b_id = ?',
      [Math.min(survivor.id, loser.id), Math.max(survivor.id, loser.id)]
    );
    expect(suggestion.rows).toHaveLength(0);

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

describe('subject_label capture (register (d) — T0.10)', () => {
  async function labelsFor(collectionId) {
    const rows = await dbQuery(
      `SELECT action, subject_label FROM action_journal
        WHERE domain = 'collection' AND subject = ? ORDER BY chain_seq`,
      [`collection:${collectionId}`]
    );
    return Object.fromEntries(rows.rows.map((row) => [row.action, row.subject_label]));
  }

  it('member-op, settings, archive/restore and grant rows carry the collection name', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-label-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    const fileA = await fileNodeService.createFile(root.id, 'la.txt');
    const fileB = await fileNodeService.createFile(root.id, 'lb.txt');

    const created = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'Labelled', origin: 'user' },
      { actor: user.id }
    );

    await collectionsStore.addItems(
      created.id,
      [fileA.id, fileB.id],
      user.id,
      {},
      { actor: user.id }
    );
    await collectionsStore.removeItems(
      created.id,
      { storedNodeIds: [fileB.id] },
      { actor: user.id }
    );
    await collectionsStore.addExclusion(created.id, fileB.id, { actor: user.id });
    await collectionsStore.removeExclusion(created.id, fileB.id, { actor: user.id });
    await collectionsStore.setPinned(created.id, true, { actor: user.id });
    await collectionsStore.setPinned(created.id, false, { actor: user.id });
    await collectionsStore.setPublishMode(created.id, 'auto', { actor: user.id });
    await collectionsStore.setItemPublished(created.id, [fileA.id], true, { actor: user.id });
    await collectionsStore.archiveCollection(created.id, { actor: user.id });
    await collectionsStore.restoreCollection(created.id, { actor: user.id });
    const grantee = await createAuthenticatedTestUser({
      username: `store-label-grantee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await collectionsStore.grantAccess(created.id, grantee.user.id, 'viewer', user.id, {
      actor: user.id,
    });
    await collectionsStore.revokeAccess(created.id, grantee.user.id, { actor: user.id });

    const labels = await labelsFor(created.id);
    for (const action of [
      'create',
      'add-items',
      'remove-items',
      'exclude',
      'unexclude',
      'pin',
      'unpin',
      'set-publish-mode',
      'set-items-published',
      'archive',
      'restore',
      'grant',
      'revoke',
    ]) {
      expect([labels[action], action]).toEqual(['Labelled', action]);
    }
  });

  it('single-item add/remove rows carry the label too', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-label-si-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    const file = await fileNodeService.createFile(root.id, 'si.txt');
    const created = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'Single', origin: 'user' },
      { actor: user.id }
    );
    await collectionsStore.addItem(created.id, file.id, user.id, {}, { actor: user.id });
    await collectionsStore.removeItem(created.id, file.id, { actor: user.id });

    const labels = await labelsFor(created.id);
    expect(labels['add-item']).toBe('Single');
    expect(labels['remove-item']).toBe('Single');
  });
});

describe('listDigestCursorMap (facade passthrough, 2026-10-01 owner ruling)', () => {
  it('exposes the batched repo read: seeded cursor present, never-opened pairs absent', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `store-cmap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const created = await collectionsStore.createCollection(
      { ownerId: user.id, name: 'CMap', origin: 'user' },
      { actor: user.id }
    );

    const map = await collectionsStore.listDigestCursorMap(user.id);
    expect(Object.keys(map).map(Number)).toContain(Number(created.id));
    expect(new Date(map[created.id]).getTime()).toBe(new Date(created.createdAt).getTime());
    // a collection the user never opened has NO entry (absent key = never-opened)
    expect(map[created.id + 999999]).toBeUndefined();
  });
});
