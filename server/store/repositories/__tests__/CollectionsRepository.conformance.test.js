'use strict';

/**
 * CollectionsRepository L2 conformance
 * (docs/spec/server/store/collectionsStore.md §2.9). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 * Repository-level cases exercise the twins directly (tx-bound write methods
 * receive the transaction from the test); the journaled-write coupling cases
 * run through the facade because journal atomicity is facade-owned (§2.1/§2.6).
 */

const {
  createTestDatabase,
  createUserRootNode,
  dbQuery,
  isSqliteBackend,
} = require('@server/test-utils');
const storage = require('@server/store/storage');
const createCollectionsRepository = require('@server/store/repositories/CollectionsRepository');
const collectionsStore = require('@server/store/collectionsStore');

describe('CollectionsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createCollectionsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueUser = async () => {
    seq += 1;
    const stamp = `${Date.now()}-${seq}`;
    const User = require('@server/models/User');
    const user = await User.create(`conf-col-${stamp}`, `conf-col-${stamp}@conf.test`, 'pw', false);
    await createUserRootNode({ userId: user.id });
    return user;
  };

  const uniqueNode = async (name) => {
    const { createTestFileNode } = require('@server/test-utils');
    return createTestFileNode({ name });
  };

  const inTx = (fn) => storage.getExecutor().transaction(fn);

  // jsonb (PG) comes back as an object; sqlite TEXT comes back as a string.
  const asObject = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

  describe('collections table', () => {
    it('reports the active dialect', () => {
      expect(['sqlite', 'postgres']).toContain(repo.dialect);
    });

    it('insert + get round-trips the domain row (definition JSONB vs TEXT parity)', async () => {
      const owner = await uniqueUser();
      const definition = { kind: 'rule', predicates: [{ type: 'path-prefix', value: '/docs' }] };
      let collectionId;
      await inTx(async (tx) => {
        const row = await repo.insertCollection(tx, {
          ownerId: owner.id,
          name: 'Conformance create',
          origin: 'user',
          publishMode: 'ask',
          definition,
        });
        collectionId = row.id;
      });

      const loaded = await repo.getCollection(collectionId);
      expect(loaded).toMatchObject({
        id: Number(collectionId),
        ownerId: Number(owner.id),
        name: 'Conformance create',
        origin: 'user',
        status: 'active',
        publishMode: 'ask',
        pinned: false,
        pinnedBy: null,
        nameLocked: false,
        archivedAt: null,
        lastMemberChangeAt: null,
      });
      expect(loaded.definition).toEqual(definition);
      expect(typeof loaded.createdAt).toBe('string');
      expect(typeof loaded.updatedAt).toBe('string');
    });

    it('defaults publish_mode to ask and stores explicit modes', async () => {
      const owner = await uniqueUser();
      let askId;
      let autoId;
      await inTx(async (tx) => {
        askId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Ask mode', origin: 'user' })
        ).id;
        autoId = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'Auto mode',
            origin: 'user',
            publishMode: 'auto',
          })
        ).id;
      });
      expect((await repo.getCollection(askId)).publishMode).toBe('ask');
      expect((await repo.getCollection(autoId)).publishMode).toBe('auto');
    });

    it('enforces the partial-unique (owner,name) over ACTIVE rows only', async () => {
      const owner = await uniqueUser();
      let firstId;
      await inTx(async (tx) => {
        firstId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Dup name', origin: 'user' })
        ).id;
      });

      await expect(
        inTx(async (tx) => {
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Dup name', origin: 'user' });
        })
      ).rejects.toBeDefined();

      await expect(repo.existsActiveName(owner.id, 'Dup name')).resolves.toBe(true);
      await expect(repo.existsActiveName(owner.id, 'Other name')).resolves.toBe(false);

      // Archiving frees the name for a new active row (partial index scope).
      await inTx(async (tx) => {
        await repo.archiveRow(tx, firstId);
      });
      await expect(repo.existsActiveName(owner.id, 'Dup name')).resolves.toBe(false);
      await inTx(async (tx) => {
        await repo.insertCollection(tx, { ownerId: owner.id, name: 'Dup name', origin: 'user' });
      });
    });

    it('listForUser sorts by activity (score desc, member-change tie-breaker) and filters hidden rows', async () => {
      const owner = await uniqueUser();
      const stamp = Date.now();
      let aId;
      let bId;
      await inTx(async (tx) => {
        aId = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: `ActA-${stamp}`,
            origin: 'user',
          })
        ).id;
        bId = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: `ActB-${stamp}`,
            origin: 'user',
          })
        ).id;
      });

      const nodeA = await uniqueNode(`col-act-a-${stamp}.txt`);
      const nodeB = await uniqueNode(`col-act-b-${stamp}.txt`);
      await inTx(async (tx) => {
        await repo.insertItem(tx, bId, nodeB.nodeId, owner.id);
        await repo.insertItem(tx, aId, nodeA.nodeId, owner.id);
      });
      for (const [nodeId, score] of [
        [nodeA.nodeId, 7],
        [nodeB.nodeId, 3],
      ]) {
        await dbQuery(
          `INSERT INTO node_activity (user_id, node_id, score, updated_at)
           VALUES (?, ?, ?, ${isSqliteBackend() ? "datetime('now')" : 'NOW()'})`,
          [Number(owner.id), Number(nodeId), score]
        );
      }
      await repo.recomputeActivityScores();

      const list = await repo.listForUser(owner.id, { sort: 'activity' });
      const ids = list.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([Number(aId), Number(bId)]));
      expect(ids.indexOf(Number(aId))).toBeLessThan(ids.indexOf(Number(bId)));

      // setHidden removes the row for THIS user only (leave).
      await inTx(async (tx) => {
        await repo.setVisible(tx, owner.id, bId, true);
      });
      await expect(repo.listForUser(owner.id, { sort: 'activity' })).resolves.toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: Number(bId) })])
      );
      await inTx(async (tx) => {
        await repo.setVisible(tx, owner.id, bId, false);
      });
    });

    it('listForUser excludes archived rows by default; status:all and listArchived return them', async () => {
      // Contract pin (collectionsStore.md §2.1, RCA 2026-09-23): the default
      // status filter is 'active'; archived rows join only via status:'all' or
      // listArchived, so the __archive__ read never duplicates them.
      const owner = await uniqueUser();
      const stamp = Date.now();
      let liveId;
      let archivedId;
      await inTx(async (tx) => {
        liveId = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: `Live-${stamp}`,
            origin: 'user',
          })
        ).id;
        archivedId = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: `Arch-${stamp}`,
            origin: 'user',
          })
        ).id;
        await repo.archiveRow(tx, archivedId);
      });

      const defaultIds = (await repo.listForUser(owner.id, {})).map((r) => Number(r.id));
      expect(defaultIds).toContain(Number(liveId));
      expect(defaultIds).not.toContain(Number(archivedId));

      const allIds = (await repo.listForUser(owner.id, { status: 'all' })).map((r) => Number(r.id));
      expect(allIds).toEqual(expect.arrayContaining([Number(liveId), Number(archivedId)]));

      const archivedIds = (await repo.listArchived(owner.id)).map((r) => Number(r.id));
      expect(archivedIds).toContain(Number(archivedId));
      expect(archivedIds).not.toContain(Number(liveId));
    });

    it('name sort is locale-unaware SQL ordering; created/updated sorts return the full set', async () => {
      const owner = await uniqueUser();
      const stamp = Date.now();
      await inTx(async (tx) => {
        await repo.insertCollection(tx, {
          ownerId: owner.id,
          name: `Zeta-${stamp}`,
          origin: 'user',
        });
        await repo.insertCollection(tx, {
          ownerId: owner.id,
          name: `Alpha-${stamp}`,
          origin: 'user',
        });
        await repo.insertCollection(tx, {
          ownerId: owner.id,
          name: `Mid-${stamp}`,
          origin: 'user',
        });
      });

      const byName = await repo.listForUser(owner.id, { sort: 'name' });
      const names = byName.map((r) => r.name);
      expect(names).toEqual([...names].sort());
      expect(names.length).toBe(3);

      // Same-transaction created_at timestamps tie on both dialects, so only
      // membership (not strict order) is asserted here.
      const byCreated = await repo.listForUser(owner.id, { sort: 'created' });
      expect(byCreated.length).toBe(3);
      const byUpdated = await repo.listForUser(owner.id, { sort: 'updated' });
      expect(byUpdated.length).toBe(3);
    });

    it('listArchived returns only archived rows with archived_at stamps', async () => {
      const owner = await uniqueUser();
      let archivedId;
      let activeId;
      await inTx(async (tx) => {
        archivedId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'ArcX', origin: 'user' })
        ).id;
        activeId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'ArcY', origin: 'user' })
        ).id;
        await repo.archiveRow(tx, archivedId);
      });

      const archived = await repo.listArchived(owner.id);
      const ids = archived.map((r) => r.id);
      expect(ids).toContain(Number(archivedId));
      expect(ids).not.toContain(Number(activeId));
      for (const row of archived) {
        expect(row.status).toBe('archived');
        expect(row.archivedAt).not.toBeNull();
      }
    });

    it('rename sets name_locked on demand; archive/restore are guarded transitions', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Rename me', origin: 'user' })
        ).id;
        await repo.renameCollection(tx, id, 'Renamed', true);
      });
      expect(await repo.getCollection(id)).toMatchObject({ name: 'Renamed', nameLocked: true });

      await inTx(async (tx) => {
        await expect(repo.archiveRow(tx, id)).resolves.toMatchObject({ changes: 1 });
        await expect(repo.archiveRow(tx, id)).resolves.toMatchObject({ changes: 0 });
        await expect(repo.restoreRow(tx, id)).resolves.toMatchObject({ changes: 1 });
      });
      expect(await repo.getCollection(id)).toMatchObject({ status: 'active', archivedAt: null });
    });

    it('updatePin writes the pinned flag; setAutoPin pins system-origin rows only', async () => {
      const owner = await uniqueUser();
      let systemId;
      let userId;
      await inTx(async (tx) => {
        systemId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Sys pin', origin: 'system' })
        ).id;
        userId = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'User pin', origin: 'user' })
        ).id;

        await expect(repo.updatePin(tx, userId, true, 'user')).resolves.toMatchObject({
          changes: 1,
        });
        // Mid-transaction reads must go through the tx-bound read (PG cannot
        // see uncommitted data on a second pool connection).
        expect(await repo.getCollectionTx(tx, userId)).toMatchObject({
          pinned: true,
          pinnedBy: 'user',
        });
        await expect(repo.updatePin(tx, userId, false, null)).resolves.toMatchObject({
          changes: 1,
        });
        expect(await repo.getCollectionTx(tx, userId)).toMatchObject({
          pinned: false,
          pinnedBy: null,
        });

        await expect(repo.setAutoPin(tx, systemId)).resolves.toMatchObject({ changes: 1 });
        expect(await repo.getCollectionTx(tx, systemId)).toMatchObject({
          pinned: true,
          pinnedBy: 'auto',
        });
        await expect(repo.setAutoPin(tx, systemId)).resolves.toMatchObject({ changes: 0 });
        await expect(repo.setAutoPin(tx, userId)).resolves.toMatchObject({ changes: 0 });
      });
      expect(await repo.getCollection(userId)).toMatchObject({ pinned: false, pinnedBy: null });
      expect(await repo.getCollection(systemId)).toMatchObject({ pinned: true, pinnedBy: 'auto' });
    });
  });

  describe('membership (items, exclusions)', () => {
    it('addItem is idempotent on the PK pair and defaults published=true', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (await repo.insertCollection(tx, { ownerId: owner.id, name: 'Items', origin: 'user' }))
          .id;
      });
      const node = await uniqueNode(`col-item-${Date.now()}.txt`);

      await inTx(async (tx) => {
        await expect(repo.insertItem(tx, id, node.nodeId, owner.id)).resolves.toMatchObject({
          changes: 1,
        });
        await expect(repo.insertItem(tx, id, node.nodeId, owner.id)).resolves.toMatchObject({
          changes: 0,
        });
      });

      expect(await repo.getStoredItem(id, node.nodeId)).toEqual({
        collectionId: Number(id),
        nodeId: Number(node.nodeId),
        addedBy: Number(owner.id),
        published: true,
        createdAt: expect.any(String),
      });
      expect((await repo.listStoredItems(id)).map((r) => r.nodeId)).toEqual([Number(node.nodeId)]);

      const future = new Date(Date.now() + 5000).toISOString();
      await expect(repo.listStoredItems(id, { since: future })).resolves.toEqual([]);
    });

    it('setItemPublished toggles the published flag on stored rows', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Publish', origin: 'user' })
        ).id;
      });
      const node = await uniqueNode(`col-pub-${Date.now()}.txt`);
      await inTx(async (tx) => {
        await repo.insertItem(tx, id, node.nodeId, owner.id);
        await expect(repo.setItemPublished(tx, id, [node.nodeId], false)).resolves.toMatchObject({
          changes: 1,
        });
      });
      expect((await repo.getStoredItem(id, node.nodeId)).published).toBe(false);
      await inTx(async (tx) => {
        await expect(repo.setItemPublished(tx, id, [node.nodeId], true)).resolves.toMatchObject({
          changes: 1,
        });
      });
      expect((await repo.getStoredItem(id, node.nodeId)).published).toBe(true);
    });

    it('removeItem deletes membership only — the node row survives', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'Remove item',
            origin: 'user',
          })
        ).id;
      });
      const node = await uniqueNode(`col-rm-${Date.now()}.txt`);
      await inTx(async (tx) => {
        await repo.insertItem(tx, id, node.nodeId, owner.id);
        await expect(repo.deleteItem(tx, id, node.nodeId)).resolves.toMatchObject({ changes: 1 });
        await expect(repo.deleteItem(tx, id, node.nodeId)).resolves.toMatchObject({ changes: 0 });
      });
      expect(await repo.getStoredItem(id, node.nodeId)).toBeNull();
      const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
      expect(await fileNodesStore.getNode(node.nodeId)).not.toBeNull();
    });

    it('exclusions are idempotent pair rows; probes reflect add/remove', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Excl', origin: 'system' })
        ).id;
      });
      const n1 = await uniqueNode(`col-ex-1-${Date.now()}.txt`);
      const n2 = await uniqueNode(`col-ex-2-${Date.now()}.txt`);
      await inTx(async (tx) => {
        await repo.insertExclusion(tx, id, n2.nodeId);
        await repo.insertExclusion(tx, id, n2.nodeId); // PK-pair idempotent
      });

      await expect(repo.isExcluded(id, n2.nodeId)).resolves.toBe(true);
      await expect(repo.isExcluded(id, n1.nodeId)).resolves.toBe(false);
      await expect(repo.listExclusions(id)).resolves.toEqual([Number(n2.nodeId)]);

      await inTx(async (tx) => {
        await repo.deleteExclusion(tx, id, n2.nodeId);
      });
      await expect(repo.isExcluded(id, n2.nodeId)).resolves.toBe(false);
    });

    it('listForNodes reports membership chips scoped to the requester', async () => {
      const owner = await uniqueUser();
      const other = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'ForNodes', origin: 'user' })
        ).id;
      });
      const n1 = await uniqueNode(`col-fn-1-${Date.now()}.txt`);
      await inTx(async (tx) => {
        await repo.insertItem(tx, id, n1.nodeId, owner.id);
      });

      await expect(repo.listForNodes(owner.id, [Number(n1.nodeId)])).resolves.toEqual([
        { nodeId: Number(n1.nodeId), collectionId: Number(id) },
      ]);
      await expect(repo.listForNodes(other.id, [Number(n1.nodeId)])).resolves.toEqual([]);
    });

    it('touchMemberChange bumps last_member_change_at', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (await repo.insertCollection(tx, { ownerId: owner.id, name: 'Touch', origin: 'user' }))
          .id;
      });
      expect((await repo.getCollection(id)).lastMemberChangeAt).toBeNull();
      await inTx(async (tx) => {
        await repo.touchMemberChange(tx, id);
      });
      expect((await repo.getCollection(id)).lastMemberChangeAt).not.toBeNull();
    });
  });

  describe('sharing, visibility, cursors, centroids, tombstones, suggestions', () => {
    it('grants upsert on the PK pair (role replaced in place) and revoke deletes', async () => {
      const owner = await uniqueUser();
      const grantee = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Grants', origin: 'user' })
        ).id;
        await repo.upsertGrant(tx, id, grantee.id, 'viewer', owner.id);
        await repo.upsertGrant(tx, id, grantee.id, 'editor', owner.id);
      });

      expect(await repo.getGrant(id, grantee.id)).toMatchObject({
        collectionId: Number(id),
        granteeId: Number(grantee.id),
        role: 'editor',
        grantedBy: Number(owner.id),
        createdAt: expect.any(String),
      });
      expect((await repo.listGrants(id)).length).toBe(1);

      await inTx(async (tx) => {
        await expect(repo.deleteGrant(tx, id, grantee.id)).resolves.toMatchObject({ changes: 1 });
      });
      expect(await repo.getGrant(id, grantee.id)).toBeNull();
    });

    it('granted collections appear in the grantee listForUser', async () => {
      const owner = await uniqueUser();
      const grantee = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'Granted list',
            origin: 'user',
          })
        ).id;
        await repo.upsertGrant(tx, id, grantee.id, 'viewer', owner.id);
      });
      const granteeList = await repo.listForUser(grantee.id, { sort: 'name' });
      expect(granteeList.map((r) => r.id)).toContain(Number(id));
    });

    it('digest cursors upsert and read back; timestamps keep only the later visit', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, { ownerId: owner.id, name: 'Cursor', origin: 'user' })
        ).id;
        await repo.upsertDigestCursor(tx, owner.id, id, new Date('2026-09-01T10:00:00.000Z'));
        await repo.upsertDigestCursor(tx, owner.id, id, new Date('2026-09-02T10:00:00.000Z'));
      });
      expect(await repo.getDigestCursor(owner.id, id)).not.toBeNull();
      const cursor = await repo.getDigestCursor(owner.id, id);
      expect(new Date(cursor).getTime()).toBe(new Date('2026-09-02T10:00:00.000Z').getTime());
    });

    it('listDigestCursorMap batches the requester cursors: seeded pairs present, never-opened absent', async () => {
      const owner = await uniqueUser();
      const stranger = await uniqueUser();
      let idA;
      let idB;
      await inTx(async (tx) => {
        idA = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'CursorMap A',
            origin: 'user',
          })
        ).id;
        idB = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'CursorMap B',
            origin: 'user',
          })
        ).id;
        await repo.upsertDigestCursor(tx, owner.id, idA, new Date('2026-09-01T10:00:00.000Z'));
        await repo.upsertDigestCursor(tx, stranger.id, idA, new Date('2026-09-05T10:00:00.000Z'));
      });

      const map = await repo.listDigestCursorMap(owner.id);
      expect(Object.keys(map).map(Number)).toEqual([Number(idA)]);
      expect(new Date(map[idA]).getTime()).toBe(new Date('2026-09-01T10:00:00.000Z').getTime());
      // never-opened collection: ABSENT key (the client new-dot rule keys on this)
      expect(map[idB]).toBeUndefined();

      const strangerMap = await repo.listDigestCursorMap(stranger.id);
      expect(Object.keys(strangerMap).map(Number)).toEqual([Number(idA)]);

      const nobody = await uniqueUser();
      expect(await repo.listDigestCursorMap(nobody.id)).toEqual({});
    });

    it('centroids are keyed by (collection, model) — a new model adds a row, same model replaces', async () => {
      const owner = await uniqueUser();
      let id;
      // collection_centroids.model_id is the MODEL-VERSION key (FK to llm_models).
      await dbQuery(
        `INSERT INTO llm_models (role, provider, base_url_key, model_name)
         VALUES ('embed', 'openai-compatible', 'LLM_BASE_URL', 'embed-model-a')`
      );
      const { rows: modelRows } = await dbQuery(
        'SELECT id FROM llm_models ORDER BY id DESC LIMIT 1'
      );
      const modelA = Number(modelRows[0].id);
      await dbQuery(
        `INSERT INTO llm_models (role, provider, base_url_key, model_name)
         VALUES ('embed', 'openai-compatible', 'LLM_BASE_URL', 'embed-model-b')`
      );
      const { rows: modelBRows } = await dbQuery(
        'SELECT id FROM llm_models ORDER BY id DESC LIMIT 1'
      );
      const modelB = Number(modelBRows[0].id);

      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'Centroids',
            origin: 'system',
          })
        ).id;
        await repo.upsertCentroid(tx, id, modelA, '[0.1,0.2]', 3);
        await repo.upsertCentroid(tx, id, modelA, '[0.3,0.4]', 4);
        await repo.upsertCentroid(tx, id, modelB, '[0.5,0.6]', 5);
      });

      expect(await repo.getCentroids([Number(id)], modelA)).toEqual([
        { collectionId: Number(id), modelId: modelA, centroid: '[0.3,0.4]', memberCount: 4 },
      ]);
      expect((await repo.getCentroids([Number(id)], modelB)).length).toBe(1);

      await inTx(async (tx) => {
        await expect(repo.deleteCentroids(tx, id)).resolves.toMatchObject({ changes: 2 });
      });
      expect((await repo.getCentroids([Number(id)], modelA)).length).toBe(0);
    });

    it('tombstones block regeneration until purged by cutoff', async () => {
      const owner = await uniqueUser();
      const fingerprint = `fp-${Date.now()}`;
      await inTx(async (tx) => {
        await repo.insertTombstone(tx, owner.id, fingerprint);
      });
      await expect(repo.isTombstoned(owner.id, fingerprint)).resolves.toBe(true);
      await expect(repo.listTombstones(owner.id)).resolves.toEqual([
        { defFingerprint: fingerprint, deletedAt: expect.any(String) },
      ]);

      const cutoff = new Date(Date.now() + 24 * 3600 * 1000);
      await expect(repo.purgeExpiredTombstones(cutoff)).resolves.toMatchObject({ changes: 1 });
      await expect(repo.isTombstoned(owner.id, fingerprint)).resolves.toBe(false);
    });

    it('merge suggestions normalize the pair and guard the state machine', async () => {
      const owner = await uniqueUser();
      let aId;
      let bId;
      await inTx(async (tx) => {
        aId = (await repo.insertCollection(tx, { ownerId: owner.id, name: 'MS A', origin: 'user' }))
          .id;
        bId = (await repo.insertCollection(tx, { ownerId: owner.id, name: 'MS B', origin: 'user' }))
          .id;
      });

      const first = await inTx(async (tx) => repo.upsertMergeSuggestion(tx, bId, aId, 88));
      expect(first).toMatchObject({
        aId: Math.min(Number(aId), Number(bId)),
        bId: Math.max(Number(aId), Number(bId)),
        score: 88,
        state: 'pending',
      });
      const again = await inTx(async (tx) => repo.upsertMergeSuggestion(tx, aId, bId, 88));
      expect(again.id).toBe(first.id); // pair normalization → ONE row

      expect(await repo.listMergeSuggestions()).toEqual([
        expect.objectContaining({ id: first.id, state: 'pending' }),
      ]);
      // Pair-scope filter: an unrelated scope yields nothing.
      expect(await repo.listMergeSuggestions([999999999])).toEqual([]);

      await inTx(async (tx) => {
        await expect(repo.setSuggestionState(tx, first.id, 'dismissed')).resolves.toMatchObject({
          changes: 1,
        });
        await expect(repo.setSuggestionState(tx, first.id, 'pending')).resolves.toMatchObject({
          changes: 0,
        });
        await expect(repo.setSuggestionState(tx, first.id, 'merged')).resolves.toMatchObject({
          changes: 0,
        });
      });
      expect(await repo.listMergeSuggestions()).toEqual([]);
    });
  });

  describe('activity recompute', () => {
    it('recomputeActivityScores sums the owner item-accumulator scores over current stored members', async () => {
      const owner = await uniqueUser();
      let id;
      await inTx(async (tx) => {
        id = (
          await repo.insertCollection(tx, {
            ownerId: owner.id,
            name: 'Score recompute',
            origin: 'user',
          })
        ).id;
      });
      const n1 = await uniqueNode(`col-score-1-${Date.now()}.txt`);
      const n2 = await uniqueNode(`col-score-2-${Date.now()}.txt`);
      await inTx(async (tx) => {
        await repo.insertItem(tx, id, n1.nodeId, owner.id);
        await repo.insertItem(tx, id, n2.nodeId, owner.id);
      });
      for (const [nodeId, score] of [
        [n1.nodeId, 2.5],
        [n2.nodeId, 1.5],
      ]) {
        await dbQuery(
          `INSERT INTO node_activity (user_id, node_id, score, updated_at)
           VALUES (?, ?, ?, ${isSqliteBackend() ? "datetime('now')" : 'NOW()'})`,
          [Number(owner.id), Number(nodeId), score]
        );
      }

      await repo.recomputeActivityScores([Number(id)]);
      let { rows } = await dbQuery('SELECT activity_score FROM collections WHERE id = ?', [
        Number(id),
      ]);
      expect(Number(rows[0].activity_score)).toBeCloseTo(4, 6);

      await inTx(async (tx) => {
        await repo.deleteItem(tx, id, n2.nodeId);
      });
      await repo.recomputeActivityScores([Number(id)]);
      ({ rows } = await dbQuery('SELECT activity_score FROM collections WHERE id = ?', [
        Number(id),
      ]));
      expect(Number(rows[0].activity_score)).toBeCloseTo(2.5, 6);
    });
  });

  describe('journaled writes through the facade (ONE tx: change + journal row)', () => {
    const ctx = { actor: '1' };

    it('createCollection journals the create with the resolved subject and inverse', async () => {
      const owner = await uniqueUser();
      const created = await collectionsStore.createCollection(
        { ownerId: owner.id, name: 'Journaled create', origin: 'user' },
        ctx
      );
      expect(created.id).toBeGreaterThan(0);

      const { rows } = await dbQuery(
        'SELECT * FROM action_journal WHERE domain = ? AND subject = ?',
        ['collection', `collection:${created.id}`]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('create');
      expect(asObject(rows[0].payload)).toMatchObject({
        inverse: { op: 'delete-collection', collectionId: Number(created.id) },
      });
      expect(Number(rows[0].chain_seq)).toBe(1);
    });

    it('createCollection seeds the creator digest cursor inside the same journaled TX (2026-10-01 ruling)', async () => {
      const owner = await uniqueUser();
      const created = await collectionsStore.createCollection(
        { ownerId: owner.id, name: 'Seeded create', origin: 'user' },
        ctx
      );

      const { rows } = await dbQuery(
        'SELECT user_id, last_visited_at FROM collection_digest_cursors WHERE collection_id = ?',
        [Number(created.id)]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].user_id)).toBe(Number(owner.id));
      // the seed value is the collection's created_at (same instant, both dialects)
      expect(new Date(rows[0].last_visited_at).getTime()).toBe(
        new Date(created.createdAt).getTime()
      );

      const map = await repo.listDigestCursorMap(owner.id);
      expect(new Date(map[created.id]).getTime()).toBe(new Date(created.createdAt).getTime());
    });

    it('addItem journals the add; the idempotent duplicate still records its own row', async () => {
      const owner = await uniqueUser();
      const collection = await collectionsStore.createCollection(
        { ownerId: owner.id, name: 'Add journaled', origin: 'user' },
        ctx
      );
      const node = await uniqueNode(`col-facade-${Date.now()}.txt`);

      await collectionsStore.addItem(collection.id, node.nodeId, owner.id, {}, ctx);
      const duplicate = await collectionsStore.addItem(
        collection.id,
        node.nodeId,
        owner.id,
        {},
        ctx
      );
      expect(duplicate.changes).toBe(0);

      const { rows } = await dbQuery(
        "SELECT COUNT(*) AS cnt FROM action_journal WHERE subject = ? AND action = 'add-item'",
        [`collection:${collection.id}`]
      );
      expect(Number(rows[0].cnt)).toBe(2); // one command row per call, even duplicates
      expect((await repo.listStoredItems(collection.id)).length).toBe(1);
    });

    it('addExclusion on a system collection auto-pins inside the same TX; user origin is untouched', async () => {
      const owner = await uniqueUser();
      const systemCol = await collectionsStore.createCollection(
        { ownerId: owner.id, name: `Sys excl ${Date.now()}`, origin: 'system' },
        ctx
      );
      const userCol = await collectionsStore.createCollection(
        { ownerId: owner.id, name: `User excl ${Date.now()}`, origin: 'user' },
        ctx
      );
      const node = await uniqueNode(`col-excl-facade-${Date.now()}.txt`);

      await collectionsStore.addExclusion(systemCol.id, node.nodeId, ctx);
      expect(await repo.getCollection(systemCol.id)).toMatchObject({
        pinned: true,
        pinnedBy: 'auto',
      });

      await collectionsStore.addExclusion(userCol.id, node.nodeId, ctx);
      expect(await repo.getCollection(userCol.id)).toMatchObject({ pinned: false, pinnedBy: null });
    });

    it('a failing mutation leaves NO journal row (same-TX rollback)', async () => {
      const owner = await uniqueUser();
      const collection = await collectionsStore.createCollection(
        { ownerId: owner.id, name: 'Rollback suite', origin: 'user' },
        ctx
      );
      // FK violation: adding a non-existent node rolls the whole TX back.
      await expect(
        collectionsStore.addItem(collection.id, 999999999, owner.id, {}, ctx)
      ).rejects.toBeDefined();
      const { rows } = await dbQuery(
        'SELECT COUNT(*) AS cnt FROM action_journal WHERE subject = ?',
        [`collection:${collection.id}`]
      );
      // Only the create row from the setup exists; the failed add left none.
      expect(Number(rows[0].cnt)).toBe(1);
    });

    it('deleteCollectionPermanent cascades, tombstones on demand, purges the subject, and is a no-op twice', async () => {
      const owner = await uniqueUser();
      const collection = await collectionsStore.createCollection(
        { ownerId: owner.id, name: `Purge me ${Date.now()}`, origin: 'system' },
        ctx
      );
      const node = await uniqueNode(`col-purge-${Date.now()}.txt`);
      await collectionsStore.addItem(collection.id, node.nodeId, owner.id, {}, ctx);
      await collectionsStore.grantAccess(
        collection.id,
        (await uniqueUser()).id,
        'viewer',
        owner.id,
        ctx
      );
      const fingerprint = 'fp-def-purge';
      const { rows: journalBefore } = await dbQuery(
        'SELECT COUNT(*) AS cnt FROM action_journal WHERE subject = ?',
        [`collection:${collection.id}`]
      );
      expect(Number(journalBefore[0].cnt)).toBeGreaterThan(0);

      const result = await collectionsStore.deleteCollectionPermanent(collection.id, {
        defFingerprint: fingerprint,
      });
      expect(result.changes).toBeGreaterThanOrEqual(1);

      expect(await repo.getCollection(collection.id)).toBeNull();
      expect(await repo.getStoredItem(collection.id, node.nodeId)).toBeNull();
      expect(await repo.isTombstoned(owner.id, fingerprint)).toBe(true);
      const { rows: journalAfter } = await dbQuery(
        'SELECT COUNT(*) AS cnt FROM action_journal WHERE subject = ?',
        [`collection:${collection.id}`]
      );
      expect(Number(journalAfter[0].cnt)).toBe(0);

      await expect(
        collectionsStore.deleteCollectionPermanent(collection.id)
      ).resolves.toMatchObject({
        changes: 0,
      });
    });
  });
});
