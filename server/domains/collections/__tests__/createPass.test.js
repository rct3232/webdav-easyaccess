/**
 * evolutionService create pass (docs/spec/server/services/evolutionService.md
 * §2.4): candidate generation, gates, promotion, naming and initial
 * materialization. DB-backed fixtures use real stores; the active embed model
 * and pooled vectors are provisioned per test.
 */
const evolutionService = require('../evolutionService');
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const fileLikesStore = require('@server/store/fileLikesStore');
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

const DAY_MS = 86400000;

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
    username: `create-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function embedNode(nodeId, modelId, vector, contentHash) {
  await embeddingsStore.upsert(Number(nodeId), {
    modelId,
    dim: vector.length,
    vector,
    source: 'fulltext',
    contentHash:
      contentHash || `create-${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

/** `count` unit vectors with pairwise cosine `cos`, in their own basis. */
function groupVectors(count, dim, start, cos) {
  return Array.from({ length: count }, (_, index) => {
    const vector = new Array(dim).fill(0);
    vector[start] = Math.sqrt(cos);
    vector[start + 1 + index] = Math.sqrt(1 - cos);
    return vector;
  });
}

async function createFolder(ctx, name) {
  return fileNodeService.createDirectory(ctx.root.id, name);
}

async function createGroupFiles(
  ctx,
  { folderName, count, dim, start, cos, modelId, likes = 0, tags = null } = {}
) {
  const folder = await createFolder(ctx, folderName);
  const vectors = groupVectors(count, dim, start, cos);
  const files = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const file = await fileNodeService.createFile(folder.id, `${folderName}-${i}.jpg`);
    // eslint-disable-next-line no-await-in-loop
    await embedNode(file.id, modelId, vectors[i]);
    if (i < likes) {
      // eslint-disable-next-line no-await-in-loop
      await fileLikesStore.addLike(ctx.user.id, file.id);
    }
    if (tags) {
      // eslint-disable-next-line no-await-in-loop
      await aiTagStore.replaceRawTags(file.id, tags);
    }
    files.push(file);
  }
  return { folder, files };
}

async function ageNodes(nodeIds, days = 20) {
  const stamp = new Date(Date.now() - days * DAY_MS).toISOString();
  for (const nodeId of nodeIds) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun('UPDATE file_nodes SET created_at = ? WHERE id = ?', [stamp, nodeId]);
  }
}

async function createSystem(ctx, { name, definition } = {}) {
  return collectionsStore.createCollection(
    {
      ownerId: ctx.user.id,
      name: name || `Existing ${Math.random().toString(36).slice(2, 8)}`,
      origin: 'system',
      definition,
    },
    { actor: ctx.user.id }
  );
}

async function ownedSystemCount(userId) {
  const rows = await collectionsStore.listForUser(userId, { status: 'all' });
  return rows.filter((row) => row.ownerId === userId && row.origin === 'system').length;
}

describe('evolutionService create pass (§2.4)', () => {
  it('returns an empty result with no active embed model', async () => {
    const ctx = await createUserWithRoot('nomodel');
    await dbRun('UPDATE llm_models SET enabled = 0');

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result).toEqual({ created: [], promoted: 0, suppressed: 0 });
    expect(await ownedSystemCount(ctx.user.id)).toBe(0);
  });

  it('returns an empty result when the create or global kill switch is off', async () => {
    const ctx = await createUserWithRoot('killswitch');
    const modelId = await ensureEmbedModel('killswitch');
    const group = await createGroupFiles(ctx, {
      folderName: 'killswitch',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));

    await setConfig('AI_EVOLUTION_CREATE_ENABLED', 'false');
    expect(await evolutionService.runCreatePass(ctx.user.id)).toEqual({
      created: [],
      promoted: 0,
      suppressed: 0,
    });

    await setConfig('AI_EVOLUTION_CREATE_ENABLED', 'true');
    await setConfig('AI_EVOLUTION_ENABLED', 'false');
    expect(await evolutionService.runCreatePass(ctx.user.id)).toEqual({
      created: [],
      promoted: 0,
      suppressed: 0,
    });
    expect(await ownedSystemCount(ctx.user.id)).toBe(0);
  });

  it('creates tight/mid/loose clusters once, materializes published system rows, journals as system, and is idempotent', async () => {
    const ctx = await createUserWithRoot('tiers');
    const modelId = await ensureEmbedModel('tiers');
    const dim = 27;

    const tight = await createGroupFiles(ctx, {
      folderName: 'tight',
      count: 8,
      dim,
      start: 0,
      cos: 0.9,
      modelId,
    });
    const mid = await createGroupFiles(ctx, {
      folderName: 'mid',
      count: 8,
      dim,
      start: 9,
      cos: 0.82,
      modelId,
    });
    const loose = await createGroupFiles(ctx, {
      folderName: 'loose',
      count: 8,
      dim,
      start: 18,
      cos: 0.75,
      modelId,
    });
    await ageNodes([...tight.files, ...mid.files, ...loose.files].map((file) => file.id));

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created.map((row) => row.tier)).toEqual(['tight', 'mid', 'loose']);
    // Each directory facet describes the same member set as its cluster.
    expect(result.promoted).toBe(3);
    expect(result.created.map((row) => row.memberCount)).toEqual([8, 8, 8]);
    expect(result.created.map((row) => row.event_class)).toEqual(['tight', 'mid', 'loose']);

    const first = await collectionsStore.getCollection(result.created[0].id);
    expect(first).toMatchObject({ origin: 'system', status: 'active' });
    expect(first.definition).toMatchObject({
      kind: 'centroid',
      centroid_ref: null,
      theta: 0.86,
      tier: 'tight',
      event_class: 'tight',
    });

    const rows = await collectionsStore.listStoredItems(first.id);
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row).toMatchObject({ source: 'system', reason: 'similar', published: true });
    }

    const journal = await dbQuery(
      'SELECT actor, action FROM action_journal WHERE subject = ? ORDER BY id',
      [`collection:${first.id}`]
    );
    expect(journal.rows.length).toBeGreaterThanOrEqual(2);
    expect(journal.rows.every((row) => row.actor === 'system')).toBe(true);
    expect(journal.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['create', 'add-items'])
    );

    const centroids = await collectionsStore.getCentroids([first.id], modelId);
    expect(centroids).toHaveLength(1);
    expect(centroids[0].memberCount).toBe(8);

    // Self-centroid: centroid_ref null resolves the owning collection row.
    const preview = await collectionsService.previewCollection(ctx.user.id, first.id);
    expect(preview.count).toBe(8);
    const membership = await collectionsService.evaluateDefinitionMembership(
      ctx.user.id,
      first.definition,
      { collectionId: first.id }
    );
    expect([...membership.keys()].sort((a, b) => a - b)).toEqual(
      tight.files.map((file) => file.id).sort((a, b) => a - b)
    );

    const second = await evolutionService.runCreatePass(ctx.user.id);
    expect(second.created).toHaveLength(0);
    expect(await ownedSystemCount(ctx.user.id)).toBe(3);
  });

  it('excludes identical-content twins from clustering', async () => {
    const ctx = await createUserWithRoot('twins');
    const modelId = await ensureEmbedModel('twins');
    const folder = await createFolder(ctx, 'twins');
    const vectors = groupVectors(8, 9, 0, 0.9);
    const files = [];
    for (let i = 0; i < 9; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const file = await fileNodeService.createFile(folder.id, `twin-${i}.jpg`);
      const hash = i === 8 ? 'hash-0' : `hash-${i}`;
      // eslint-disable-next-line no-await-in-loop
      await embedNode(file.id, modelId, vectors[Math.min(i, 7)], hash);
      files.push(file);
    }
    await ageNodes(files.map((file) => file.id));

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].memberCount).toBe(8);
    const stored = await collectionsStore.listStoredItems(result.created[0].id);
    expect(stored.map((row) => row.nodeId)).not.toContain(files[8].id);
    expect(stored.map((row) => row.nodeId)).toContain(files[0].id);
  });

  it('blocks a recent cluster until the persistence window passes; like density waives it', async () => {
    const ctx = await createUserWithRoot('persist');
    const modelId = await ensureEmbedModel('persist');
    const group = await createGroupFiles(ctx, {
      folderName: 'recent',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });

    const blocked = await evolutionService.runCreatePass(ctx.user.id);
    expect(blocked.created).toHaveLength(0);
    expect(blocked.suppressed).toBeGreaterThan(0);
    expect(await ownedSystemCount(ctx.user.id)).toBe(0);

    await ageNodes(group.files.map((file) => file.id));
    const grown = await evolutionService.runCreatePass(ctx.user.id);
    expect(grown.created).toHaveLength(1);
    expect(grown.created[0].tier).toBe('tight');

    const likedCtx = await createUserWithRoot('liked');
    const likedModel = await ensureEmbedModel('liked');
    const likedGroup = await createGroupFiles(likedCtx, {
      folderName: 'fresh-likes',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId: likedModel,
      likes: 8,
    });
    expect(likedGroup.files).toHaveLength(8);

    const waived = await evolutionService.runCreatePass(likedCtx.user.id);
    expect(waived.created).toHaveLength(1);
  });

  it('rejects a component below the minimum size', async () => {
    const ctx = await createUserWithRoot('small');
    const modelId = await ensureEmbedModel('small');
    const group = await createGroupFiles(ctx, {
      folderName: 'small',
      count: 7,
      dim: 10,
      start: 0,
      cos: 0.95,
      modelId,
    });
    const isolated = await fileNodeService.createFile(ctx.root.id, 'isolated.jpg');
    await embedNode(isolated.id, modelId, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    await ageNodes([...group.files, isolated].map((file) => file.id));

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBeGreaterThan(0);
  });

  it('rejects a component above the tier size cap', async () => {
    const ctx = await createUserWithRoot('cap');
    const modelId = await ensureEmbedModel('cap');
    const group = await createGroupFiles(ctx, {
      folderName: 'wide',
      count: 121,
      dim: 122,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBeGreaterThan(0);
  });

  it('enforces the weekly create rate', async () => {
    const ctx = await createUserWithRoot('rate');
    const modelId = await ensureEmbedModel('rate');
    const group = await createGroupFiles(ctx, {
      folderName: 'rate',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));
    await createSystem(ctx, {
      definition: { kind: 'centroid', centroid_ref: null, theta: 0.8, tier: 'mid' },
    });
    await setConfig('AI_EVOLUTION_CREATE_RATE_DAYS', '7');

    const blocked = await evolutionService.runCreatePass(ctx.user.id);
    expect(blocked.created).toHaveLength(0);

    await setConfig('AI_EVOLUTION_CREATE_RATE_DAYS', '0');
    const allowed = await evolutionService.runCreatePass(ctx.user.id);
    expect(allowed.created).toHaveLength(1);
  });

  it('enforces the active tight/mid cap and the broad per-event-class cap', async () => {
    const ctx = await createUserWithRoot('active');
    const modelId = await ensureEmbedModel('active');
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createSystem(ctx, {
        definition: {
          kind: 'centroid',
          centroid_ref: null,
          theta: 0.8,
          tier: 'mid',
          event_class: 'other',
        },
      });
    }
    const group = await createGroupFiles(ctx, {
      folderName: 'active',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));

    const capped = await evolutionService.runCreatePass(ctx.user.id);
    expect(capped.created).toHaveLength(0);

    const broadCtx = await createUserWithRoot('broad');
    const broadModel = await ensureEmbedModel('broad');
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createSystem(broadCtx, {
        definition: {
          kind: 'centroid',
          centroid_ref: null,
          theta: 0.8,
          tier: 'mid',
          event_class: 'other',
        },
      });
    }
    await createSystem(broadCtx, {
      definition: {
        kind: 'centroid',
        centroid_ref: null,
        theta: 0.72,
        tier: 'loose',
        event_class: 'travel',
      },
    });
    const broadGroup = await createGroupFiles(broadCtx, {
      folderName: 'travel',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.75,
      modelId: broadModel,
    });
    await ageNodes(broadGroup.files.map((file) => file.id));

    const broad = await evolutionService.runCreatePass(broadCtx.user.id);
    expect(broad.created).toHaveLength(0);
  });

  it('promotes instead of creating a duplicate when Jaccard >= 0.8 with an existing collection', async () => {
    const ctx = await createUserWithRoot('promote');
    const modelId = await ensureEmbedModel('promote');
    const group = await createGroupFiles(ctx, {
      folderName: 'promote',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));
    const existing = await createSystem(ctx, {
      definition: {
        kind: 'predicate',
        any_of: [{ type: 'path', value: `/${ctx.user.username}/promote` }],
      },
    });
    await collectionsStore.addItems(
      existing.id,
      group.files.map((file) => file.id),
      ctx.user.id,
      { published: true, source: 'system', reason: 'path' },
      { actor: 'system' }
    );

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(0);
    expect(result.promoted).toBeGreaterThanOrEqual(1);
    expect(await ownedSystemCount(ctx.user.id)).toBe(1);
  });

  it('suppresses a candidate whose definition fingerprint is tombstoned', async () => {
    const ctx = await createUserWithRoot('tombstone');
    const modelId = await ensureEmbedModel('tombstone');
    const group = await createGroupFiles(ctx, {
      folderName: 'tombstone',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
    });
    await ageNodes(group.files.map((file) => file.id));
    for (const [tier, theta] of [
      ['tight', 0.86],
      ['mid', 0.8],
      ['loose', 0.72],
    ]) {
      const definition = {
        kind: 'centroid',
        centroid_ref: null,
        theta,
        tier,
        event_class: 'tombstone',
      };
      // eslint-disable-next-line no-await-in-loop
      await collectionsStore.addTombstone(
        ctx.user.id,
        collectionsService.fingerprintDefinition(definition)
      );
    }

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(0);
    expect(result.suppressed).toBeGreaterThan(0);
    expect(await ownedSystemCount(ctx.user.id)).toBe(0);
  });

  it('names system clusters from the top-2 local tags', async () => {
    const ctx = await createUserWithRoot('naming');
    const modelId = await ensureEmbedModel('naming');
    const group = await createGroupFiles(ctx, {
      folderName: 'named',
      count: 8,
      dim: 9,
      start: 0,
      cos: 0.95,
      modelId,
      tags: ['beach', 'sunset'],
    });
    await ageNodes(group.files.map((file) => file.id));

    const result = await evolutionService.runCreatePass(ctx.user.id);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].name).toBe('beach · sunset photos');
  });
});
