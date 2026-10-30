'use strict';

/**
 * Dashboard near-dup keeper composite integration (docs/spec/server/services/
 * storageService.md §2.5.1). Real DB + real stores: the keeper comes from
 * activity/enrichment rows, the `reason.keep` block rides the persisted row,
 * and refreshes are reason-only (id/expiry/state stable). Exact dups and rule
 * rows keep their existing shapes.
 */
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbQuery,
  dbRun,
  grantTestPermissionByNodeId,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const composition = require('@server/service/composition');
const storageService = require('@server/domains/storage/service');
const llmModelsStore = require('@server/store/llmModelsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const usageStore = require('@server/store/usageStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const presets = require('@server/infrastructure/adapters/llm/presets');

let fileNodeService;
let dbCleanup;

const DAY_MS = 86400000;
const THETA = presets.getPresetByFamilyRole('embedded', 'embed').profile.thetaDup;

function s3BlobStub() {
  return {
    downloadBlob: jest.fn(),
    headBlob: jest.fn().mockResolvedValue(null),
    moveBlob: jest.fn().mockResolvedValue(undefined),
    deleteBlob: jest.fn().mockResolvedValue(undefined),
  };
}

async function storageUser(tag) {
  const { user } = await createAuthenticatedTestUser({ username: `keep-${tag}-${Date.now()}` });
  const home = await fileNodeService.createDirectory(null, user.username);
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: home.id, permission: 'admin' });
  return { user, homeId: home.id };
}

async function addFile(parentId, name, { size = 100, hash, mime = 'text/plain' } = {}) {
  const node = await createTestFileNode({ name, type: 'file', parentId });
  await createFileNodesStore().upsertCache(node.nodeId, size, mime, hash ?? null);
  return node;
}

async function activateEmbedModel() {
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    modelRevision: null,
    precision: 'q4',
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
    enabled: true,
  });
  return id;
}

function nearPairVector(t) {
  return [t, Math.sqrt(1 - t * t), 0, 0];
}

async function setActivity(userId, nodeId, { score, lastSeenAtMs }) {
  await usageStore.upsertNodeActivity([
    {
      userId: Number(userId),
      nodeId: Number(nodeId),
      counts: { open: 1, download: 0, preview: 0, search_hit: 0, like: 0 },
      score,
      lastSeenAtMs,
      updatedAtMs: lastSeenAtMs ?? Date.now(),
    },
  ]);
}

async function storedRows(userId) {
  const { rows } = await dbQuery(
    'SELECT * FROM storage_suggestions WHERE user_id = ? ORDER BY id',
    [Number(userId)]
  );
  return rows;
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  composition.__setCompositionForTests({
    fileStorageMode: 's3',
    blobStore: s3BlobStub(),
    fileNodeService,
  });
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

describe('getStorageSummary — near-dup keeper composite v1', () => {
  afterEach(async () => {
    await dbQuery('DELETE FROM embeddings', []);
    await dbQuery("DELETE FROM llm_models WHERE role = 'embed'", []);
  });

  async function seedNearPair(
    homeId,
    tag,
    { sizes = [100, 100], names = ['a.txt', 'b.txt'] } = {}
  ) {
    const modelId = await activateEmbedModel();
    const a = await addFile(homeId, `${tag}-${names[0]}`, {
      hash: `${tag}-a-${Date.now()}`,
      size: sizes[0],
    });
    const b = await addFile(homeId, `${tag}-${names[1]}`, {
      hash: `${tag}-b-${Date.now()}`,
      size: sizes[1],
    });
    await embeddingsStore.upsert(Number(a.nodeId), {
      modelId,
      dim: 4,
      vector: [1, 0, 0, 0],
      source: 'fulltext',
      contentHash: null,
    });
    await embeddingsStore.upsert(Number(b.nodeId), {
      modelId,
      dim: 4,
      vector: nearPairVector(THETA + 0.001),
      source: 'fulltext',
      contentHash: null,
    });
    return { a, b };
  }

  it('picks the highest composite (activity) — smallest id is only the tie-break', async () => {
    const { user, homeId } = await storageUser('activity');
    const { a, b } = await seedNearPair(homeId, 'act');

    // a (smaller id) is 30d-unopened; b is active with a lower raw score
    await setActivity(user.id, a.nodeId, {
      score: 5,
      lastSeenAtMs: Date.now() - 45 * DAY_MS,
    });
    await setActivity(user.id, b.nodeId, { score: 2, lastSeenAtMs: Date.now() });

    const summary = await storageService.getStorageSummary(user.id);
    const nearRows = summary.suggestions.filter((row) => row.kind === 'near_dup');

    expect(nearRows).toHaveLength(1);
    expect(nearRows[0].nodeId).toBe(Number(a.nodeId)); // the unopened member is suggested
    expect(nearRows[0].reason.keep_node_id).toBe(Number(b.nodeId));
    expect(nearRows[0].reason.keep).toEqual({
      name: 'act-b.txt',
      relative_score: expect.any(Number),
      confidence: 'high',
      basis: 'activity',
      factors: {
        activity: 1,
        quality: 0.5,
        name: 0.5,
        centrality: 0.5,
      },
      unopened_30d: false,
      score_version: 'v1',
    });
    expect(JSON.stringify(nearRows[0].reason.keep)).not.toMatch(/last_seen|opens|score_30d/);
  });

  it('keeps the smallest node id on an all-equal composite (neutral factors)', async () => {
    const { user, homeId } = await storageUser('tie');
    const { a, b } = await seedNearPair(homeId, 'tie', { names: ['one.txt', 'two.txt'] });
    // identical vectors: cosine 1.0 but distinct content hashes ⇒ near (not hash) twins
    const modelId = (await llmModelsStore.getActiveByRole('embed')).id;
    await embeddingsStore.upsert(Number(b.nodeId), {
      modelId,
      dim: 4,
      vector: [1, 0, 0, 0],
      source: 'fulltext',
      contentHash: null,
    });

    const summary = await storageService.getStorageSummary(user.id);
    const nearRows = summary.suggestions.filter((row) => row.kind === 'near_dup');

    expect(nearRows).toHaveLength(1);
    expect(nearRows[0].nodeId).toBe(Number(b.nodeId));
    expect(nearRows[0].reason.keep_node_id).toBe(Number(a.nodeId));
    expect(nearRows[0].reason.keep.relative_score).toBe(0.5);
    expect(nearRows[0].reason.keep.basis).toBe('none');
    expect(nearRows[0].reason.keep.confidence).toBe('low');
  });

  it('refreshes reason only when keeper quality changes (id/created_at/expires_at/state stable)', async () => {
    const { user, homeId } = await storageUser('refresh');
    const modelId = await activateEmbedModel();
    const a = await addFile(homeId, 'a.png', {
      hash: `rf-a-${Date.now()}`,
      mime: 'image/png',
      size: 10,
    });
    const b = await addFile(homeId, 'b.png', {
      hash: `rf-b-${Date.now()}`,
      mime: 'image/png',
      size: 20,
    });
    const c = await addFile(homeId, 'c.png', {
      hash: `rf-c-${Date.now()}`,
      mime: 'image/png',
      size: 30,
    });
    await embeddingsStore.upsert(Number(a.nodeId), {
      modelId,
      dim: 4,
      vector: [1, 0, 0, 0],
      source: 'fulltext',
      contentHash: null,
    });
    await embeddingsStore.upsert(Number(b.nodeId), {
      modelId,
      dim: 4,
      vector: nearPairVector(THETA + 0.001),
      source: 'fulltext',
      contentHash: null,
    });
    await embeddingsStore.upsert(Number(c.nodeId), {
      modelId,
      dim: 4,
      vector: nearPairVector(THETA + 0.0005),
      source: 'fulltext',
      contentHash: null,
    });
    await aiEnrichmentsStore.upsert(Number(b.nodeId), { probe: { width: 2000, height: 2000 } });
    await aiEnrichmentsStore.upsert(Number(c.nodeId), { probe: { width: 1000, height: 1000 } });
    // a keeps the keeper slot by activity, with the WORST resolution first
    await aiEnrichmentsStore.upsert(Number(a.nodeId), { probe: { width: 100, height: 100 } });
    await setActivity(user.id, a.nodeId, { score: 100, lastSeenAtMs: Date.now() });
    await setActivity(user.id, b.nodeId, { score: 1, lastSeenAtMs: Date.now() });
    await setActivity(user.id, c.nodeId, { score: 1, lastSeenAtMs: Date.now() });

    const first = await storageService.getStorageSummary(user.id);
    const firstRows = first.suggestions.filter((row) => row.kind === 'near_dup');
    expect(firstRows).toHaveLength(2);
    const target = firstRows.find((row) => row.nodeId === Number(b.nodeId));
    expect(firstRows.every((row) => row.reason.keep_node_id === Number(a.nodeId))).toBe(true);
    expect(target.reason.keep.keep_node_id).toBeUndefined();
    const beforeQuality = target.reason.keep.factors.quality;

    // Quality input changes (keeper resolution improves) while the keeper stays `a`.
    await aiEnrichmentsStore.upsert(Number(a.nodeId), { probe: { width: 6000, height: 6000 } });
    const second = await storageService.getStorageSummary(user.id);
    const secondRows = second.suggestions.filter((row) => row.kind === 'near_dup');
    const refreshed = secondRows.find((row) => row.nodeId === Number(b.nodeId));

    expect(refreshed.id).toBe(target.id);
    expect(refreshed.createdAt).toBe(target.createdAt);
    expect(refreshed.expiresAt).toBe(target.expiresAt);
    expect(refreshed.reason.keep.keep_node_id).toBeUndefined();
    expect(refreshed.reason.keep.factors.quality).toBeGreaterThan(beforeQuality);
    expect(refreshed.reason.keep.relative_score).toBeGreaterThan(target.reason.keep.relative_score);
    const stored = (await storedRows(user.id)).find((row) => Number(row.id) === Number(target.id));
    expect(stored.state).toBe('pending');
  });

  it('does not backfill a legacy pending near-dup row whose keeper/score are unchanged', async () => {
    const { user, homeId } = await storageUser('legacy');
    await seedNearPair(homeId, 'legacy');

    const first = await storageService.getStorageSummary(user.id);
    const row = first.suggestions.find((r) => r.kind === 'near_dup');
    const legacyReason = {
      kind: 'near_dup',
      keep_node_id: row.reason.keep_node_id,
      score: row.reason.score,
    };
    await dbRun('UPDATE storage_suggestions SET reason = ? WHERE id = ?', [
      JSON.stringify(legacyReason),
      Number(row.id),
    ]);

    const second = await storageService.getStorageSummary(user.id);
    const again = second.suggestions.find((r) => r.id === row.id);
    expect(again.reason).toEqual(legacyReason);
    expect(again.reason.keep).toBeUndefined();
  });

  it('rule rows and exact dups carry NO keep block', async () => {
    const { user, homeId } = await storageUser('shapes');
    const hash = `shape-${Date.now()}`;
    await addFile(homeId, 'dupe-a.bin', { hash });
    await addFile(homeId, 'dupe-b.bin', { hash });
    await addFile(homeId, 'temp_scratch.bin', {});

    const summary = await storageService.getStorageSummary(user.id);
    const exact = summary.suggestions.filter((row) => row.kind === 'exact_dup');
    const rule = summary.suggestions.filter((row) => row.kind === 'temp_pattern');
    expect(exact.length).toBeGreaterThan(0);
    expect(rule.length).toBeGreaterThan(0);
    for (const row of [...exact, ...rule]) {
      expect(row.reason.keep).toBeUndefined();
    }
  });
});
