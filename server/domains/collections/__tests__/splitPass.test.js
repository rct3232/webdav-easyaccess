/**
 * evolutionService split pass (docs/spec/server/services/evolutionService.md
 * §2.5): the deterministic hot-subset rule, the inherited create gates, the
 * sibling creation/provenance contract and idempotency. DB-backed fixtures use
 * the real stores; the active embed model, pooled vectors, likes and the
 * `node_activity` accumulator are provisioned per test.
 */
const evolutionService = require('../evolutionService');
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const fileLikesStore = require('@server/store/fileLikesStore');
const usageStore = require('@server/store/usageStore');
const aiTagStore = require('@server/store/aiTagStore');
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
  dbQuery,
  dbRun,
} = require('@server/test-utils');

let dbCleanup;
let fileNodeService;

const CONFIG_DEFAULTS = {
  AI_EVOLUTION_ENABLED: 'true',
  AI_EVOLUTION_TRIGGER: 'both',
  AI_EVOLUTION_DEBOUNCE_S: '90',
  AI_EVOLUTION_NIGHTLY_ENABLED: 'true',
  AI_EVOLUTION_CREATE_ENABLED: 'true',
  AI_EVOLUTION_CREATE_RATE_DAYS: '0',
};

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

beforeEach(async () => {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    // eslint-disable-next-line no-await-in-loop
    await setConfig(key, value);
  }
});

async function setConfig(key, value) {
  await Settings.set(key, String(value));
  const resolver = getSharedResolver();
  resolver.invalidateCache(key);
  await resolver.getConfig(key);
  return resolver.getConfigSync(key);
}

async function createUserWithRoot(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `split-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
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
    source: 'fulltext',
    vector,
    contentHash: `split-${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

/** Pooled vectors that are pairwise orthogonal (cosine 0 ⇒ no create clusters). */
async function embedSpread(nodeIds, modelId) {
  const dim = Math.max(nodeIds.length, 2);
  for (const [index, nodeId] of nodeIds.entries()) {
    const vector = new Array(dim).fill(0);
    vector[index] = 1;
    // eslint-disable-next-line no-await-in-loop
    await embedNode(nodeId, modelId, vector);
  }
}

/**
 * Tightly spaced pooled vectors (pairwise cosine ≈ 0.99): keeps a
 * self-centroid preview/reconcile at the same membership while the create pass
 * either promotes against an existing set or is blocked by persistence.
 * Returns the vectors so callers can seed a matching centroid.
 */
async function embedSimilar(nodeIds, modelId) {
  const vectors = nodeIds.map((_, index) => [1, 0.01 * (index + 1), 0.005 * (index + 1)]);
  for (const [index, nodeId] of nodeIds.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await embedNode(nodeId, modelId, vectors[index]);
  }
  return vectors;
}

function meanOf(vectors) {
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) out[i] += vector[i];
  }
  return out.map((value) => value / vectors.length);
}

function parentDefinition({ tier = 'mid', theta = 0.8, eventClass = 'travel' } = {}) {
  return {
    kind: 'centroid',
    centroid_ref: null,
    theta,
    tier,
    event_class: eventClass,
  };
}

async function createParent(
  ctx,
  {
    memberCount = 20,
    tier = 'mid',
    theta = 0.8,
    eventClass = 'travel',
    origin = 'system',
    name,
  } = {}
) {
  const files = [];
  for (let i = 0; i < memberCount; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    files.push(await fileNodeService.createFile(ctx.root.id, `m-${i}-${Date.now()}.jpg`));
  }
  const collection = await collectionsStore.createCollection(
    {
      ownerId: ctx.user.id,
      name: name || `Parent ${Math.random().toString(36).slice(2, 8)}`,
      origin,
      ...(origin === 'user' ? {} : { definition: parentDefinition({ tier, theta, eventClass }) }),
    },
    { actor: ctx.user.id }
  );
  await collectionsStore.addItems(
    collection.id,
    files.map((file) => file.id),
    ctx.user.id,
    { published: true, source: 'system', reason: 'similar' },
    { actor: 'system' }
  );
  return { collection, files };
}

/** Write positive accumulator scores for the given nodes (one rollup instant). */
async function markActivity(userId, nodeIds, { score = 1 } = {}) {
  if (nodeIds.length === 0) return;
  const stamp = Date.now() - 1000;
  await usageStore.upsertNodeActivity(
    nodeIds.map((nodeId) => ({
      userId: Number(userId),
      nodeId: Number(nodeId),
      counts: { open: 1, download: 0, preview: 0, search_hit: 0, like: 0 },
      lastSeenAtMs: stamp,
      score,
      updatedAtMs: Date.now(),
    }))
  );
}

async function likeAll(userId, nodeIds) {
  for (const nodeId of nodeIds) {
    // eslint-disable-next-line no-await-in-loop
    await fileLikesStore.addLike(userId, nodeId);
  }
}

async function systemCollections(userId) {
  const rows = await collectionsStore.listForUser(userId, { status: 'all' });
  return rows.filter((row) => row.ownerId === userId && row.origin === 'system');
}

async function siblingItems(collectionId) {
  return collectionsStore.listStoredItems(collectionId);
}

/** Snapshot the fields the split pass must never write on the parent. */
async function parentSnapshot(collectionId) {
  const row = await collectionsStore.getCollection(collectionId);
  const items = await collectionsStore.listStoredItems(collectionId);
  return {
    definition: row.definition,
    status: row.status,
    name: row.name,
    items: items.map((item) => ({
      nodeId: item.nodeId,
      source: item.source,
      reason: item.reason,
      published: item.published,
      addedBy: item.addedBy,
    })),
  };
}

describe('evolutionService split pass (§2.5)', () => {
  it('creates a hot-subset sibling, leaves the parent untouched, and journals as system', async () => {
    const ctx = await createUserWithRoot('basic');
    const modelId = await ensureEmbedModel('basic');
    const parent = await createParent(ctx, { memberCount: 20, name: 'Travel' });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSimilar(
      hot.map((file) => file.id),
      modelId
    );

    const before = await parentSnapshot(parent.collection.id);
    const staleStamp = new Date(Date.now() - 30 * 86400000).toISOString();
    await dbRun('UPDATE collections SET last_member_change_at = ? WHERE id = ?', [
      staleStamp,
      parent.collection.id,
    ]);

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.candidates).toBe(1);
    expect(result.created).toHaveLength(1);
    expect(result.promoted).toBe(0);
    expect(result.suppressed).toBe(0);
    const sibling = result.created[0];
    expect(sibling).toMatchObject({
      parentId: parent.collection.id,
      tier: 'mid',
      event_class: 'travel',
      memberCount: 8,
    });

    // Parent definition + membership are byte-identical.
    const after = await parentSnapshot(parent.collection.id);
    expect(after).toEqual(before);
    const parentRow = await collectionsStore.getCollection(parent.collection.id);
    expect(new Date(parentRow.lastMemberChangeAt).getTime()).toBeGreaterThan(
      new Date(staleStamp).getTime()
    );

    const siblingRow = await collectionsStore.getCollection(sibling.id);
    expect(siblingRow).toMatchObject({ origin: 'system', status: 'active', publishMode: 'ask' });
    expect(siblingRow.definition).toEqual({
      kind: 'centroid',
      centroid_ref: null,
      theta: 0.8,
      tier: 'mid',
      event_class: 'travel',
      split_of: parent.collection.id,
    });

    const items = await siblingItems(sibling.id);
    expect(items.map((item) => item.nodeId).sort((a, b) => a - b)).toEqual(
      hot.map((file) => file.id).sort((a, b) => a - b)
    );
    for (const item of items) {
      expect(item).toMatchObject({
        source: 'system',
        reason: `split:${parent.collection.id}`,
        published: true,
      });
    }

    const journal = await dbQuery(
      'SELECT actor, action FROM action_journal WHERE subject = ? ORDER BY id',
      [`collection:${sibling.id}`]
    );
    expect(journal.rows.every((row) => row.actor === 'system')).toBe(true);
    expect(journal.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['create', 'add-items'])
    );

    const centroids = await collectionsStore.getCentroids([sibling.id], modelId);
    expect(centroids).toHaveLength(1);
    expect(centroids[0].memberCount).toBe(8);

    // Self-centroid definition resolves the owning collection's centroid row.
    const preview = await collectionsService.previewCollection(ctx.user.id, sibling.id);
    expect(preview.count).toBe(8);
  });

  it('counts activity OR likes, and only for the requesting user', async () => {
    const ctx = await createUserWithRoot('signals');
    const modelId = await ensureEmbedModel('signals');
    const parent = await createParent(ctx, { memberCount: 20 });
    const active = parent.files.slice(0, 4);
    const liked = parent.files.slice(4, 8);
    await markActivity(
      ctx.user.id,
      active.map((file) => file.id)
    );
    await likeAll(
      ctx.user.id,
      liked.map((file) => file.id)
    );
    await embedSpread(
      [...active, ...liked].map((file) => file.id),
      modelId
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.created).toHaveLength(1);
    const stored = await siblingItems(result.created[0].id);
    expect(stored.map((row) => row.nodeId).sort((a, b) => a - b)).toEqual(
      [...active, ...liked].map((file) => file.id).sort((a, b) => a - b)
    );

    // Another user's accumulator rows are not the owner's hot signal.
    const other = await createUserWithRoot('signals-other');
    const otherModel = await ensureEmbedModel('signals-other');
    const otherParent = await createParent(other, { memberCount: 20 });
    const foreignHot = otherParent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      foreignHot.map((file) => file.id)
    );
    await embedSpread(
      foreignHot.map((file) => file.id),
      otherModel
    );

    const skipped = await evolutionService.runSplitPass(other.user.id);

    expect(skipped.candidates).toBe(0);
    expect(skipped.created).toHaveLength(0);
  });

  it('requires at least 8 hot members', async () => {
    const ctx = await createUserWithRoot('min');
    const modelId = await ensureEmbedModel('min');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 7);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result).toEqual({ candidates: 0, created: [], promoted: 0, suppressed: 0 });
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('blocks an over-cap hot subset instead of truncating it', async () => {
    const ctx = await createUserWithRoot('cap');
    await ensureEmbedModel('cap');
    const parent = await createParent(ctx, { memberCount: 130 });
    const hot = parent.files.slice(0, 121);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.candidates).toBe(1);
    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBe(1);
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('promotes instead of creating when the hot subset is a near-copy of the parent', async () => {
    const ctx = await createUserWithRoot('promote');
    const modelId = await ensureEmbedModel('promote');
    const parent = await createParent(ctx, { memberCount: 10 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    // |hot| / |parent| = 0.8 ⇒ Jaccard ≥ 0.8 against the parent's set.
    expect(result.candidates).toBe(1);
    expect(result.created).toHaveLength(0);
    expect(result.promoted).toBe(1);
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('suppresses a tombstoned parent-equivalent definition', async () => {
    const ctx = await createUserWithRoot('tombstone');
    const modelId = await ensureEmbedModel('tombstone');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );
    await collectionsStore.addTombstone(
      ctx.user.id,
      collectionsService.fingerprintDefinition(parentDefinition())
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.candidates).toBe(1);
    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBe(1);
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('applies the create rate window and the active tight/mid cap', async () => {
    const ctx = await createUserWithRoot('rate');
    const modelId = await ensureEmbedModel('rate');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    // The parent is a fresh system collection ⇒ the rate window is closed.
    await setConfig('AI_EVOLUTION_CREATE_RATE_DAYS', '7');
    const rated = await evolutionService.runSplitPass(ctx.user.id);
    expect(rated.created).toHaveLength(0);
    expect(rated.suppressed).toBe(1);

    await setConfig('AI_EVOLUTION_CREATE_RATE_DAYS', '0');
    const allowed = await evolutionService.runSplitPass(ctx.user.id);
    expect(allowed.created).toHaveLength(1);

    // 12 active system tight/mid collections (parent included) hit the cap.
    const capped = await createUserWithRoot('active');
    const cappedModel = await ensureEmbedModel('active');
    const cappedParent = await createParent(capped, { memberCount: 20 });
    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await collectionsStore.createCollection(
        {
          ownerId: capped.user.id,
          name: `Filler ${i} ${Math.random().toString(36).slice(2, 8)}`,
          origin: 'system',
          definition: parentDefinition({ eventClass: 'other' }),
        },
        { actor: capped.user.id }
      );
    }
    const cappedHot = cappedParent.files.slice(0, 8);
    await markActivity(
      capped.user.id,
      cappedHot.map((file) => file.id)
    );
    await embedSpread(
      cappedHot.map((file) => file.id),
      cappedModel
    );

    const blocked = await evolutionService.runSplitPass(capped.user.id);
    expect(blocked.created).toHaveLength(0);
    expect(blocked.suppressed).toBe(1);
  });

  it('allows a loose parent split but blocks a second loose collection on its event class', async () => {
    const ctx = await createUserWithRoot('loose');
    const modelId = await ensureEmbedModel('loose');
    const parent = await createParent(ctx, { memberCount: 20, tier: 'loose', theta: 0.72 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ tier: 'loose', event_class: 'travel' });

    const occupied = await createUserWithRoot('loose-occupied');
    const occupiedModel = await ensureEmbedModel('loose-occupied');
    const occupiedParent = await createParent(occupied, {
      memberCount: 20,
      tier: 'loose',
      theta: 0.72,
    });
    await collectionsStore.createCollection(
      {
        ownerId: occupied.user.id,
        name: `Other broad ${Math.random().toString(36).slice(2, 8)}`,
        origin: 'system',
        definition: parentDefinition({ tier: 'loose', theta: 0.72 }),
      },
      { actor: occupied.user.id }
    );
    const occupiedHot = occupiedParent.files.slice(0, 8);
    await markActivity(
      occupied.user.id,
      occupiedHot.map((file) => file.id)
    );
    await embedSpread(
      occupiedHot.map((file) => file.id),
      occupiedModel
    );

    const blocked = await evolutionService.runSplitPass(occupied.user.id);

    expect(blocked.created).toHaveLength(0);
    expect(blocked.suppressed).toBe(1);
  });

  it('is idempotent: a second pass promotes against the sibling and creates nothing', async () => {
    const ctx = await createUserWithRoot('idempotent');
    const modelId = await ensureEmbedModel('idempotent');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    const first = await evolutionService.runSplitPass(ctx.user.id);
    expect(first.created).toHaveLength(1);

    const second = await evolutionService.runSplitPass(ctx.user.id);
    expect(second.created).toHaveLength(0);
    // Both the parent and the sibling promote their own near-identical subset.
    expect(second.promoted).toBeGreaterThanOrEqual(1);
    expect(await systemCollections(ctx.user.id)).toHaveLength(2);
  });

  it('creates nothing without activity or likes', async () => {
    const ctx = await createUserWithRoot('cold');
    const modelId = await ensureEmbedModel('cold');
    const parent = await createParent(ctx, { memberCount: 20 });
    await embedSpread(
      parent.files.slice(0, 8).map((file) => file.id),
      modelId
    );

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result).toEqual({ candidates: 0, created: [], promoted: 0, suppressed: 0 });
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('splits every hot active system parent but never a non-system collection', async () => {
    const ctx = await createUserWithRoot('multiple');
    const modelId = await ensureEmbedModel('multiple');
    const first = await createParent(ctx, { memberCount: 20, eventClass: 'alpha' });
    const second = await createParent(ctx, { memberCount: 20, eventClass: 'beta' });
    const manual = await createParent(ctx, { memberCount: 20, origin: 'user' });

    for (const parent of [first, second, manual]) {
      const hot = parent.files.slice(0, 8);
      // eslint-disable-next-line no-await-in-loop
      await markActivity(
        ctx.user.id,
        hot.map((file) => file.id)
      );
      // eslint-disable-next-line no-await-in-loop
      await embedSpread(
        hot.map((file) => file.id),
        modelId
      );
    }

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.created).toHaveLength(2);
    expect(result.created.map((row) => row.parentId).sort((a, b) => a - b)).toEqual(
      [first.collection.id, second.collection.id].sort((a, b) => a - b)
    );
    expect(result.created.map((row) => row.parentId)).not.toContain(manual.collection.id);
    // parent + parent + manual + 2 siblings
    expect(await systemCollections(ctx.user.id)).toHaveLength(4);
  });

  it('names the sibling {parentName} · {diffTag} from the hot members top tag', async () => {
    const ctx = await createUserWithRoot('naming');
    const modelId = await ensureEmbedModel('naming');
    const parent = await createParent(ctx, { memberCount: 20, name: 'Travel' });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );
    for (const file of hot) {
      // eslint-disable-next-line no-await-in-loop
      await aiTagStore.replaceRawTags(file.id, ['beach', 'sunset']);
    }

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].name).toBe('Travel · beach');
    const parentRow = await collectionsStore.getCollection(parent.collection.id);
    expect(parentRow.name).toBe('Travel');
  });

  it('suppresses a hot subset with no pooled vector in the active model space', async () => {
    const ctx = await createUserWithRoot('novector');
    const staleModel = await ensureEmbedModel('novector-stale');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      staleModel
    );
    // A newer enabled model becomes active; the stored vectors belong to the
    // previous space, so the self-centroid reference cannot be built.
    await ensureEmbedModel('novector-active');

    const result = await evolutionService.runSplitPass(ctx.user.id);

    expect(result.candidates).toBe(1);
    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBe(1);
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('returns an empty result when the create or global kill switch is off', async () => {
    const ctx = await createUserWithRoot('disabled');
    const modelId = await ensureEmbedModel('disabled');
    const parent = await createParent(ctx, { memberCount: 20 });
    const hot = parent.files.slice(0, 8);
    await markActivity(
      ctx.user.id,
      hot.map((file) => file.id)
    );
    await embedSpread(
      hot.map((file) => file.id),
      modelId
    );

    await setConfig('AI_EVOLUTION_CREATE_ENABLED', 'false');
    expect(await evolutionService.runSplitPass(ctx.user.id)).toEqual({
      candidates: 0,
      created: [],
      promoted: 0,
      suppressed: 0,
    });

    await setConfig('AI_EVOLUTION_CREATE_ENABLED', 'true');
    await setConfig('AI_EVOLUTION_ENABLED', 'false');
    expect(await evolutionService.runSplitPass(ctx.user.id)).toEqual({
      candidates: 0,
      created: [],
      promoted: 0,
      suppressed: 0,
    });
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });

  it('runs inside the cheap pass and reports split counters', async () => {
    const ctx = await createUserWithRoot('pass');
    const modelId = await ensureEmbedModel('pass');
    const parent = await createParent(ctx, { memberCount: 20 });
    // All members embedded (the parent centroid matches them) so reconcile keeps
    // the membership; the create pass promotes against that same set.
    const vectors = await embedSimilar(
      parent.files.map((file) => file.id),
      modelId
    );
    await collectionsStore.upsertCentroid(
      parent.collection.id,
      modelId,
      meanOf(vectors).join(','),
      parent.files.length
    );
    await markActivity(
      ctx.user.id,
      parent.files.slice(0, 8).map((file) => file.id)
    );

    const pass = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'cheap' });

    expect(pass.perUser[0].reconciled).toEqual({ added: 0, removed: 0, collections: 0 });
    expect(pass.perUser[0].split.created).toHaveLength(1);
    expect(pass.report.totals.split_created).toBeGreaterThanOrEqual(1);
    expect(pass.report.totals).toMatchObject({
      split_promoted: expect.any(Number),
      split_suppressed: expect.any(Number),
    });
  });

  it('returns an empty split result with no active embed model', async () => {
    const ctx = await createUserWithRoot('nomodel');
    const parent = await createParent(ctx, { memberCount: 20 });
    await markActivity(
      ctx.user.id,
      parent.files.slice(0, 8).map((file) => file.id)
    );
    await dbRun('UPDATE llm_models SET enabled = 0');

    expect(await evolutionService.runSplitPass(ctx.user.id)).toEqual({
      candidates: 0,
      created: [],
      promoted: 0,
      suppressed: 0,
    });
    expect(await systemCollections(ctx.user.id)).toHaveLength(1);
  });
});
