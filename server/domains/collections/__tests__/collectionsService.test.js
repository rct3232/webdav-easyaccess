/**
 * collectionsService unit tests (domain objects, thrown bare string codes).
 * @see docs/spec/server/services/collectionsService.md
 */
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const fileLikesStore = require('@server/store/fileLikesStore');
const aiTagStore = require('@server/store/aiTagStore');
const usageStore = require('@server/store/usageStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const Settings = require('@server/models/Settings');
const { getSharedResolver } = require('@server/infrastructure/configResolver');
const composition = require('@server/service/composition');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbRun,
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

async function createUserWithRoot(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `svc-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
}

async function setupServiceUser(tag) {
  const ctx = await createUserWithRoot(tag);
  const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
  const beach = await fileNodeService.createFile(travel.id, 'beach.jpg');
  const stay = await fileNodeService.createFile(ctx.root.id, 'stay.jpg');
  return { ...ctx, travel, beach, stay };
}

describe('collectionsService lifecycle', () => {
  it('create → archive → restore → delete(archived); active delete throws notArchived', async () => {
    const ctx = await createUserWithRoot('lifecycle');

    const { collection } = await collectionsService.createCollection(ctx.user.id, {
      name: 'Life',
    });
    expect(collection).toMatchObject({ name: 'Life', origin: 'user', status: 'active' });
    expect(collection.actionId).toBeGreaterThan(0);

    await expect(
      collectionsService.deleteCollectionPermanent(ctx.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notArchived' });

    await collectionsService.archiveCollection(ctx.user.id, collection.id);
    await expect(
      collectionsService.archiveCollection(ctx.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'alreadyArchived' });

    await collectionsService.restoreCollection(ctx.user.id, collection.id);
    await expect(
      collectionsService.restoreCollection(ctx.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notArchived' });

    await collectionsService.archiveCollection(ctx.user.id, collection.id);
    await collectionsService.deleteCollectionPermanent(ctx.user.id, collection.id);

    expect(await collectionsStore.getCollection(collection.id)).toBeNull();
    // invariant 10: the subject's journal rows are purged in the same TX
    const journal = await dbQuery('SELECT COUNT(*) AS n FROM action_journal WHERE subject = ?', [
      `collection:${collection.id}`,
    ]);
    expect(journal.rows[0].n).toBe(0);
  });

  it('permanent delete of a system collection writes exactly one tombstone with the definition fingerprint', async () => {
    const ctx = await createUserWithRoot('tombstone');
    const definition = {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}` }],
    };
    const system = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'System col', origin: 'system', definition },
      { actor: ctx.user.id }
    );

    await collectionsService.archiveCollection(ctx.user.id, system.id);
    await collectionsService.deleteCollectionPermanent(ctx.user.id, system.id);

    const fingerprint = collectionsService.fingerprintDefinition(definition);
    expect(await collectionsStore.isTombstoned(ctx.user.id, fingerprint)).toBe(true);
    const rows = await dbQuery(
      'SELECT COUNT(*) AS n FROM collection_tombstones WHERE owner_id = ?',
      [ctx.user.id]
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('fingerprintDefinition is pure and stable, ignoring centroid vectors', async () => {
    const a = { kind: 'seed_vector', seed_ref: 5, theta: 0.62, centroid: [0.1, 0.2, 0.3] };
    const b = { kind: 'seed_vector', seed_ref: 5, theta: 0.62, centroid: [9.9, 8.8, 7.7] };
    expect(collectionsService.fingerprintDefinition(a)).toBe(
      collectionsService.fingerprintDefinition(b)
    );
    expect(collectionsService.fingerprintDefinition(a)).toMatch(/^[0-9a-f]+$/);
  });

  it('restore with a name collision re-suffixes instead of erroring', async () => {
    const ctx = await createUserWithRoot('suffix');

    const first = await collectionsService.createCollection(ctx.user.id, { name: 'Dup' });
    await collectionsService.archiveCollection(ctx.user.id, first.collection.id);
    // the archived 'Dup' does not collide (partial unique over ACTIVE rows only)
    const second = await collectionsService.createCollection(ctx.user.id, { name: 'Dup' });
    expect(second.collection.name).toBe('Dup');

    const restored = await collectionsService.restoreCollection(ctx.user.id, first.collection.id);
    expect(restored.collection.name).toBe('Dup (2)');
    expect(restored.collection.status).toBe('active');
  });

  it('an explicit unpin of an auto-pinned system collection persists (C2)', async () => {
    const ctx = await createUserWithRoot('unpin');
    const system = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'System unpin', origin: 'system' },
      { actor: ctx.user.id }
    );
    await collectionsStore.setAutoPin(system.id);
    expect(await collectionsStore.getCollection(system.id)).toMatchObject({
      pinned: true,
      pinnedBy: 'auto',
    });

    const updated = await collectionsService.updateCollection(ctx.user.id, system.id, {
      pinned: false,
    });
    expect(updated.collection).toMatchObject({ pinned: false, pinnedBy: null });
    // persisted, not re-pinned by the unpin request itself
    expect(await collectionsStore.getCollection(system.id)).toMatchObject({
      pinned: false,
      pinnedBy: null,
    });

    // a DIFFERENT user touch keeps the §4.9b auto-pin taxonomy
    const renamed = await collectionsService.updateCollection(ctx.user.id, system.id, {
      name: 'System unpin renamed',
    });
    expect(renamed.collection).toMatchObject({ pinned: true, pinnedBy: 'auto' });
  });
});

describe('collectionsService member view and membership', () => {
  it('addItems reports unreadable nodes and adds the rest; item rows land published per publish mode', async () => {
    const ctx = await setupServiceUser('addval');
    const stranger = await createUserWithRoot('svc-addother');
    const secret = await fileNodeService.createFile(stranger.root.id, 'secret.txt');

    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Manual' });
    const result = await collectionsService.addItems(ctx.user.id, manual.collection.id, [
      ctx.beach.id,
      secret.id,
    ]);
    expect(result.added).toEqual([ctx.beach.id]);
    expect(result.rejected_not_readable).toEqual([secret.id]);
    expect(result.undo.actionId).toBeGreaterThan(0);

    // ask mode (default) → stored rows start published=false
    const items = await collectionsStore.listStoredItems(manual.collection.id);
    expect(items).toHaveLength(1);
    expect(items[0].published).toBe(false);
  });

  it('removeItems deletes membership only — the file node row is untouched', async () => {
    const ctx = await setupServiceUser('remove');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Remove' });
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [ctx.beach.id]);

    const result = await collectionsService.removeItems(ctx.user.id, manual.collection.id, [
      ctx.beach.id,
    ]);
    expect(result.removed).toEqual([ctx.beach.id]);

    const node = await fileNodeService.getNode(ctx.beach.id);
    expect(node).not.toBeNull();
    expect(node.deletedAt).toBeNull();
  });

  it('editor may remove a row they added; owner-added rows throw forbidden', async () => {
    const owner = await createUserWithRoot('svc-editor-owner');
    const editor = await createUserWithRoot('svc-editor-user');
    const manual = await collectionsService.createCollection(owner.user.id, { name: 'Ed' });
    await collectionsStore.grantAccess(
      manual.collection.id,
      editor.user.id,
      'editor',
      owner.user.id
    );

    const ownerFile = await fileNodeService.createFile(owner.root.id, 'of.txt');
    const editorFile = await fileNodeService.createFile(editor.root.id, 'ef.txt');
    await grantTestPermissionByNodeId({
      userId: editor.user.id,
      fileNodeId: ownerFile.id,
      permission: 'read',
    });

    await collectionsService.addItems(editor.user.id, manual.collection.id, [editorFile.id]);
    await collectionsService.addItems(owner.user.id, manual.collection.id, [ownerFile.id]);

    const ok = await collectionsService.removeItems(editor.user.id, manual.collection.id, [
      editorFile.id,
    ]);
    expect(ok.removed).toEqual([editorFile.id]);

    await expect(
      collectionsService.removeItems(editor.user.id, manual.collection.id, [ownerFile.id])
    ).rejects.toMatchObject({ message: 'forbidden' });
  });

  it('enrichment: revoked placeholder has null name/type; trashed members are hidden', async () => {
    const ctx = await setupServiceUser('enrich');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Enrich col',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}` }],
        },
      },
      { actor: ctx.user.id }
    );

    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.beach.id);
    await dbRun("UPDATE file_nodes SET deleted_at = datetime('now') WHERE id = ?", [ctx.beach.id]);
    await dbRun('DELETE FROM permissions_user_files WHERE file_node_id = ?', [ctx.beach.id]);

    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    const row = view.items.find((i) => i.nodeId === ctx.beach.id);
    // beach is now trashed → hidden entirely (revoked requires a live, unreadable row)
    expect(row).toBeUndefined();
  });

  it('stored rows ignore exclusions at read time; exclusions only gate evaluation passes', async () => {
    const ctx = await setupServiceUser('exclude');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Exclude col',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}` }],
        },
      },
      { actor: ctx.user.id }
    );

    // materialize beach as a rule-managed membership row at the write boundary
    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.beach.id);
    expect(await collectionsStore.getStoredItem(system.id, ctx.beach.id)).not.toBeNull();

    // exclusion is never a read-time subtractor: the materialized row survives
    await collectionsStore.addExclusion(system.id, ctx.beach.id, { actor: ctx.user.id });
    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(view.items.map((i) => i.nodeId)).toContain(ctx.beach.id);

    // stored rows survive exclusions in every render
    await collectionsService.addItems(ctx.user.id, system.id, [ctx.stay.id]);
    await collectionsStore.addExclusion(system.id, ctx.stay.id, { actor: ctx.user.id });
    const after = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(after.items.some((i) => i.nodeId === ctx.stay.id)).toBe(true);
  });

  it('liked flags come from the requester only', async () => {
    const ctx = await setupServiceUser('like');
    const other = await createUserWithRoot('svc-likeother');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Likes' });
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [
      ctx.beach.id,
      ctx.stay.id,
    ]);
    await fileLikesStore.addLike(ctx.user.id, ctx.beach.id);
    await fileLikesStore.addLike(other.user.id, ctx.stay.id);

    const view = await collectionsService.getItems(ctx.user.id, manual.collection.id, {});
    const byNode = new Map(view.items.map((i) => [i.nodeId, i]));
    expect(byNode.get(ctx.beach.id).liked).toBe(true);
    expect(byNode.get(ctx.stay.id).liked).toBe(false);
  });

  it('reads never evaluate definitions: a matching file appears only after write-boundary materialization', async () => {
    const ctx = await setupServiceUser('readstable');
    const definition = {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    };
    const system = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'Stable rule', origin: 'system', definition },
      { actor: ctx.user.id }
    );

    // preview is the live dry-run and sees the existing fan-out
    const live = await collectionsService.previewCollection(ctx.user.id, system.id);
    expect(live.count).toBeGreaterThan(0);

    // a read of the materialized state stays empty
    const before = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(before.items).toEqual([]);
    const listBefore = await collectionsService.listCollections(ctx.user.id, { include: 'mine' });
    expect(listBefore.collections.find((row) => row.collection_id === system.id).item_count).toBe(
      0
    );

    // a later matching node does NOT leak into reads until a write boundary runs
    const fresh = await fileNodeService.createFile(ctx.travel.id, 'later.jpg');
    const stillEmpty = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(stillEmpty.items).toEqual([]);
    expect((await collectionsService.getForNodes(ctx.user.id, [fresh.id])).memberships).toEqual([
      { nodeId: fresh.id, collectionIds: [] },
    ]);

    await collectionsService.checkUploadAdmissions(ctx.user.id, fresh.id);
    const after = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(after.items.map((row) => row.nodeId)).toContain(fresh.id);
  });
});

describe('collectionsService preview and for-nodes', () => {
  it('preview({definition}) counts and caps the sample at 12 with sample_truncated', async () => {
    const ctx = await setupServiceUser('preview');
    const folder = await fileNodeService.createDirectory(ctx.root.id, 'bulk');
    for (let i = 0; i < 15; i += 1) {
      await fileNodeService.createFile(folder.id, `f${i}.txt`);
    }

    const result = await collectionsService.preview(ctx.user.id, {
      definition: {
        kind: 'predicate',
        any_of: [{ type: 'path', value: `/${ctx.user.username}/bulk` }],
      },
    });
    expect(result.count).toBe(16);
    expect(result.sample).toHaveLength(12);
    expect(result.sample_truncated).toBe(true);
  });

  it('preview({seedNodeId}) without the embed role throws aiNotConfigured', async () => {
    const ctx = await setupServiceUser('seed');
    await expect(
      collectionsService.preview(ctx.user.id, { seedNodeId: ctx.root.id })
    ).rejects.toMatchObject({ message: 'aiNotConfigured', status: 409 });
  });

  it('preview requires exactly one target and validates atoms', async () => {
    const ctx = await setupServiceUser('previewval');
    await expect(collectionsService.preview(ctx.user.id, {})).rejects.toMatchObject({
      message: 'previewTargetRequired',
    });
    await expect(
      collectionsService.preview(ctx.user.id, {
        seedNodeId: 1,
        definition: { kind: 'predicate', any_of: [] },
      })
    ).rejects.toThrow('previewTargetRequired');
    await expect(
      collectionsService.preview(ctx.user.id, {
        definition: { kind: 'nonsense', any_of: [] },
      })
    ).rejects.toThrow('invalidDefinition');
  });

  it('getForNodes reads materialized membership only; exclusions do not remove stored rows', async () => {
    const ctx = await setupServiceUser('fornodes');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Chips',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    // write-boundary materialization (the read path never evaluates)
    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.travel.id);
    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.beach.id);
    await collectionsStore.addExclusion(system.id, ctx.beach.id, { actor: ctx.user.id });

    const result = await collectionsService.getForNodes(ctx.user.id, [ctx.beach.id, ctx.travel.id]);
    expect(result.memberships).toEqual([
      { nodeId: ctx.beach.id, collectionIds: [system.id] },
      { nodeId: ctx.travel.id, collectionIds: [system.id] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Vector-definition preview gates (T2.5, §2.7): free-standing vector previews
// gate on the embed capability; self-centroid references are only resolvable
// in a collection context.
// ---------------------------------------------------------------------------

describe('collectionsService vector-definition preview gates (§2.7)', () => {
  afterEach(() => {
    collectionsService.__resetRuntimeSeamsForTests();
  });

  it('preview({definition: seed_vector}) without the embed role throws aiNotConfigured', async () => {
    const ctx = await setupServiceUser('vecnorole');
    await expect(
      collectionsService.preview(ctx.user.id, {
        definition: { kind: 'seed_vector', seed_ref: ctx.beach.id, theta: 0.6 },
      })
    ).rejects.toMatchObject({ message: 'aiNotConfigured', status: 409 });
    await expect(
      collectionsService.preview(ctx.user.id, {
        definition: { kind: 'centroid', centroid_ref: 7, theta: 0.6 },
      })
    ).rejects.toMatchObject({ message: 'aiNotConfigured', status: 409 });
  });

  it('preview({definition}) with a self-centroid reference outside a collection context throws invalidDefinition', async () => {
    const ctx = await setupServiceUser('vecself');
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    await expect(
      collectionsService.preview(ctx.user.id, {
        definition: { kind: 'centroid', centroid_ref: null, theta: 0.6 },
      })
    ).rejects.toThrow('invalidDefinition');
  });

  it('preview({definition: seed_vector}) with embeddings scores pooled cosine and counts', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('vecseed');
    const modelId = await ensureEmbedModel('vecseed');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    await embedNode(ctx.stay.id, modelId, [0.95, 0.1, 0, 0]);

    const result = await collectionsService.preview(ctx.user.id, {
      definition: { kind: 'seed_vector', seed_ref: ctx.beach.id, theta: 0.5 },
    });
    expect(result.count).toBe(2);
    // samples order by nodeId asc (runDefinitionPreview); the seed itself is a candidate
    expect(result.sample.map((n) => n.nodeId)).toEqual([ctx.beach.id, ctx.stay.id]);
    expect(result.sample_truncated).toBe(false);
    expect(result.degraded).toBeUndefined();
  });

  it('preview({definition: centroid}) with an explicit reference resolves the centroid row and counts', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('veccentroid');
    const modelId = await ensureEmbedModel('veccentroid');
    const { collection } = await collectionsService.createCollection(ctx.user.id, {
      name: 'Centroid host',
    });
    await collectionsStore.upsertCentroid(collection.id, modelId, '1,0', 2);
    await embedNode(ctx.beach.id, modelId, [1, 0]);
    await embedNode(ctx.stay.id, modelId, [0, 1]);

    const result = await collectionsService.preview(ctx.user.id, {
      definition: { kind: 'centroid', centroid_ref: collection.id, theta: 0.5 },
    });
    expect(result.count).toBe(1);
    expect(result.sample).toEqual([{ nodeId: ctx.beach.id, name: 'beach.jpg' }]);
  });

  it('previewCollection of a self-centroid definition without an embed model reports degraded:true', async () => {
    const ctx = await setupServiceUser('vecdegraded');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Self cluster',
        origin: 'system',
        definition: { kind: 'centroid', centroid_ref: null, theta: 0.8, tier: 'mid' },
      },
      { actor: ctx.user.id }
    );
    const result = await collectionsService.previewCollection(ctx.user.id, system.id);
    expect(result).toEqual({ count: 0, sample: [], sample_truncated: false, degraded: true });
  });
});

describe('collectionsService similar sort', () => {
  it('groups rows by greedy nearest-neighbor over the ACTIVE embed model centroids', async () => {
    const ctx = await createUserWithRoot('svc-similar');
    const a = await collectionsService.createCollection(ctx.user.id, { name: 'A' });
    const b = await collectionsService.createCollection(ctx.user.id, { name: 'B' });
    const c = await collectionsService.createCollection(ctx.user.id, { name: 'C' });

    // Centroids are MODEL-KEYED: seed them under the active embed model, the
    // same resolution the definition/preview paths use (no placeholder id).
    const modelId = await ensureEmbedModel('svc-similar');
    await collectionsStore.upsertCentroid(a.collection.id, modelId, JSON.stringify([1, 0]), 3);
    await collectionsStore.upsertCentroid(
      b.collection.id,
      modelId,
      JSON.stringify([0.99, 0.01]),
      3
    );
    // c has no centroid → singleton cluster

    const grouped = await collectionsService.listCollections(ctx.user.id, {
      sort: 'similar',
      include: 'mine',
    });
    expect(grouped.collections.every((row) => typeof row.cluster_index === 'number')).toBe(true);

    const byName = new Map(grouped.collections.map((row) => [row.name, row]));
    expect(byName.get('A').cluster_index).toBe(byName.get('B').cluster_index);
    // c has no centroid → singleton cluster, separate from the A/B pair
    expect(byName.get('C').cluster_index).not.toBe(byName.get('A').cluster_index);
    expect(c.collection.name).toBe('C');

    const again = await collectionsService.listCollections(ctx.user.id, {
      sort: 'similar',
      include: 'mine',
    });
    const mapAgain = new Map(again.collections.map((row) => [row.name, row.cluster_index]));
    expect(mapAgain.get('A')).toBe(byName.get('A').cluster_index);
  });

  it('ignores centroid rows of a non-active model id (regression: no fixed placeholder model)', async () => {
    const ctx = await createUserWithRoot('svc-similar-stale');
    const a = await collectionsService.createCollection(ctx.user.id, { name: 'Stale A' });
    const b = await collectionsService.createCollection(ctx.user.id, { name: 'Stale B' });

    // Centroid rows written in an OLD embed space…
    const staleModelId = await ensureEmbedModel('svc-similar-stale');
    await collectionsStore.upsertCentroid(a.collection.id, staleModelId, JSON.stringify([1, 0]), 3);
    await collectionsStore.upsertCentroid(b.collection.id, staleModelId, JSON.stringify([1, 0]), 3);

    // …must never ground the grouping once another embed model is the active one.
    const activeModelId = await ensureEmbedModel('svc-similar-active');
    expect(activeModelId).toBeGreaterThan(staleModelId);

    const staleGrouping = await collectionsService.listCollections(ctx.user.id, {
      sort: 'similar',
      include: 'mine',
    });
    const staleByName = new Map(staleGrouping.collections.map((row) => [row.name, row]));
    expect(staleByName.get('Stale A').cluster_index).not.toBe(
      staleByName.get('Stale B').cluster_index
    );

    // Re-keying the same vectors to the active model restores the grouping.
    await collectionsStore.upsertCentroid(
      a.collection.id,
      activeModelId,
      JSON.stringify([1, 0]),
      3
    );
    await collectionsStore.upsertCentroid(
      b.collection.id,
      activeModelId,
      JSON.stringify([1, 0]),
      3
    );

    const activeGrouping = await collectionsService.listCollections(ctx.user.id, {
      sort: 'similar',
      include: 'mine',
    });
    const activeByName = new Map(activeGrouping.collections.map((row) => [row.name, row]));
    expect(activeByName.get('Stale A').cluster_index).toBe(
      activeByName.get('Stale B').cluster_index
    );
  });
});

describe('collectionsService preview_items (P-3)', () => {
  /** Spread stored-row created_at deterministically (second-granular sqlite clock). */
  async function setAddedAt(collectionId, nodeId, stamp) {
    await dbRun(
      'UPDATE collection_items SET created_at = ? WHERE collection_id = ? AND node_id = ?',
      [stamp, collectionId, nodeId]
    );
  }

  it('listCollections carries preview_items: newest-added first (createdAt desc, nodeId desc tie-break), sliced to 4', async () => {
    const ctx = await setupServiceUser('preview-order');
    const manual = await collectionsService.createCollection(ctx.user.id, {
      name: 'Preview order',
    });
    const files = [];
    for (let i = 0; i < 6; i += 1) {
      files.push(await fileNodeService.createFile(ctx.root.id, `prev${i}.jpg`));
    }
    await collectionsService.addItems(
      ctx.user.id,
      manual.collection.id,
      files.map((f) => f.id)
    );
    // prev0 oldest … prev5 newest
    for (let i = 0; i < files.length; i += 1) {
      await setAddedAt(manual.collection.id, files[i].id, `2026-0${i + 1}-01 00:00:00`);
    }

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === manual.collection.id);
    expect(row.preview_items).toEqual([
      { node_id: files[5].id, name: 'prev5.jpg', type: 'file', mime: null },
      { node_id: files[4].id, name: 'prev4.jpg', type: 'file', mime: null },
      { node_id: files[3].id, name: 'prev3.jpg', type: 'file', mime: null },
      { node_id: files[2].id, name: 'prev2.jpg', type: 'file', mime: null },
    ]);
  });

  it('nodeId desc is the deterministic tie-break inside the same created_at second', async () => {
    const ctx = await setupServiceUser('preview-tie');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Preview tie' });
    const first = await fileNodeService.createFile(ctx.root.id, 'tie-a.jpg');
    const second = await fileNodeService.createFile(ctx.root.id, 'tie-b.jpg');
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [first.id, second.id]);
    await setAddedAt(manual.collection.id, first.id, '2026-05-01 00:00:00');
    await setAddedAt(manual.collection.id, second.id, '2026-05-01 00:00:00');

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === manual.collection.id);
    expect(row.preview_items.map((i) => i.node_id)).toEqual([second.id, first.id]);
  });

  it('revoked members NEVER appear in preview_items; shared-excluded DO (owner can read them — 2026-10-01 amendment)', async () => {
    const ctx = await setupServiceUser('preview-excl');
    const other = await createUserWithRoot('preview-excl-other');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Preview excl' });
    const own = await fileNodeService.createFile(ctx.root.id, 'own.jpg');

    const foreign = await fileNodeService.createFile(other.root.id, 'foreign.png');
    await grantTestPermissionByNodeId({
      userId: ctx.user.id,
      fileNodeId: foreign.id,
      permission: 'read',
    });
    const gone = await fileNodeService.createFile(other.root.id, 'gone.jpg');
    await grantTestPermissionByNodeId({
      userId: ctx.user.id,
      fileNodeId: gone.id,
      permission: 'read',
    });

    await collectionsService.addItems(ctx.user.id, manual.collection.id, [
      own.id,
      foreign.id,
      gone.id,
    ]);
    // newest-added are the foreign rows; they surface for the owner (readable)
    await setAddedAt(manual.collection.id, own.id, '2026-01-01 00:00:00');
    await setAddedAt(manual.collection.id, foreign.id, '2026-06-01 00:00:00');
    // revoke the `gone` grant → state:'revoked' placeholder
    await dbRun('DELETE FROM permissions_user_files WHERE file_node_id = ?', [gone.id]);
    await dbRun('DELETE FROM permissions_user_paths WHERE file_node_id = ?', [gone.id]);

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === manual.collection.id);
    expect(row.preview_items).toEqual([
      { node_id: foreign.id, name: 'foreign.png', type: 'file', mime: null },
      { node_id: own.id, name: 'own.jpg', type: 'file', mime: null },
    ]);
    // revoked row stays excluded (access lost); item_count unchanged (view truth)
    expect(row.preview_items.map((i) => i.node_id)).not.toContain(gone.id);
    expect(row.item_count).toBe(3);
  });

  it('preview mime comes from the filecache row (one field, P-3)', async () => {
    const ctx = await setupServiceUser('preview-mime');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Preview mime' });
    const img = await fileNodeService.createFile(ctx.root.id, 'shot.jpg');
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [img.id]);
    await dbRun('INSERT INTO filecache (file_node_id, size, mime_type) VALUES (?, 10, ?)', [
      img.id,
      'image/jpeg',
    ]);

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === manual.collection.id);
    expect(row.preview_items).toEqual([
      { node_id: img.id, name: 'shot.jpg', type: 'file', mime: 'image/jpeg' },
    ]);
  });

  it('builds previews from the ALREADY-resolved member view — zero extra queries', async () => {
    const ctx = await setupServiceUser('preview-zeroq');
    const a = await collectionsService.createCollection(ctx.user.id, { name: 'Zero A' });
    const b = await collectionsService.createCollection(ctx.user.id, { name: 'Zero B' });
    const file = await fileNodeService.createFile(ctx.root.id, 'z.jpg');
    await collectionsService.addItems(ctx.user.id, a.collection.id, [file.id]);
    await collectionsService.addItems(ctx.user.id, b.collection.id, [file.id]);

    // One requester-side liked-filter per collection row (resolveMemberRows) —
    // preview construction must NOT add a second member-view resolution.
    const filterLiked = jest.spyOn(fileLikesStore, 'filterLiked');
    filterLiked.mockClear();
    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const likedCalls = filterLiked.mock.calls.length;
    filterLiked.mockRestore();

    expect(collections).toHaveLength(2);
    expect(collections[0].preview_items).toBeDefined();
    expect(collections[1].preview_items).toBeDefined();
    expect(likedCalls).toBe(2);
  });

  it('getCollection serializes the same preview_items from its resolved view', async () => {
    const ctx = await setupServiceUser('preview-single');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Preview one' });
    const file = await fileNodeService.createFile(ctx.root.id, 'solo.jpg');
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [file.id]);

    const { collection } = await collectionsService.getCollection(
      ctx.user.id,
      manual.collection.id
    );
    expect(collection.preview_items).toEqual([
      { node_id: file.id, name: 'solo.jpg', type: 'file', mime: null },
    ]);
  });
});

describe('collectionsService createSeedCollection gate', () => {
  it('throws aiNotConfigured without the embed role', async () => {
    const ctx = await createUserWithRoot('svc-seedcreate');
    await expect(
      collectionsService.createSeedCollection(ctx.user.id, {
        name: 'Seed',
        seedNodeId: ctx.root.id,
      })
    ).rejects.toMatchObject({ message: 'aiNotConfigured', status: 409 });
  });
});

// ---------------------------------------------------------------------------
// Seed preview / creation (§2.7) — the vector seam is live: pooled embedding
// of the seed vs the requester-visible corpus, seed excluded, initial batch
// published=true.
// ---------------------------------------------------------------------------

function embedConfiguredAdapter() {
  return {
    roleConfigured: jest.fn(async (role) => role === 'embed'),
  };
}

async function ensureEmbedModel(tag) {
  const unique = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: unique,
    modelRevision: null,
    precision: 'q4',
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
    enabled: true,
  });
  return Number(id);
}

async function embedNode(nodeId, modelId, vector) {
  await embeddingsStore.upsert(Number(nodeId), {
    modelId,
    dim: vector.length,
    vector,
    source: 'fulltext',
    contentHash: `seed-${nodeId}-${Date.now()}`,
  });
}

describe('collectionsService seed preview (§2.7)', () => {
  afterEach(() => {
    collectionsService.__resetRuntimeSeamsForTests();
  });

  it('degrades to an empty preview when the seed has no pooled embedding', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedmissing');

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result).toEqual({
      count: 0,
      sample: [],
      sample_truncated: false,
      degraded: true,
    });
  });

  it('ranks visible candidates, excludes the seed and other users, and names the sample', async () => {
    const adapter = embedConfiguredAdapter();
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: adapter });
    const ctx = await setupServiceUser('seedrank');
    const other = await setupServiceUser('seedrank-other');
    const modelId = await ensureEmbedModel('seedrank');

    const near = await fileNodeService.createFile(ctx.root.id, 'near.jpg');
    const far = await fileNodeService.createFile(ctx.root.id, 'far.jpg');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    await embedNode(near.id, modelId, [0.99, 0.1, 0, 0]);
    await embedNode(far.id, modelId, [0, 1, 0, 0]);
    // Same vector but NOT readable by the requester — the ACL set must drop it.
    await embedNode(other.stay.id, modelId, [1, 0, 0, 0]);

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(2);
    expect(result.sample_truncated).toBe(false);
    expect(result.degraded).toBeUndefined();
    expect(result.sample.map((row) => row.nodeId)).toEqual([near.id, far.id]);
    expect(result.sample[0]).toEqual({ nodeId: near.id, name: 'near.jpg' });
    expect(result.sample.some((row) => row.nodeId === ctx.beach.id)).toBe(false);
    expect(result.sample.some((row) => row.nodeId === other.stay.id)).toBe(false);
  });

  it('scores visible candidates with pooled cosine (no retrieval scorer)', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedacl');
    const modelId = await ensureEmbedModel('seedacl');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    await embedNode(ctx.stay.id, modelId, [0.9, 0.1, 0, 0]);

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(1);
    expect(result.sample).toEqual([{ nodeId: ctx.stay.id, name: 'stay.jpg' }]);
    expect(result.degraded).toBeUndefined();
  });

  it('caps the sample at 12 and flags truncation', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedcap');
    const modelId = await ensureEmbedModel('seedcap');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    for (let i = 0; i < 15; i += 1) {
      const file = await fileNodeService.createFile(ctx.root.id, `cap-${i}.jpg`);
      await embedNode(file.id, modelId, [1, i / 100, 0, 0]);
    }

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(15);
    expect(result.sample).toHaveLength(12);
    expect(result.sample_truncated).toBe(true);
  });
});

describe('collectionsService view-weighted soft boost (§2.3 — ordering only)', () => {
  /**
   * Seed = beach [1,0,0,0]. Raw cosine order: strong (≈0.999) > mid (≈0.994)
   * > viewed (0.8). The viewed node carries 9999 viewing signals
   * (open + preview lifetime counts), so boosted(0.8) = 0.8 × 1.4 = 1.12
   * outranks strong under the shipped α = 0.1.
   */
  async function setupBoostFixture(extraCandidateVector) {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('viewboost');
    const modelId = await ensureEmbedModel('viewboost');
    const strong = await fileNodeService.createFile(ctx.root.id, 'strong.jpg');
    const mid = await fileNodeService.createFile(ctx.root.id, 'mid.jpg');
    const viewed = await fileNodeService.createFile(ctx.root.id, 'viewed.jpg');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    await embedNode(strong.id, modelId, [1, 0.05, 0, 0]);
    await embedNode(mid.id, modelId, [0.9, 0.1, 0, 0]);
    await embedNode(viewed.id, modelId, [0.8, 0.6, 0, 0]);
    let cold = null;
    if (extraCandidateVector) {
      cold = await fileNodeService.createFile(ctx.root.id, 'cold.jpg');
      await embedNode(cold.id, modelId, extraCandidateVector);
    }
    const viewedRows = [
      {
        userId: ctx.user.id,
        nodeId: viewed.id,
        counts: { open: 5000, download: 0, preview: 4999, search_hit: 0, like: 0 },
        lastSeenAtMs: Date.now(),
        score: 9999,
        updatedAtMs: Date.now(),
      },
    ];
    if (cold) {
      viewedRows.push({
        userId: ctx.user.id,
        nodeId: cold.id,
        counts: { open: 5000, download: 0, preview: 4999, search_hit: 0, like: 0 },
        lastSeenAtMs: Date.now(),
        score: 9999,
        updatedAtMs: Date.now(),
      });
    }
    await usageStore.upsertNodeActivity(viewedRows);
    return { ctx, strong, mid, viewed, cold };
  }

  /** Mirror of the evolution-suite config seam: warm the resolver cache after a write. */
  async function setConfig(key, value) {
    await Settings.set(key, String(value));
    const resolver = getSharedResolver();
    resolver.invalidateCache(key);
    await resolver.getConfig(key);
  }

  afterEach(async () => {
    collectionsService.__resetRuntimeSeamsForTests();
    await setConfig('AI_VIEW_WEIGHT_ALPHA', '0.1');
  });

  it('re-ranks the preview sample by the view-boosted score; the creation batch stays raw', async () => {
    const { ctx, strong, mid, viewed } = await setupBoostFixture();

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(3);
    expect(result.sample.map((row) => row.nodeId)).toEqual([viewed.id, strong.id, mid.id]);

    // Admission never sees the boost: the batch is the same top-K candidate set.
    const { collection } = await collectionsService.createSeedCollection(ctx.user.id, {
      name: 'Boosted',
      seedNodeId: ctx.beach.id,
    });
    const items = await collectionsStore.listStoredItems(collection.id);
    expect(items.map((row) => Number(row.nodeId)).sort((a, b) => a - b)).toEqual(
      [strong.id, mid.id, viewed.id].sort((a, b) => a - b)
    );
  });

  it('AI_VIEW_WEIGHT_ALPHA=0 restores the raw cosine sample order (T2 hot read)', async () => {
    const { ctx, strong, mid, viewed } = await setupBoostFixture();
    await setConfig('AI_VIEW_WEIGHT_ALPHA', '0');

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.sample.map((row) => row.nodeId)).toEqual([strong.id, mid.id, viewed.id]);
  });

  it('the top-K cut and the batch never move with views (admission un-boosted)', async () => {
    // 201 candidates with strictly decreasing cosine; the LOWEST-cosine file
    // carries 9999 views. A boost leaking into the top-K cut would displace
    // the raw top file with the viewed low-cosine one.
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('viewcut');
    const modelId = await ensureEmbedModel('viewcut');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    const candidates = [];
    for (let i = 0; i < 201; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const file = await fileNodeService.createFile(ctx.root.id, `cut-${i}.jpg`);
      // eslint-disable-next-line no-await-in-loop
      await embedNode(file.id, modelId, [Math.cos(i * 0.001), Math.sin(i * 0.001), 0, 0]);
      candidates.push(file);
    }
    const lowest = candidates[200]; // raw rank #201 — outside the top-K cut
    const highest = candidates[0];
    await usageStore.upsertNodeActivity([
      {
        userId: ctx.user.id,
        nodeId: lowest.id,
        counts: { open: 5000, download: 0, preview: 4999, search_hit: 0, like: 0 },
        lastSeenAtMs: Date.now(),
        score: 9999,
        updatedAtMs: Date.now(),
      },
    ]);

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(200);
    expect(result.sample.some((row) => row.nodeId === lowest.id)).toBe(false);
    expect(result.sample.some((row) => row.nodeId === highest.id)).toBe(true);

    const { collection } = await collectionsService.createSeedCollection(ctx.user.id, {
      name: 'Cut guard',
      seedNodeId: ctx.beach.id,
    });
    const items = await collectionsStore.listStoredItems(collection.id);
    expect(items.some((row) => Number(row.nodeId) === lowest.id)).toBe(false);
    expect(items.some((row) => Number(row.nodeId) === highest.id)).toBe(true);
  });
});

describe('collectionsService createSeedCollection (§2.7)', () => {
  afterEach(() => {
    collectionsService.__resetRuntimeSeamsForTests();
  });

  it('stores the seed definition (θ=0.62) and materializes the preview batch published=true', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedcreate');
    const modelId = await ensureEmbedModel('seedcreate');
    const near = await fileNodeService.createFile(ctx.root.id, 'near.jpg');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);
    await embedNode(near.id, modelId, [0.99, 0.1, 0, 0]);

    const preview = await collectionsService.preview(ctx.user.id, {
      seedNodeId: ctx.beach.id,
    });
    const { collection, undo } = await collectionsService.createSeedCollection(ctx.user.id, {
      name: 'Beach-like',
      seedNodeId: ctx.beach.id,
    });

    expect(collection).toMatchObject({ name: 'Beach-like', origin: 'seed', status: 'active' });
    expect(collection.definition).toEqual({
      kind: 'seed_vector',
      seed_ref: ctx.beach.id,
      theta: 0.62,
    });
    expect(undo.actionId).toBeGreaterThan(0);

    const items = await dbQuery(
      'SELECT node_id, published FROM collection_items WHERE collection_id = ? ORDER BY node_id',
      [collection.id]
    );
    expect(items.rows.map((row) => Number(row.node_id))).toEqual([near.id]);
    expect(Number(items.rows[0].published)).toBe(1);
    expect(items.rows).toHaveLength(preview.count);

    // Creator cursor seeded inside the create TX (no sidebar new dot).
    const cursor = await dbQuery(
      'SELECT last_visited_at FROM collection_digest_cursors WHERE collection_id = ? AND user_id = ?',
      [collection.id, ctx.user.id]
    );
    expect(cursor.rows).toHaveLength(1);
    expect(cursor.rows[0].last_visited_at).toBeTruthy();
  });

  it('still creates the collection with the definition when the seed has no embedding', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedcreateempty');

    const { collection } = await collectionsService.createSeedCollection(ctx.user.id, {
      name: 'Empty seed',
      seedNodeId: ctx.beach.id,
    });
    expect(collection.origin).toBe('seed');
    expect(collection.definition).toEqual({
      kind: 'seed_vector',
      seed_ref: ctx.beach.id,
      theta: 0.62,
    });
    const count = await dbQuery(
      'SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?',
      [collection.id]
    );
    expect(Number(count.rows[0].n)).toBe(0);
  });

  it('fills a blank request name through the naming service', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedname');

    const { collection } = await collectionsService.createSeedCollection(ctx.user.id, {
      seedNodeId: ctx.beach.id,
    });
    expect(collection.name).toBe('beach.jpg and similar files');
  });
});

// ---------------------------------------------------------------------------
// Search save leg (§2.2 createSearchCollection + §2.2.1 dispatch): the
// flattened semantic-execution snapshot creates a search-origin collection
// whose initial batch materializes published=true.
// ---------------------------------------------------------------------------

describe('collectionsService createSearchCollection (search save leg)', () => {
  it('creates a search-origin collection from the flattened snapshot; the initial batch lands published=true', async () => {
    const ctx = await setupServiceUser('searchcreate');

    const { collection, undo, rejected_not_readable } =
      await collectionsService.createSearchCollection(ctx.user.id, {
        name: 'banana harvest festival',
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [ctx.beach.id] },
      });

    expect(collection).toMatchObject({ name: 'banana harvest festival', origin: 'search' });
    // §2.7 flattening: the stored definition is the SNAPSHOT (result_ref
    // reference + predicate set) — replay chains and name-match ids never
    // enter it.
    expect(collection.definition).toEqual({
      kind: 'search',
      result_ref: 'sr1.abc0123456789ef',
      predicates: [],
    });
    expect(rejected_not_readable).toEqual([]);
    expect(undo.actionId).toBeGreaterThan(0);

    // the semantic member materialized as the initial batch, published=true
    const items = await collectionsStore.listStoredItems(collection.id);
    expect(items).toHaveLength(1);
    expect(items[0].nodeId).toBe(ctx.beach.id);
    expect(items[0].published).toBe(true);
  });

  it('reports unreadable ids in rejected_not_readable and adds only the readable rest', async () => {
    const ctx = await setupServiceUser('searchread');
    const stranger = await createUserWithRoot('svc-searchother');
    const secret = await fileNodeService.createFile(stranger.root.id, 'secret.txt');

    const { collection, rejected_not_readable } = await collectionsService.createSearchCollection(
      ctx.user.id,
      {
        name: 'Mixed',
        semantic: {
          resultRef: 'sr1.abc0123456789ef',
          predicates: [],
          nodeIds: [ctx.beach.id, secret.id],
        },
      }
    );

    expect(rejected_not_readable).toEqual([secret.id]);
    const items = await collectionsStore.listStoredItems(collection.id);
    expect(items).toHaveLength(1);
    expect(items[0].nodeId).toBe(ctx.beach.id);
  });

  it('rejects an empty semantic member set honestly (emptyNodeIds)', async () => {
    const ctx = await setupServiceUser('searchempty');
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: 'Empty',
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [] },
      })
    ).rejects.toMatchObject({ message: 'emptyNodeIds' });
  });

  it('rejects malformed snapshots with invalidDefinition (resultRef, predicates, shape)', async () => {
    const ctx = await setupServiceUser('searchmalformed');
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: 'Bad ref',
        semantic: { predicates: [], nodeIds: [ctx.beach.id] },
      })
    ).rejects.toMatchObject({ message: 'invalidDefinition' });
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: 'Bad predicates',
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: null, nodeIds: [ctx.beach.id] },
      })
    ).rejects.toMatchObject({ message: 'invalidDefinition' });
    // P1 reserves the predicate set: only the empty set is accepted.
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: 'Nonempty predicates',
        semantic: {
          resultRef: 'sr1.abc0123456789ef',
          predicates: [{ type: 'tag' }],
          nodeIds: [ctx.beach.id],
        },
      })
    ).rejects.toMatchObject({ message: 'invalidDefinition' });
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: 'Missing ids',
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [] },
      })
    ).rejects.toMatchObject({ message: 'invalidDefinition' });
  });

  it('journals the create + initial batch as two commands; the undo pointer is the create command', async () => {
    const ctx = await setupServiceUser('searchjournal');

    const { collection, undo } = await collectionsService.createSearchCollection(ctx.user.id, {
      name: 'Journaled',
      semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [ctx.beach.id] },
    });

    const journal = await dbQuery(
      'SELECT id, action, subject FROM action_journal WHERE subject = ? ORDER BY id ASC',
      [`collection:${collection.id}`]
    );
    expect(journal.rows.map((row) => row.action)).toEqual(['create', 'add-items']);
    expect(undo.actionId).toBe(journal.rows[0].id);
  });

  it('undo of the returned pointer removes the collection together with the initial batch', async () => {
    const ctx = await setupServiceUser('searchundo');
    const { collection, undo } = await collectionsService.createSearchCollection(ctx.user.id, {
      name: 'Undoable',
      semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [ctx.beach.id] },
    });

    const actionsService = require('@server/domains/actions/service');
    await actionsService.undoAction(ctx.user.id, undo.actionId, { confirmCascade: true });

    expect(await collectionsStore.getCollection(collection.id)).toBeNull();
    expect(await collectionsStore.listStoredItems(collection.id)).toHaveLength(0);
  });

  it('requires a valid name like the manual arm (nameRequired / invalidName)', async () => {
    const ctx = await setupServiceUser('searchname');
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [ctx.beach.id] },
      })
    ).rejects.toMatchObject({ message: 'nameRequired' });
    await expect(
      collectionsService.createSearchCollection(ctx.user.id, {
        name: '.wea-hidden',
        semantic: { resultRef: 'sr1.abc0123456789ef', predicates: [], nodeIds: [ctx.beach.id] },
      })
    ).rejects.toMatchObject({ message: 'invalidName' });
  });
});

// ---------------------------------------------------------------------------
// T0.9 — cosine-free rule evaluation: tag atoms resolve against ai_tag_raw
// (folded string equality), like/path atoms stay live, upload-hook seam.
// ---------------------------------------------------------------------------

describe('collectionsService rule evaluation (T0.9 tag atoms)', () => {
  it('tag atom matches through the fold (EXT: JPG ⇒ ext:jpg) via preview and getItems', async () => {
    const ctx = await setupServiceUser('ruletag');
    await aiTagStore.replaceRawTags(ctx.beach.id, ['ext:jpg', 'month:2026-09']);
    await aiTagStore.replaceRawTags(ctx.stay.id, ['ext:txt']);

    const definition = { kind: 'predicate', any_of: [{ type: 'tag', value: ' EXT:JPG ' }] };
    const result = await collectionsService.preview(ctx.user.id, { definition });
    expect(result.count).toBe(1);
    expect(result.sample).toEqual([{ nodeId: ctx.beach.id, name: 'beach.jpg' }]);

    const system = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'Jpg rule', origin: 'system', definition },
      { actor: ctx.user.id }
    );
    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.beach.id);
    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    const beachRow = view.items.find((row) => row.nodeId === ctx.beach.id);
    expect(beachRow).toMatchObject({ membership: 'derived', reason: 'tag:EXT:JPG' });
    expect(view.items.some((row) => row.nodeId === ctx.stay.id)).toBe(false);
  });

  it('mixed all_of tag + like atoms require both (like via fileLikesStore)', async () => {
    const ctx = await setupServiceUser('rulemix');
    await aiTagStore.replaceRawTags(ctx.beach.id, ['mime:image']);
    await aiTagStore.replaceRawTags(ctx.stay.id, ['mime:image']);

    const definition = {
      kind: 'predicate',
      all_of: [{ type: 'tag', value: 'mime:image' }, { type: 'like' }],
    };
    expect((await collectionsService.preview(ctx.user.id, { definition })).count).toBe(0);

    await fileLikesStore.addLike(ctx.user.id, ctx.beach.id);
    const result = await collectionsService.preview(ctx.user.id, { definition });
    expect(result.count).toBe(1);
    expect(result.sample[0].nodeId).toBe(ctx.beach.id);

    // other users' likes never drive this viewer's membership (invariant 9)
    const other = await createUserWithRoot('rulemixother');
    await fileLikesStore.addLike(other.user.id, ctx.stay.id);
    expect((await collectionsService.preview(other.user.id, { definition })).count).toBe(0);
  });

  it('tag atom over an unpopulated store matches nothing (empty-set fallback parity)', async () => {
    const ctx = await setupServiceUser('ruleempty');
    const result = await collectionsService.preview(ctx.user.id, {
      definition: { kind: 'predicate', any_of: [{ type: 'tag', value: 'no-such-tag' }] },
    });
    expect(result.count).toBe(0);
  });
});

describe('collectionsService checkUploadAdmissions (T0.9 seam; §2.3-bis)', () => {
  it('admits a freshly committed node into the owner predicate collection and touches it', async () => {
    const ctx = await createUserWithRoot('hooknew');
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
    const folder = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    expect((await collectionsStore.getCollection(system.id)).lastMemberChangeAt).toBeNull();

    const fresh = await fileNodeService.createFile(folder.id, 'dune.jpg');
    const result = await collectionsService.checkUploadAdmissions(ctx.user.id, fresh.id);

    expect(result).toEqual({ nodeId: fresh.id, admittedCollectionIds: [system.id] });
    expect((await collectionsStore.getCollection(system.id)).lastMemberChangeAt).not.toBeNull();
    expect(await collectionsStore.getStoredItem(system.id, fresh.id)).toMatchObject({
      source: 'system',
      reason: `path:/${ctx.user.username}/travel`,
      published: false,
    });
    // the member view now carries it as a derived row with its reason
    // (the prefix directory itself matches the path atom and is materialized
    // at the same write boundary)
    await collectionsService.checkUploadAdmissions(ctx.user.id, folder.id);
    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    // established path-prefix parity (T0.3): the prefix directory itself matches
    expect(view.items.map((row) => row.nodeId).sort((x, y) => x - y)).toEqual(
      [folder.id, fresh.id].sort((x, y) => x - y)
    );
    const freshRow = view.items.find((row) => row.nodeId === fresh.id);
    expect(freshRow).toMatchObject({
      membership: 'derived',
      reason: `path:/${ctx.user.username}/travel`,
    });
  });

  it('short-circuits excluded, already-stored, archived and other-owner collections', async () => {
    const ctx = await createUserWithRoot('hookguard');
    const folder = await fileNodeService.createDirectory(ctx.root.id, 'cam');
    const definition = {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/cam` }],
    };

    const excludedCol = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'HookExcl', origin: 'system', definition },
      { actor: ctx.user.id }
    );
    const storedCol = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'HookStored', origin: 'system', definition },
      { actor: ctx.user.id }
    );
    const archivedCol = await collectionsStore.createCollection(
      { ownerId: ctx.user.id, name: 'HookArchived', origin: 'system', definition },
      { actor: ctx.user.id }
    );
    await collectionsService.archiveCollection(ctx.user.id, archivedCol.id);
    const other = await createUserWithRoot('hookother');
    await collectionsStore.createCollection(
      { ownerId: other.user.id, name: 'ForeignHook', origin: 'system', definition },
      { actor: other.user.id }
    );

    const fresh = await fileNodeService.createFile(folder.id, 'shot.png');
    await collectionsStore.addExclusion(excludedCol.id, fresh.id, { actor: ctx.user.id });
    await collectionsService.addItems(ctx.user.id, storedCol.id, [fresh.id]);

    const result = await collectionsService.checkUploadAdmissions(ctx.user.id, fresh.id);
    expect(result).toEqual({ nodeId: fresh.id, admittedCollectionIds: [] });

    // behavior parity in the views: excluded → absent, stored → present once
    const exclView = await collectionsService.getItems(ctx.user.id, excludedCol.id, {});
    expect(exclView.items.map((row) => row.nodeId)).not.toContain(fresh.id);
    const storedView = await collectionsService.getItems(ctx.user.id, storedCol.id, {});
    expect(storedView.items.map((row) => row.nodeId)).toContain(fresh.id);
    expect(storedView.items.find((row) => row.nodeId === fresh.id).membership).toBe('stored');
  });

  it('admits a pooled-vector match and materializes source/reason', async () => {
    const ctx = await createUserWithRoot('hookvec');
    const modelId = await ensureEmbedModel('hookvec');
    const seed = await fileNodeService.createFile(ctx.root.id, 'seed.jpg');
    const match = await fileNodeService.createFile(ctx.root.id, 'match.jpg');
    await embedNode(seed.id, modelId, [1, 0, 0, 0]);
    await embedNode(match.id, modelId, [0.99, 0.1, 0, 0]);

    const collection = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Similar',
        origin: 'system',
        definition: { kind: 'seed_vector', seed_ref: seed.id, theta: 0.6 },
      },
      { actor: ctx.user.id }
    );

    const result = await collectionsService.checkUploadAdmissions(ctx.user.id, match.id);
    expect(result.admittedCollectionIds).toEqual([collection.id]);
    const row = await collectionsStore.getStoredItem(collection.id, match.id);
    expect(row).toMatchObject({ source: 'system', reason: 'similar', published: false });
  });

  it('non-matching nodes, directories and vector-only definitions admit nothing', async () => {
    const ctx = await createUserWithRoot('hooknone');
    await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'TravelOnly',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'VectorOnly',
        origin: 'system',
        definition: { kind: 'seed_vector', seed_ref: 1, theta: 0.6 },
      },
      { actor: ctx.user.id }
    );

    const outside = await fileNodeService.createFile(ctx.root.id, 'outside.txt');
    expect(
      (await collectionsService.checkUploadAdmissions(ctx.user.id, outside.id))
        .admittedCollectionIds
    ).toEqual([]);
    expect(
      (await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.root.id))
        .admittedCollectionIds
    ).toEqual([]);
  });
});

// Admin operator rule (owner pivot 2026-10-01, supersedes the §13 admin
// ownership DEFINITIONS): collections/likes/dashboard are personal-storage
// surfaces — the ADMIN actor never participates (routes 403 via
// requireNonAdmin; admin create/read/publish participation is covered as
// 403 in the route suites). The permissionPolicy file-ACL admin-owns-
// everything convention remains untouched. Services stay actor-agnostic
// EXCEPT the grant-creation ban: an admin grantee is rejected `forbidden`.
// Foreign stays keyed on the collection OWNER (non-admin by construction),
// so the owner-keyed cross-leak exclusion over admin-home files is real.
// ---------------------------------------------------------------------------

describe('collectionsService admin operator rule (grantee ban + owner-keyed foreign)', () => {
  async function createAdminUserWithRoot(tag) {
    const { user } = await createAuthenticatedTestUser({
      username: `adm-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      isAdmin: true,
    });
    const root = await fileNodeService.createDirectory(null, user.username);
    return { user, root };
  }

  it('NON-admin owner keeps shared_excluded for a member inside ADMIN home (owner-keyed rule)', async () => {
    const admin = await createAdminUserWithRoot('lockadm');
    const alice = await createUserWithRoot('lock-alice');
    const adminHomeFile = await fileNodeService.createFile(admin.root.id, 'admhome.txt');
    const manual = await collectionsService.createCollection(alice.user.id, { name: 'Locked' });
    await grantTestPermissionByNodeId({
      userId: alice.user.id,
      fileNodeId: adminHomeFile.id,
      permission: 'read',
    });
    await collectionsService.addItems(alice.user.id, manual.collection.id, [adminHomeFile.id]);

    const view = await collectionsService.getItems(alice.user.id, manual.collection.id, {});
    const row = view.items.find((item) => item.nodeId === adminHomeFile.id);
    expect(row).toMatchObject({ sharedExcluded: true });

    // the admin actor can never reach a shared view of this collection:
    // the grant creation ban lives in shareService.grant (covered in the
    // share suite) and the routes 403 admins.
  });
});

describe('collectionsService new-dot cursor fields (2026-10-01 owner ruling)', () => {
  it('createCollection seeds the creator cursor; listCollections rows carry last_visited_at', async () => {
    const ctx = await setupServiceUser('lvc-seed');
    const { collection } = await collectionsService.createCollection(ctx.user.id, {
      name: 'LVC seed',
    });

    const cursors = await dbQuery(
      'SELECT user_id, last_visited_at FROM collection_digest_cursors WHERE collection_id = ?',
      [collection.id]
    );
    expect(cursors.rows).toHaveLength(1);
    expect(Number(cursors.rows[0].user_id)).toBe(Number(ctx.user.id));
    expect(new Date(cursors.rows[0].last_visited_at).getTime()).toBe(
      new Date(collection.createdAt).getTime()
    );

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toHaveProperty('last_visited_at');
    expect(row.last_visited_at).not.toBeNull();
    expect(new Date(row.last_visited_at).getTime()).toBe(new Date(collection.createdAt).getTime());
  });

  it('legacy collection without a cursor row → listCollections row carries null; getCollection omits the field', async () => {
    const ctx = await createUserWithRoot('lvc-legacy');
    const storage = require('@server/store/storage');
    const createCollectionsRepository = require('@server/store/repositories/CollectionsRepository');
    const repo = createCollectionsRepository(storage.getExecutor());
    const legacy = await storage
      .getExecutor()
      .transaction((tx) =>
        repo.insertCollection(tx, { ownerId: ctx.user.id, name: 'Legacy row', origin: 'user' })
      );

    const { collections } = await collectionsService.listCollections(ctx.user.id, {
      include: 'mine',
    });
    const row = collections.find((c) => c.collection_id === Number(legacy.id));
    expect(row).toHaveProperty('last_visited_at', null);

    const single = await collectionsService.getCollection(ctx.user.id, Number(legacy.id));
    expect(single.collection).not.toHaveProperty('last_visited_at');
  });

  it('grantee flow: null until first open; getItems stamps so the next list carries an ISO cursor', async () => {
    const owner = await setupServiceUser('lvc-g-o');
    const grantee = await setupServiceUser('lvc-g-g');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'LVC shared',
    });
    await collectionsStore.grantAccess(collection.id, grantee.user.id, 'viewer', owner.user.id, {
      actor: owner.user.id,
    });

    const before = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const beforeRow = before.collections.find((c) => c.collection_id === collection.id);
    expect(beforeRow).toHaveProperty('last_visited_at', null);

    const openedAt = Date.now();
    await collectionsService.getItems(grantee.user.id, collection.id);

    const after = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const afterRow = after.collections.find((c) => c.collection_id === collection.id);
    expect(afterRow.last_visited_at).not.toBeNull();
    expect(new Date(afterRow.last_visited_at).getTime()).toBeGreaterThanOrEqual(openedAt - 1000);

    // the OWNER's seeded cursor is untouched by the grantee's visit
    const ownerList = await collectionsService.listCollections(owner.user.id, {
      include: 'mine',
    });
    const ownerRow = ownerList.collections.find((c) => c.collection_id === collection.id);
    expect(new Date(ownerRow.last_visited_at).getTime()).toBe(
      new Date(collection.createdAt).getTime()
    );
  });
});

describe('collectionsService item ordering (§3.4 lazy decay)', () => {
  async function setupOrdered(tag) {
    const ctx = await createUserWithRoot(tag);
    const a = await fileNodeService.createFile(ctx.root.id, 'a.png');
    const b = await fileNodeService.createFile(ctx.root.id, 'b.png');
    const { collection } = await collectionsService.createCollection(ctx.user.id, {
      name: `Order ${tag}`,
    });
    await collectionsService.addItems(ctx.user.id, collection.id, [a.id, b.id]);
    return { ctx, a, b, collection };
  }

  async function setActivity(ctx, nodeId, { score, updatedAtMs }) {
    await usageStore.upsertNodeActivity([
      {
        userId: ctx.user.id,
        nodeId,
        counts: { open: 0, download: 0, preview: 0, search_hit: 0, like: 0 },
        lastSeenAtMs: updatedAtMs,
        score,
        updatedAtMs,
      },
    ]);
  }

  it('orders by lazy-decayed score desc, node_id asc as tie-break (decay correct)', async () => {
    const { ctx, a, b, collection } = await setupOrdered('decay');
    const now = Date.now();
    // a: 10 now; b: 6 with a 30d-old rollup ⇒ H=30d half-life ⇒ ≈3
    await setActivity(ctx, a.id, { score: 10, updatedAtMs: now });
    await setActivity(ctx, b.id, { score: 6, updatedAtMs: now - 30 * 86400000 });

    const { items } = await collectionsService.getItems(ctx.user.id, collection.id, {});
    const scores = new Map(items.map((item) => [item.nodeId, item.score]));
    expect(items.map((item) => item.nodeId)).toEqual([a.id, b.id]);
    expect(scores.get(a.id)).toBeCloseTo(10, 1);
    expect(scores.get(b.id)).toBeCloseTo(3, 1);
  });

  it('falls back to node_id asc when every score is absent (stable zero state)', async () => {
    const { ctx, a, b, collection } = await setupOrdered('noactivity');
    const { items } = await collectionsService.getItems(ctx.user.id, collection.id, {});
    expect(items.map((item) => [item.nodeId, item.score])).toEqual([
      [a.id, 0],
      [b.id, 0],
    ]);
  });
});
