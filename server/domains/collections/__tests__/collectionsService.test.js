/**
 * collectionsService unit tests (domain objects, thrown bare string codes).
 * @see docs/spec/server/services/collectionsService.md
 */
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const fileLikesStore = require('@server/store/fileLikesStore');
const aiTagStore = require('@server/store/aiTagStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
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

    await dbRun("UPDATE file_nodes SET deleted_at = datetime('now') WHERE id = ?", [ctx.beach.id]);
    await dbRun('DELETE FROM permissions_user_files WHERE file_node_id = ?', [ctx.beach.id]);

    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    const row = view.items.find((i) => i.nodeId === ctx.beach.id);
    // beach is now trashed → hidden entirely (revoked requires a live, unreadable row)
    expect(row).toBeUndefined();
  });

  it('excludes derived matches after an exclusion; stored rows ignore exclusions', async () => {
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

    await collectionsStore.addExclusion(system.id, ctx.beach.id, { actor: ctx.user.id });
    const view = await collectionsService.getItems(ctx.user.id, system.id, {});
    const ids = view.items.map((i) => i.nodeId);
    expect(ids).not.toContain(ctx.beach.id);
    // stored rows survive exclusions
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

  it('getForNodes includes derived membership and exclusions, one entry per node', async () => {
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
    await collectionsStore.addExclusion(system.id, ctx.beach.id, { actor: ctx.user.id });

    const result = await collectionsService.getForNodes(ctx.user.id, [ctx.beach.id, ctx.travel.id]);
    expect(result.memberships).toEqual([
      { nodeId: ctx.beach.id, collectionIds: [] },
      { nodeId: ctx.travel.id, collectionIds: [system.id] },
    ]);
  });
});

describe('collectionsService similar sort', () => {
  it('groups rows by greedy nearest-neighbor over centroids with stable cluster_index', async () => {
    const ctx = await createUserWithRoot('svc-similar');
    const a = await collectionsService.createCollection(ctx.user.id, { name: 'A' });
    const b = await collectionsService.createCollection(ctx.user.id, { name: 'B' });
    const c = await collectionsService.createCollection(ctx.user.id, { name: 'C' });

    // SIMILAR_MODEL_ID is pinned to 0 until the T1.1 model registry lands — seed
    // the placeholder model row explicitly.
    await dbRun(
      `INSERT INTO llm_models (id, role, provider, base_url_key, model_name) VALUES (0, 'embed', 'test', 'k', 'm')`
    );
    await collectionsStore.upsertCentroid(a.collection.id, 0, JSON.stringify([1, 0]), 3);
    await collectionsStore.upsertCentroid(b.collection.id, 0, JSON.stringify([0.99, 0.01]), 3);
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

  it('passes the visible ACL set and k=200 to the vectorStore seam', async () => {
    collectionsService.__setRuntimeSeamsForTests({ llmAdapter: embedConfiguredAdapter() });
    const ctx = await setupServiceUser('seedacl');
    const modelId = await ensureEmbedModel('seedacl');
    await embedNode(ctx.beach.id, modelId, [1, 0, 0, 0]);

    const neighbors = jest.fn(async () => [
      { nodeId: ctx.beach.id, score: 1 },
      { nodeId: ctx.stay.id, score: 0.9 },
    ]);
    collectionsService.__setRuntimeSeamsForTests({
      vectorStoreFactory: () => ({ neighbors }),
    });

    const result = await collectionsService.preview(ctx.user.id, { seedNodeId: ctx.beach.id });
    expect(result.count).toBe(1);
    expect(result.sample).toEqual([{ nodeId: ctx.stay.id, name: 'stay.jpg' }]);

    expect(neighbors).toHaveBeenCalledTimes(1);
    const [seedVec, k, candidates] = neighbors.mock.calls[0];
    expect(seedVec).toEqual([1, 0, 0, 0]);
    expect(k).toBe(200);
    expect(candidates).toBeInstanceOf(Set);
    expect(candidates.has(ctx.stay.id)).toBe(true);
    expect(candidates.has(ctx.beach.id)).toBe(false);
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
    // the member view now carries it as a derived row with its reason
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

// ---------------------------------------------------------------------------
// Grantee self-revocation — revokeOwnGrant (P-1 Path 1, §4.7 instant)
// ---------------------------------------------------------------------------

describe('collectionsService revokeOwnGrant (grants/me)', () => {
  async function setupSharedCollection(tag, role) {
    const owner = await createUserWithRoot(`svcg-${tag}-owner`);
    const grantee = await createUserWithRoot(`svcg-${tag}-grantee`);
    const stranger = await createUserWithRoot(`svcg-${tag}-stranger`);
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: `Shared ${tag}`,
    });
    await collectionsStore.grantAccess(collection.id, grantee.user.id, role, owner.user.id, {
      actor: owner.user.id,
    });
    return { owner, grantee, stranger, collection };
  }

  it.each(['viewer', 'editor'])(
    '%s grantee self-revokes: row removed via the owner-side store path (undo pointer returned)',
    async (role) => {
      const { grantee, collection } = await setupSharedCollection(`self-${role}`, role);

      const result = await collectionsService.revokeOwnGrant(grantee.user.id, collection.id);
      expect(result).toMatchObject({ grantee_id: grantee.user.id, revoked: true });
      expect(result.undo.actionId).toBeGreaterThan(0);
      expect(await collectionsStore.getGrant(collection.id, grantee.user.id)).toBeNull();
    }
  );

  it('collection owner self-calls throw grantNotFound (no self-grant row)', async () => {
    const { owner, collection } = await setupSharedCollection('owner-self', 'viewer');
    await expect(
      collectionsService.revokeOwnGrant(owner.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'grantNotFound', status: 404 });
  });

  it('zero-access callers and unknown collections throw the notFound masquerade', async () => {
    const { stranger, collection } = await setupSharedCollection('stranger', 'viewer');
    await expect(
      collectionsService.revokeOwnGrant(stranger.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
    await expect(
      collectionsService.revokeOwnGrant(stranger.user.id, 99999999)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
  });

  it('a revoked grantee re-calling is zero-access: notFound masquerade', async () => {
    const { grantee, collection } = await setupSharedCollection('twice', 'viewer');
    await collectionsService.revokeOwnGrant(grantee.user.id, collection.id);
    await expect(
      collectionsService.revokeOwnGrant(grantee.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
  });
});

describe('collectionsService publishItems (P-4)', () => {
  async function publishedOf(collectionId, nodeId) {
    const stored = await collectionsStore.getStoredItem(collectionId, nodeId);
    return stored ? stored.published : null;
  }

  it('owner flips stored rows both directions; the row is never deleted; journal inverse restores', async () => {
    const ctx = await setupServiceUser('publish-flip');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Flip' });
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [ctx.beach.id]);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(false);

    const publish = await collectionsService.publishItems(
      ctx.user.id,
      manual.collection.id,
      [ctx.beach.id],
      true
    );
    expect(publish).toMatchObject({ published: [ctx.beach.id], ignored: [] });
    expect(publish.undo.actionId).toBeGreaterThan(0);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(true);

    const unpublish = await collectionsService.publishItems(
      ctx.user.id,
      manual.collection.id,
      [ctx.beach.id],
      false
    );
    expect(unpublish.published).toEqual([ctx.beach.id]);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(false);
    // unpublish NEVER deletes the stored row
    expect(await collectionsStore.getStoredItem(manual.collection.id, ctx.beach.id)).not.toBeNull();

    const journal = await dbQuery(
      'SELECT payload FROM action_journal WHERE subject = ? AND action = ? ORDER BY id DESC LIMIT 1',
      [`collection:${manual.collection.id}`, 'set-items-published']
    );
    const inverse = JSON.parse(journal.rows[0].payload).inverse;
    expect(inverse).toMatchObject({ op: 'set-items-published', published: true });
  });

  it('publishing a DERIVED member materializes a stored published=true marker (membership stays derived, auto-pin touched)', async () => {
    const ctx = await setupServiceUser('publish-derived');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Derived pub',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    // pre: beach is a derived member, virtually published:false, NO stored row
    expect(await collectionsStore.getStoredItem(system.id, ctx.beach.id)).toBeNull();
    const before = await collectionsService.getItems(ctx.user.id, system.id, {});
    expect(before.items.find((i) => i.nodeId === ctx.beach.id).published).toBe(false);
    expect(before.publishPendingCount).toBeGreaterThan(0);

    const result = await collectionsService.publishItems(
      ctx.user.id,
      system.id,
      [ctx.beach.id],
      true
    );
    expect(result.published).toEqual([ctx.beach.id]);
    const stored = await collectionsStore.getStoredItem(system.id, ctx.beach.id);
    expect(stored).toMatchObject({ published: true, addedBy: ctx.user.id });

    // membership TRUTH stays derived: the view renders the node ONCE (stored wins)
    const after = await collectionsService.getItems(ctx.user.id, system.id, {});
    const rows = after.items.filter((i) => i.nodeId === ctx.beach.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].published).toBe(true);
    expect(after.publishPendingCount).toBe(before.publishPendingCount - 1);

    // §4.9b: publishing on a system collection touches the auto-pin
    const col = await collectionsStore.getCollection(system.id);
    expect(col.pinnedBy).toBe('auto');
  });

  it('unpublishing a derived-only row is a NO-OP (already virtually unpublished) — ignored', async () => {
    const ctx = await setupServiceUser('publish-unpub');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Derived unpub',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    const result = await collectionsService.publishItems(
      ctx.user.id,
      system.id,
      [ctx.beach.id],
      false
    );
    expect(result.published).toEqual([]);
    expect(result.ignored).toEqual([ctx.beach.id]);
    expect(result.undo).toBeNull();
    expect(await collectionsStore.getStoredItem(system.id, ctx.beach.id)).toBeNull();
  });

  it('non-member ids land in ignored[] — the route never ADDS membership (anti-injection)', async () => {
    const ctx = await setupServiceUser('publish-inject');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Inject' });
    const result = await collectionsService.publishItems(
      ctx.user.id,
      manual.collection.id,
      [ctx.beach.id],
      true
    );
    expect(result.published).toEqual([]);
    expect(result.ignored).toEqual([ctx.beach.id]);
    expect(result.undo).toBeNull();
    expect(await collectionsStore.getStoredItem(manual.collection.id, ctx.beach.id)).toBeNull();
  });

  it('ACL: editor may flip stored rows; viewer throws forbidden; ungranted throws notFound', async () => {
    const owner = await createUserWithRoot('pub-owner');
    const editor = await createUserWithRoot('pub-editor');
    const viewer = await createUserWithRoot('pub-viewer');
    const stranger = await createUserWithRoot('pub-stranger');
    const manual = await collectionsService.createCollection(owner.user.id, { name: 'Acl pub' });
    await collectionsStore.grantAccess(
      manual.collection.id,
      editor.user.id,
      'editor',
      owner.user.id
    );
    await collectionsStore.grantAccess(
      manual.collection.id,
      viewer.user.id,
      'viewer',
      owner.user.id
    );
    const ownerBeach = await fileNodeService.createFile(owner.root.id, 'apub.jpg');

    const ok = await collectionsService.publishItems(
      editor.user.id,
      manual.collection.id,
      [ownerBeach.id],
      true
    );
    expect(ok).toMatchObject({ published: [], ignored: [ownerBeach.id] });

    await collectionsService.addItems(owner.user.id, manual.collection.id, [ownerBeach.id]);
    const editorFlip = await collectionsService.publishItems(
      editor.user.id,
      manual.collection.id,
      [ownerBeach.id],
      true
    );
    expect(editorFlip.published).toEqual([ownerBeach.id]);

    await expect(
      collectionsService.publishItems(viewer.user.id, manual.collection.id, [ownerBeach.id], true)
    ).rejects.toMatchObject({ message: 'forbidden' });
    await expect(
      collectionsService.publishItems(stranger.user.id, manual.collection.id, [ownerBeach.id], true)
    ).rejects.toMatchObject({ message: 'notFound' });
  });

  it('empty/oversized nodeIds reuse the parseNodeIds boundary (emptyNodeIds)', async () => {
    const ctx = await setupServiceUser('publish-vals');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Vals' });
    await expect(
      collectionsService.publishItems(ctx.user.id, manual.collection.id, [], true)
    ).rejects.toMatchObject({ message: 'emptyNodeIds' });
    await expect(
      collectionsService.publishItems(ctx.user.id, manual.collection.id, [ctx.beach.id], 'yes')
    ).rejects.toMatchObject({ message: 'invalidPublishMode' });
  });
});

// ---------------------------------------------------------------------------
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
    // the grant below is banned at creation (and the routes 403 admins).
  });

  it('admin-as-grantee is banned at grant creation (`forbidden`); non-admin grantees unaffected', async () => {
    const admin = await createAdminUserWithRoot('banadm');
    const alice = await createUserWithRoot('ban-alice');
    const bob = await createUserWithRoot('ban-bob');
    const manual = await collectionsService.createCollection(alice.user.id, { name: 'BanAdm' });

    await expect(
      collectionsService.grantCollectionAccess(
        alice.user.id,
        manual.collection.id,
        admin.user.id,
        'viewer'
      )
    ).rejects.toMatchObject({ message: 'forbidden' });

    const ok = await collectionsService.grantCollectionAccess(
      alice.user.id,
      manual.collection.id,
      bob.user.id,
      'viewer'
    );
    expect(ok.grant.granteeId).toBe(bob.user.id);
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
    await collectionsService.grantCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id,
      'viewer'
    );

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

// ---------------------------------------------------------------------------
// Revoke deletes the grantee cursor — ruling B (owner, 2026-10-02, P0 closeout)
// ---------------------------------------------------------------------------

describe('collectionsService revoke deletes the grantee cursor (ruling B, 2026-10-02)', () => {
  async function setupOpenedShare(tag) {
    const owner = await setupServiceUser(`rb-${tag}-o`);
    const grantee = await setupServiceUser(`rb-${tag}-g`);
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: `RB ${tag}`,
    });
    await collectionsService.grantCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id,
      'viewer'
    );
    // the read IS the visit — stamps the grantee's cursor row
    await collectionsService.getItems(grantee.user.id, collection.id);
    return { owner, grantee, collection };
  }

  it('owner-side revoke deletes the grantee cursor row; other users keep theirs', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('own');
    const other = await setupServiceUser('rb-own-other');
    await collectionsService.grantCollectionAccess(
      owner.user.id,
      collection.id,
      other.user.id,
      'viewer'
    );
    await collectionsService.getItems(other.user.id, collection.id);
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).not.toBeNull();

    const result = await collectionsService.revokeCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id
    );
    expect(result.revoked).toBe(true);
    expect(result.undo.actionId).toBeGreaterThan(0);

    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    // cursor isolation: the other grantee's row and the owner's seeded row survive
    expect(await collectionsStore.getDigestCursor(other.user.id, collection.id)).not.toBeNull();
    const ownerMap = await collectionsStore.listDigestCursorMap(owner.user.id);
    expect(ownerMap[collection.id]).toBeDefined();
  });

  it('re-grant after revoke re-dots: the grantee list row carries last_visited_at null', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('regrant');
    await collectionsService.revokeCollectionAccess(owner.user.id, collection.id, grantee.user.id);
    await collectionsService.grantCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id,
      'viewer'
    );
    const { collections } = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toHaveProperty('last_visited_at', null);
  });

  it('self-revoke rides the same store TX: the caller cursor row is deleted', async () => {
    const { grantee, collection } = await setupOpenedShare('self');
    const result = await collectionsService.revokeOwnGrant(grantee.user.id, collection.id);
    expect(result.revoked).toBe(true);
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
  });

  it('revoking a never-opened grant (no cursor row) succeeds: absent row is a no-op, not a throw', async () => {
    const owner = await setupServiceUser('rb-noc-o');
    const grantee = await setupServiceUser('rb-noc-g');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'RB NoCursor',
    });
    await collectionsService.grantCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id,
      'viewer'
    );
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    await expect(
      collectionsService.revokeCollectionAccess(owner.user.id, collection.id, grantee.user.id)
    ).resolves.toMatchObject({ revoked: true });
  });

  it('undo-revoke restores the GRANT but NOT the cursor — re-dots (owner-accepted boundary)', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('undo');
    const revoked = await collectionsService.revokeCollectionAccess(
      owner.user.id,
      collection.id,
      grantee.user.id
    );
    const actionsService = require('@server/domains/actions/service');
    await actionsService.undoAction(owner.user.id, revoked.undo.actionId);

    // grant restored …
    expect(await collectionsStore.getGrant(collection.id, grantee.user.id)).not.toBeNull();
    // … cursor NOT restored (ruling B undo boundary): the dot is back
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    const { collections } = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toHaveProperty('last_visited_at', null);
  });
});
