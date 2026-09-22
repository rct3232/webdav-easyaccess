/**
 * collectionsService unit tests (domain objects, thrown bare string codes).
 * @see docs/spec/server/services/collectionsService.md
 */
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const fileLikesStore = require('@server/store/fileLikesStore');
const aiTagStore = require('@server/store/aiTagStore');
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
