/**
 * evolutionService — trigger/debounce + reconcile pass contract
 * (docs/spec/server/services/evolutionService.md §2.2/§2.3/§2.4-bis).
 *
 * DB-backed: real collectionsStore/journal/embeddings fixtures; fake timers
 * only around trigger arming (timers are the unit under test).
 */
const evolutionService = require('../evolutionService');
const collectionsService = require('../service');
const collectionsStore = require('@server/store/collectionsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const lockManager = require('@server/infrastructure/lockManager');
const Settings = require('@server/models/Settings');
const usageStore = require('@server/store/usageStore');
const definitionEngine = require('@server/domains/collections/definitionEngine');
const { getSharedResolver } = require('@server/infrastructure/configResolver');
const composition = require('@server/service/composition');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
const { createTestDatabase, createAuthenticatedTestUser, dbQuery } = require('@server/test-utils');

let dbCleanup;
let fileNodeService;

const CONFIG_DEFAULTS = {
  AI_EVOLUTION_ENABLED: 'true',
  AI_EVOLUTION_TRIGGER: 'both',
  AI_EVOLUTION_DEBOUNCE_S: '90',
  AI_EVOLUTION_NIGHTLY_ENABLED: 'true',
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
  evolutionService.__resetEvolutionStateForTests();
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    // eslint-disable-next-line no-await-in-loop
    await setConfig(key, value);
  }
});

/**
 * Write a DB-only registry value and prime the shared resolver's sync cache
 * (production primes it via loadAll() at boot; tests must mirror that).
 */
async function setConfig(key, value) {
  await Settings.set(key, String(value));
  const resolver = getSharedResolver();
  resolver.invalidateCache(key);
  await resolver.getConfig(key);
  return resolver.getConfigSync(key);
}

async function createUserWithRoot(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `evo-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    vector,
    source: 'fulltext',
    contentHash: `evo-${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

async function createSystemCollection(ctx, { name, definition, publishMode } = {}) {
  return collectionsStore.createCollection(
    {
      ownerId: ctx.user.id,
      name: name || `System ${Math.random().toString(36).slice(2, 8)}`,
      origin: 'system',
      definition,
      ...(publishMode ? { publishMode } : {}),
    },
    { actor: ctx.user.id }
  );
}

async function storedItems(collectionId) {
  return collectionsStore.listStoredItems(collectionId);
}

async function journalCount(collectionId, action) {
  const result = await dbQuery(
    'SELECT COUNT(*) AS n FROM action_journal WHERE subject = ? AND action = ?',
    [`collection:${collectionId}`, action]
  );
  return Number(result.rows[0].n);
}

function withFakeTimers(fn) {
  jest.useFakeTimers();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      evolutionService.__resetEvolutionStateForTests();
      jest.useRealTimers();
    });
}

const DAY_OF_MS = 86400000;

describe('evolutionService triggers (§2.2)', () => {
  const pathDefinition = (username) => ({
    kind: 'predicate',
    any_of: [{ type: 'path', value: `/${username}/travel` }],
  });

  async function setupTravel(tag) {
    const ctx = await createUserWithRoot(tag);
    const folder = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const file = await fileNodeService.createFile(folder.id, 'dune.jpg');
    const collection = await createSystemCollection(ctx, {
      definition: pathDefinition(ctx.user.username),
    });
    return { ctx, folder, file, collection };
  }

  it('debounces upload commits: five arms 10s apart fire ONE cheap pass 90s after the last', async () => {
    const { ctx, file, collection } = await setupTravel('debounce');

    await withFakeTimers(async () => {
      expect(evolutionService.armUploadTrigger(ctx.user.id)).toBe(true);
      for (let i = 0; i < 4; i += 1) {
        await jest.advanceTimersByTimeAsync(10000);
        // re-arm coalesces into the existing queued pass
        expect(evolutionService.armUploadTrigger(ctx.user.id)).toBe(false);
      }

      await jest.advanceTimersByTimeAsync(89999);
      expect(await storedItems(collection.id)).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(1);
      const rows = await storedItems(collection.id);
      expect(rows.map((row) => row.nodeId)).toContain(file.id);
      expect(await journalCount(collection.id, 'add-items')).toBe(1);
    });
  });

  it('an immediate hint fires on the next tick and a second hint coalesces (202 scheduled:false)', async () => {
    const { ctx, file, collection } = await setupTravel('immediate');

    await withFakeTimers(async () => {
      expect(evolutionService.armUploadTrigger(ctx.user.id, { immediate: true })).toBe(true);
      expect(evolutionService.armUploadTrigger(ctx.user.id, { immediate: true })).toBe(false);

      await jest.advanceTimersByTimeAsync(0);
      expect((await storedItems(collection.id)).map((row) => row.nodeId)).toContain(file.id);
      expect(await journalCount(collection.id, 'add-items')).toBe(1);
    });
  });

  it('AI_EVOLUTION_TRIGGER=nightly ignores upload arms entirely', async () => {
    await setConfig('AI_EVOLUTION_TRIGGER', 'nightly');
    const { ctx, collection } = await setupTravel('nightly');

    await withFakeTimers(async () => {
      expect(evolutionService.armUploadTrigger(ctx.user.id)).toBe(false);
      expect(evolutionService.armUploadTrigger(ctx.user.id, { immediate: true })).toBe(false);
      await jest.advanceTimersByTimeAsync(DAY_OF_MS);
      expect(await storedItems(collection.id)).toHaveLength(0);
    });
  });

  it('AI_EVOLUTION_ENABLED=false disables arming and the pass (no acts)', async () => {
    await setConfig('AI_EVOLUTION_ENABLED', 'false');
    const { ctx, collection } = await setupTravel('disabled');

    await withFakeTimers(async () => {
      expect(evolutionService.armUploadTrigger(ctx.user.id)).toBe(false);
      expect(evolutionService.armUploadTrigger(ctx.user.id, { immediate: true })).toBe(false);
      const result = await evolutionService.runEvolutionPass({
        users: [ctx.user.id],
        passes: 'cheap',
      });
      expect(result).toEqual({ perUser: [], report: null, skipped: 'disabled' });
      await jest.advanceTimersByTimeAsync(DAY_OF_MS);
      expect(await storedItems(collection.id)).toHaveLength(0);
    });
  });

  it('AI_EVOLUTION_NIGHTLY_ENABLED=false pauses the full leg but leaves the cheap leg running', async () => {
    await setConfig('AI_EVOLUTION_NIGHTLY_ENABLED', 'false');
    const { ctx, file, collection } = await setupTravel('nightlypause');

    const full = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });
    expect(full).toEqual({ perUser: [], report: null, skipped: 'nightly_disabled' });
    expect(await storedItems(collection.id)).toHaveLength(0);

    const cheap = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'cheap',
    });
    expect(cheap.perUser[0].reconciled).toEqual({ added: 2, removed: 0, collections: 1 });
    expect((await storedItems(collection.id)).map((row) => row.nodeId)).toContain(file.id);
  });

  it('armUploadTriggerForNode resolves the node owner and arms that user', async () => {
    const { ctx, file, collection } = await setupTravel('bynode');

    await withFakeTimers(async () => {
      expect(await evolutionService.armUploadTriggerForNode(file.id)).toBe(true);
      await jest.advanceTimersByTimeAsync(90000);
      expect((await storedItems(collection.id)).map((row) => row.nodeId)).toContain(file.id);
      expect(ctx.user.id).toBeGreaterThan(0);
    });
  });
});

describe('evolutionService reconcile pass (§2.4-bis)', () => {
  it('materializes predicate admissions with source/reason/publish and removes stale non-manual rows without an exclusion', async () => {
    const ctx = await createUserWithRoot('reconcile-pred');
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const inside = await fileNodeService.createFile(travel.id, 'poster.png');
    const outside = await fileNodeService.createFile(ctx.root.id, 'notes.txt');
    const definition = {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    };

    const autoCol = await createSystemCollection(ctx, {
      name: 'Travel auto',
      definition,
      publishMode: 'auto',
    });
    const askCol = await createSystemCollection(ctx, {
      name: 'Travel ask',
      definition,
    });

    // stale rule-managed member that no longer matches the predicate
    await collectionsStore.addItems(
      askCol.id,
      [outside.id],
      ctx.user.id,
      { published: true, source: 'seed' },
      { actor: ctx.user.id }
    );
    // manual row on a system collection: never removed by reconcile
    await collectionsService.addItems(ctx.user.id, autoCol.id, [outside.id]);
    const manualRow = await collectionsStore.getStoredItem(autoCol.id, outside.id);
    expect(manualRow.source).toBe('manual');

    const askJournalBefore = await dbQuery(
      'SELECT MAX(id) AS maxId FROM action_journal WHERE subject = ?',
      [`collection:${askCol.id}`]
    );
    const lastSetupId = Number(askJournalBefore.rows[0].maxId) || 0;

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(result.perUser).toHaveLength(1);
    expect(result.perUser[0]).toMatchObject({
      userId: ctx.user.id,
      reconciled: { added: 4, removed: 1, collections: 2 },
    });

    const autoRows = await storedItems(autoCol.id);
    const autoInside = autoRows.find((row) => row.nodeId === inside.id);
    expect(autoInside).toMatchObject({
      source: 'system',
      reason: `path:/${ctx.user.username}/travel`,
      published: true,
      addedBy: ctx.user.id,
    });
    // manual outside row survives
    expect(autoRows.some((row) => row.nodeId === outside.id)).toBe(true);

    const askRows = await storedItems(askCol.id);
    expect(askRows.find((row) => row.nodeId === inside.id)).toMatchObject({
      source: 'system',
      reason: `path:/${ctx.user.username}/travel`,
      published: false,
    });
    expect(askRows.some((row) => row.nodeId === outside.id)).toBe(false);

    // automatic removal deleted the row ONLY — no exclusion, re-entry possible
    const exclusions = await dbQuery(
      'SELECT COUNT(*) AS n FROM collection_exclusions WHERE collection_id = ?',
      [askCol.id]
    );
    expect(Number(exclusions.rows[0].n)).toBe(0);

    // every reconcile act journaled actor='system'
    const journal = await dbQuery(
      'SELECT actor, action FROM action_journal WHERE subject = ? AND id > ? ORDER BY id',
      [`collection:${askCol.id}`, lastSetupId]
    );
    const mutationRows = journal.rows.filter(
      (row) => row.action === 'add-items' || row.action === 'remove-items'
    );
    expect(mutationRows.map((row) => row.action).sort()).toEqual(['add-items', 'remove-items']);
    expect(mutationRows.every((row) => row.actor === 'system')).toBe(true);

    // member-change stamp + idempotent second pass
    expect((await collectionsStore.getCollection(autoCol.id)).lastMemberChangeAt).not.toBeNull();
    const journalBefore = await journalCount(askCol.id, 'add-items');
    const second = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(second.perUser[0].reconciled).toEqual({ added: 0, removed: 0, collections: 0 });
    expect(await journalCount(askCol.id, 'add-items')).toBe(journalBefore);
  });

  it('reconciles pooled-vector membership with hysteresis: keeps missing-vector members, removes below theta, re-admits above theta_in', async () => {
    const ctx = await createUserWithRoot('reconcile-vec');
    const modelId = await ensureEmbedModel('reconcile-vec');
    const seed = await fileNodeService.createFile(ctx.root.id, 'seed.jpg');
    const near = await fileNodeService.createFile(ctx.root.id, 'near.jpg');
    const far = await fileNodeService.createFile(ctx.root.id, 'far.jpg');
    const missing = await fileNodeService.createFile(ctx.root.id, 'missing.jpg');
    const unembeddedNonMember = await fileNodeService.createFile(ctx.root.id, 'new.jpg');
    await embedNode(seed.id, modelId, [1, 0, 0, 0]);
    await embedNode(near.id, modelId, [0.99, 0.1, 0, 0]);
    await embedNode(far.id, modelId, [0, 1, 0, 0]);

    const collection = await createSystemCollection(ctx, {
      definition: { kind: 'seed_vector', seed_ref: seed.id, theta: 0.6 },
    });
    // pre-existing rule-managed members: far (below θ) and missing (no vector)
    await collectionsStore.addItems(
      collection.id,
      [far.id, missing.id],
      ctx.user.id,
      { published: true, source: 'seed' },
      { actor: ctx.user.id }
    );

    const first = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    // near clears theta_in; the seed itself scores 1.0 and is admitted (the
    // definition engine has no seed self-exclusion; only the preview samples
    // without it).
    expect(first.perUser[0].reconciled).toEqual({ added: 2, removed: 1, collections: 1 });

    const rows = await storedItems(collection.id);
    expect(rows.map((row) => row.nodeId).sort((a, b) => a - b)).toEqual(
      [seed.id, near.id, missing.id].sort((a, b) => a - b)
    );
    expect(rows.find((row) => row.nodeId === near.id)).toMatchObject({
      source: 'system',
      reason: 'similar',
      published: false,
    });
    expect(rows.find((row) => row.nodeId === seed.id)).toMatchObject({
      source: 'system',
      reason: 'similar',
    });

    // a non-member without a pooled vector is never admitted
    expect(rows.some((row) => row.nodeId === unembeddedNonMember.id)).toBe(false);

    // automatic removal inserted NO exclusion → re-entry above theta_in
    const exclusions = await dbQuery(
      'SELECT COUNT(*) AS n FROM collection_exclusions WHERE collection_id = ?',
      [collection.id]
    );
    expect(Number(exclusions.rows[0].n)).toBe(0);

    await embedNode(far.id, modelId, [1, 0, 0, 0]);
    const second = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(second.perUser[0].reconciled).toEqual({ added: 1, removed: 0, collections: 1 });
    expect((await storedItems(collection.id)).some((row) => row.nodeId === far.id)).toBe(true);

    const third = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(third.perUser[0].reconciled).toEqual({ added: 0, removed: 0, collections: 0 });
  });

  it('drives the membership band from the active EG2 profile: band keeps members and rejects non-members, predicates stay boolean', async () => {
    const ctx = await createUserWithRoot('reconcile-band');
    const modelId = await ensureEmbedModel('reconcile-band');
    const seed = await fileNodeService.createFile(ctx.root.id, 'band-seed.jpg');
    const bandMember = await fileNodeService.createFile(ctx.root.id, 'band-member.jpg');
    const bandNonMember = await fileNodeService.createFile(ctx.root.id, 'band-new.jpg');
    const above = await fileNodeService.createFile(ctx.root.id, 'band-above.jpg');
    const below = await fileNodeService.createFile(ctx.root.id, 'band-below.jpg');
    await embedNode(seed.id, modelId, [1, 0, 0, 0]);
    // cos 0.6 sits inside the shipped band (θ 0.6 ⇒ θ_in 0.62, θ_out 0.58)
    await embedNode(bandMember.id, modelId, [3, 4, 0, 0]);
    await embedNode(bandNonMember.id, modelId, [3, 4, 0, 0]);
    // cos 0.8 — above θ_in
    await embedNode(above.id, modelId, [4, 3, 0, 0]);
    // cos 0 — below θ_out
    await embedNode(below.id, modelId, [0, 1, 0, 0]);

    const collection = await createSystemCollection(ctx, {
      definition: { kind: 'seed_vector', seed_ref: seed.id, theta: 0.6 },
    });
    // pre-existing rule-managed members: bandMember (in band) and below (under θ_out)
    await collectionsStore.addItems(
      collection.id,
      [bandMember.id, below.id],
      ctx.user.id,
      { published: true, source: 'seed' },
      { actor: ctx.user.id }
    );

    const flat = await fileNodeService.createDirectory(ctx.root.id, 'flat');
    const flatFile = await fileNodeService.createFile(flat.id, 'plain.txt');
    const predicateCol = await createSystemCollection(ctx, {
      definition: {
        kind: 'predicate',
        any_of: [{ type: 'path', value: `/${ctx.user.username}/flat` }],
      },
    });

    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });

    const ids = (await storedItems(collection.id)).map((row) => row.nodeId);
    // existing member inside the band survives
    expect(ids).toContain(bandMember.id);
    // the same score never admits a non-member
    expect(ids).not.toContain(bandNonMember.id);
    // existing member below θ_out is removed
    expect(ids).not.toContain(below.id);
    // non-member above θ_in is admitted
    expect(ids).toContain(above.id);
    expect(ids).toContain(seed.id);

    // predicate atoms are boolean: no pooled vector, no band — the path match admits
    const predicateIds = (await storedItems(predicateCol.id)).map((row) => row.nodeId);
    expect(predicateIds).toContain(flat.id);
    expect(predicateIds).toContain(flatFile.id);
  });

  it('subtracts collection exclusions before the diff and leaves manual collections untouched', async () => {
    const ctx = await createUserWithRoot('reconcile-excl');
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const inside = await fileNodeService.createFile(travel.id, 'skip.png');
    const definition = {
      kind: 'predicate',
      any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
    };

    const collection = await createSystemCollection(ctx, { definition });
    await collectionsStore.addExclusion(collection.id, inside.id, { actor: ctx.user.id });

    // manual collection (no definition): skipped by construction
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Manual' });
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [inside.id]);

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    // the prefix directory itself matches the path atom; the excluded file does not
    expect(result.perUser[0].reconciled).toEqual({ added: 1, removed: 0, collections: 1 });
    expect((await storedItems(collection.id)).map((row) => row.nodeId)).toEqual([travel.id]);
    expect(await storedItems(manual.collection.id)).toHaveLength(1);
  });

  it('skips {kind:search} snapshot definitions', async () => {
    const ctx = await createUserWithRoot('reconcile-search');
    const node = await fileNodeService.createFile(ctx.root.id, 'saved.png');
    const search = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Saved search',
        origin: 'search',
        definition: { kind: 'search', result_ref: 'sr1.abc0123456789ef', predicates: [] },
      },
      { actor: ctx.user.id }
    );
    await collectionsStore.addItems(
      search.id,
      [node.id],
      ctx.user.id,
      { published: true, source: 'search' },
      { actor: ctx.user.id }
    );

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(result.perUser[0].reconciled).toEqual({ added: 0, removed: 0, collections: 0 });
    expect(await storedItems(search.id)).toHaveLength(1);
  });

  it('a concurrent pass for the same user no-ops on the per-user lock', async () => {
    const ctx = await createUserWithRoot('reconcile-lock');
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    const file = await fileNodeService.createFile(travel.id, 'locked.png');
    const collection = await createSystemCollection(ctx, {
      definition: {
        kind: 'predicate',
        any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
      },
    });

    const held = await lockManager.acquireLock(`evolution:user:${ctx.user.id}`, {
      ttlMs: 30000,
      waitMs: 0,
    });
    try {
      const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
      expect(result.perUser[0]).toEqual({ userId: ctx.user.id, skipped: 'locked' });
      expect(await storedItems(collection.id)).toHaveLength(0);
    } finally {
      await held.release();
    }

    const after = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(after.perUser[0].reconciled).toEqual({ added: 2, removed: 0, collections: 1 });
    expect((await storedItems(collection.id)).map((row) => row.nodeId)).toContain(file.id);
  });

  it('defaults to all non-admin users and writes one night_eval report with the per-user summary', async () => {
    const admin = await createAuthenticatedTestUser({
      username: `evo-admin-${Date.now()}`,
      isAdmin: true,
    });
    const ctx = await createUserWithRoot('reconcile-report');
    const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
    await fileNodeService.createFile(travel.id, 'report.png');
    await createSystemCollection(ctx, {
      definition: {
        kind: 'predicate',
        any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
      },
    });

    await evolutionService.runEvolutionPass({ passes: 'full' });

    const report = await dbQuery(
      "SELECT status, payload FROM admin_reports WHERE kind = 'night_eval' ORDER BY id DESC LIMIT 1"
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].status).toBe('ok');
    const payload = JSON.parse(report.rows[0].payload);
    expect(payload.passes).toBe('full');
    const userIds = payload.perUser.map((entry) => entry.userId);
    expect(userIds).toContain(ctx.user.id);
    expect(userIds).not.toContain(admin.user.id);
    const entry = payload.perUser.find((row) => row.userId === ctx.user.id);
    expect(entry.reconciled).toEqual({ added: 2, removed: 0, collections: 1 });
    expect(payload.totals).toMatchObject({
      added: expect.any(Number),
      removed: expect.any(Number),
      collections: expect.any(Number),
    });
  });
});

describe('evolutionService merge candidates (§2.8)', () => {
  async function addMembers(collectionId, nodeIds, ownerId) {
    await collectionsStore.addItems(
      collectionId,
      nodeIds,
      ownerId,
      { published: true, source: 'system' },
      { actor: ownerId }
    );
  }

  async function setupPair(tag) {
    const ctx = await createUserWithRoot(tag);
    const folder = await fileNodeService.createDirectory(ctx.root.id, 'merge-sets');
    const files = [];
    for (let i = 0; i < 6; i += 1) {
      files.push(await fileNodeService.createFile(folder.id, `m${i}.jpg`));
    }
    return { ctx, files };
  }

  it('suggests near-identical materialized sets; subset pairs never qualify', async () => {
    const { ctx, files } = await setupPair('geom');
    const a = await createSystemCollection(ctx, { name: 'Europe' });
    const b = await createSystemCollection(ctx, { name: '2026 trip' });
    const subset = await createSystemCollection(ctx, { name: 'Spain' });

    await addMembers(
      a.id,
      files.slice(0, 4).map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      b.id,
      files.slice(0, 4).map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      subset.id,
      files.slice(0, 2).map((f) => f.id),
      ctx.user.id
    );

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(result.perUser[0].mergeCandidates).toMatchObject({ suggested: 1, reopened: 0 });

    const pending = await collectionsStore.listMergeSuggestions([a.id, b.id, subset.id]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      aId: Math.min(a.id, b.id),
      bId: Math.max(a.id, b.id),
      state: 'pending',
      score: 1000,
      arbiterVerdict: null,
      arbiterReason: null,
    });

    // idempotent re-run: upsert preserves the single pending row
    const second = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(second.perUser[0].mergeCandidates.suggested).toBe(1);
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id, subset.id])).toHaveLength(1);
  });

  it('requires at least one system side and both collections active', async () => {
    const { ctx, files } = await setupPair('scope');
    const manualA = await collectionsService.createCollection(ctx.user.id, { name: 'Manual A' });
    const manualB = await collectionsService.createCollection(ctx.user.id, { name: 'Manual B' });
    await addMembers(
      manualA.collection.id,
      files.slice(0, 3).map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      manualB.collection.id,
      files.slice(0, 3).map((f) => f.id),
      ctx.user.id
    );

    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(
      await collectionsStore.listMergeSuggestions([manualA.collection.id, manualB.collection.id])
    ).toHaveLength(0);

    const system = await createSystemCollection(ctx, { name: 'System side' });
    await addMembers(
      system.id,
      files.slice(0, 3).map((f) => f.id),
      ctx.user.id
    );
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const systemPair = await collectionsStore.listMergeSuggestions([
      manualA.collection.id,
      system.id,
    ]);
    expect(
      systemPair.filter(
        (row) =>
          row.aId === Math.min(manualA.collection.id, system.id) &&
          row.bId === Math.max(manualA.collection.id, system.id)
      )
    ).toHaveLength(1);

    // archived side: no new pair is written
    await collectionsStore.archiveCollection(system.id, { actor: ctx.user.id });
    const afterArchive = await createSystemCollection(ctx, { name: 'New system side' });
    await addMembers(
      afterArchive.id,
      files.slice(0, 3).map((f) => f.id),
      ctx.user.id
    );
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const archivePair = await collectionsStore.listMergeSuggestions([
      manualA.collection.id,
      afterArchive.id,
    ]);
    expect(
      archivePair.filter(
        (row) =>
          row.aId === Math.min(manualA.collection.id, afterArchive.id) &&
          row.bId === Math.max(manualA.collection.id, afterArchive.id)
      )
    ).toHaveLength(1);
  });

  it('rejected pairs are terminal across passes', async () => {
    const { ctx, files } = await setupPair('reject');
    const a = await createSystemCollection(ctx, { name: 'Reject A' });
    const b = await createSystemCollection(ctx, { name: 'Reject B' });
    await addMembers(a.id, [files[0].id, files[1].id], ctx.user.id);
    await addMembers(b.id, [files[0].id, files[1].id], ctx.user.id);

    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const pairScope = [a.id, b.id];
    const [suggestion] = await collectionsStore.listMergeSuggestions(pairScope);
    await collectionsStore.setSuggestionState(suggestion.id, 'rejected');

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(result.perUser[0].mergeCandidates.suggested).toBe(0);
    expect(await collectionsStore.listMergeSuggestions(pairScope)).toHaveLength(0);
    const rejected = await collectionsStore.listMergeSuggestions(pairScope, {
      state: 'rejected',
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].id).toBe(suggestion.id);
  });

  it('re-raises dismissed pairs at +14d, then at +30d, preserving dismiss_count', async () => {
    const { ctx, files } = await setupPair('cadence');
    const a = await createSystemCollection(ctx, { name: 'Cadence A' });
    const b = await createSystemCollection(ctx, { name: 'Cadence B' });
    await addMembers(a.id, [files[0].id, files[1].id], ctx.user.id);
    await addMembers(b.id, [files[0].id, files[1].id], ctx.user.id);

    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const pairScope = [a.id, b.id];
    const [suggestion] = await collectionsStore.listMergeSuggestions(pairScope);
    await collectionsStore.setSuggestionState(suggestion.id, 'dismissed');

    // not due yet
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(await collectionsStore.listMergeSuggestions(pairScope)).toHaveLength(0);

    // first dismiss: due after 14 days
    await dbQuery(
      "UPDATE collection_merge_suggestions SET dismissed_at = datetime('now', '-15 days') WHERE id = ?",
      [suggestion.id]
    );
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const [reopened] = await collectionsStore.listMergeSuggestions(pairScope);
    expect(reopened.id).toBe(suggestion.id);
    expect(reopened.dismissCount).toBe(1);

    // second dismiss: 20 days is still inside the 30-day sleep
    await collectionsStore.setSuggestionState(suggestion.id, 'dismissed');
    await dbQuery(
      "UPDATE collection_merge_suggestions SET dismissed_at = datetime('now', '-20 days') WHERE id = ?",
      [suggestion.id]
    );
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    expect(await collectionsStore.listMergeSuggestions(pairScope)).toHaveLength(0);

    // past 30 days it re-raises with the count preserved
    await dbQuery(
      "UPDATE collection_merge_suggestions SET dismissed_at = datetime('now', '-31 days') WHERE id = ?",
      [suggestion.id]
    );
    await evolutionService.runEvolutionPass({ users: [ctx.user.id] });
    const [again] = await collectionsStore.listMergeSuggestions(pairScope);
    expect(again.id).toBe(suggestion.id);
    expect(again.dismissCount).toBe(2);
  });
});

describe('evolutionService auto-pin reconcile (§2.9 pass 6)', () => {
  it('clears illegal auto pins on non-system rows, keeps system auto pins and user pins', async () => {
    const ctx = await createUserWithRoot('autopin');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Manual pin' });
    const system = await createSystemCollection(ctx, { name: 'System pin' });
    const userPinned = await collectionsService.createCollection(ctx.user.id, {
      name: 'User pin',
    });

    await dbQuery("UPDATE collections SET pinned = 1, pinned_by = 'auto' WHERE id = ?", [
      manual.collection.id,
    ]);
    await dbQuery("UPDATE collections SET pinned = 1, pinned_by = 'auto' WHERE id = ?", [
      system.id,
    ]);
    await dbQuery("UPDATE collections SET pinned = 1, pinned_by = 'user' WHERE id = ?", [
      userPinned.collection.id,
    ]);

    // cheap leg does not run pass 6
    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'cheap' });
    expect((await collectionsStore.getCollection(manual.collection.id)).pinnedBy).toBe('auto');

    const result = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });
    expect(result.perUser[0].pinned).toEqual({ cleared: 1 });

    const cleared = await collectionsStore.getCollection(manual.collection.id);
    expect(cleared).toMatchObject({ pinned: false, pinnedBy: null });
    expect((await collectionsStore.getCollection(system.id)).pinnedBy).toBe('auto');
    expect((await collectionsStore.getCollection(userPinned.collection.id)).pinnedBy).toBe('user');

    // idempotent
    const again = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });
    expect(again.perUser[0].pinned).toEqual({ cleared: 0 });
  });

  it('system rows with a lost pin flag are also reconciled', async () => {
    const ctx = await createUserWithRoot('autopin-lost');
    const system = await createSystemCollection(ctx, { name: 'Lost pin' });
    await dbQuery("UPDATE collections SET pinned = 0, pinned_by = 'auto' WHERE id = ?", [
      system.id,
    ]);

    const result = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });
    expect(result.perUser[0].pinned).toEqual({ cleared: 1 });
    expect((await collectionsStore.getCollection(system.id)).pinnedBy).toBeNull();
  });
});

describe('evolutionService archive + purge (§2.6/§2.7)', () => {
  async function addMember(ctx, collectionId, nodeId) {
    await collectionsStore.addItem(collectionId, nodeId, ctx.user.id, {
      source: 'manual',
      published: true,
    });
  }

  async function setNodeActivity(ctx, nodeId, { score, lastSeenAtMs, updatedAtMs }) {
    await usageStore.upsertNodeActivity([
      {
        userId: ctx.user.id,
        nodeId,
        counts: { open: 0, download: 0, preview: 0, search_hit: 0, like: 0 },
        lastSeenAtMs,
        score,
        updatedAtMs,
      },
    ]);
  }

  async function ageCollection(collectionId, { daysAgoCreated, daysAgoArchived } = {}) {
    if (daysAgoCreated !== undefined) {
      const created = new Date(Date.now() - daysAgoCreated * DAY_OF_MS).toISOString();
      await dbQuery('UPDATE collections SET created_at = ? WHERE id = ?', [created, collectionId]);
    }
    if (daysAgoArchived !== undefined) {
      const archived = new Date(Date.now() - daysAgoArchived * DAY_OF_MS).toISOString();
      await dbQuery('UPDATE collections SET archived_at = ? WHERE id = ?', [
        archived,
        collectionId,
      ]);
    }
  }

  it('archives an inactive system row (no positive member activity inside the window)', async () => {
    const ctx = await createUserWithRoot('archive-inactive');
    const file = await fileNodeService.createFile(ctx.root.id, 'old.png');
    const collection = await createSystemCollection(ctx, { name: 'Inactive' });
    await addMember(ctx, collection.id, file.id);
    await ageCollection(collection.id, { daysAgoCreated: 30 });
    await setNodeActivity(ctx, file.id, {
      score: 2,
      lastSeenAtMs: Date.now() - 40 * DAY_OF_MS,
      updatedAtMs: Date.now() - 40 * DAY_OF_MS,
    });

    const result = await evolutionService.runArchivePass(ctx.user.id);
    expect(result).toEqual({ archived: 1 });
    expect((await collectionsStore.getCollection(collection.id)).status).toBe('archived');
    expect(await journalCount(collection.id, 'archive')).toBe(1);
    // idempotent re-run
    expect(await evolutionService.runArchivePass(ctx.user.id)).toEqual({ archived: 0 });
  });

  it('keeps a row with positive member activity inside the window', async () => {
    const ctx = await createUserWithRoot('archive-active');
    const file = await fileNodeService.createFile(ctx.root.id, 'hot.png');
    const collection = await createSystemCollection(ctx, { name: 'Active' });
    await addMember(ctx, collection.id, file.id);
    await ageCollection(collection.id, { daysAgoCreated: 30 });
    await setNodeActivity(ctx, file.id, {
      score: 5,
      lastSeenAtMs: Date.now() - 5 * DAY_OF_MS,
      updatedAtMs: Date.now() - 5 * DAY_OF_MS,
    });

    expect(await evolutionService.runArchivePass(ctx.user.id)).toEqual({ archived: 0 });
    expect((await collectionsStore.getCollection(collection.id)).status).toBe('active');
  });

  it('archives an empty-member row and skips pinned rows (user or auto)', async () => {
    const ctx = await createUserWithRoot('archive-empty');
    const empty = await createSystemCollection(ctx, { name: 'Empty' });
    await ageCollection(empty.id, { daysAgoCreated: 30 });

    const pinnedUser = await createSystemCollection(ctx, { name: 'Pinned user' });
    await ageCollection(pinnedUser.id, { daysAgoCreated: 30 });
    await collectionsStore.setPinned(pinnedUser.id, true, { actor: 'system' });

    const pinnedAuto = await createSystemCollection(ctx, { name: 'Pinned auto' });
    await ageCollection(pinnedAuto.id, { daysAgoCreated: 30 });
    await dbQuery("UPDATE collections SET pinned = 1, pinned_by = 'auto' WHERE id = ?", [
      pinnedAuto.id,
    ]);

    const result = await evolutionService.runArchivePass(ctx.user.id);
    expect(result).toEqual({ archived: 1 });
    expect((await collectionsStore.getCollection(empty.id)).status).toBe('archived');
    expect((await collectionsStore.getCollection(pinnedUser.id)).status).toBe('active');
    expect((await collectionsStore.getCollection(pinnedAuto.id)).status).toBe('active');
  });

  it('honors the min-age grace and applies the gate uniformly across tiers', async () => {
    await setConfig('AI_EVOLUTION_MIN_AGE_DAYS', '14');
    const ctx = await createUserWithRoot('archive-age');
    const young = await createSystemCollection(ctx, {
      name: 'Young loose',
      definition: {
        kind: 'centroid',
        centroid_ref: null,
        theta: 0.72,
        tier: 'loose',
        event_class: 'root',
      },
    });
    const oldTight = await createSystemCollection(ctx, {
      name: 'Old tight',
      definition: {
        kind: 'centroid',
        centroid_ref: null,
        theta: 0.82,
        tier: 'tight',
        event_class: 'root',
      },
    });
    await ageCollection(young.id, { daysAgoCreated: 5 });
    await ageCollection(oldTight.id, { daysAgoCreated: 20 });

    expect(await evolutionService.runArchivePass(ctx.user.id)).toEqual({ archived: 1 });
    expect((await collectionsStore.getCollection(young.id)).status).toBe('active');
    expect((await collectionsStore.getCollection(oldTight.id)).status).toBe('archived');
  });

  it('never archives user/seed/search rows', async () => {
    const ctx = await createUserWithRoot('archive-origins');
    const userRow = await collectionsService.createCollection(ctx.user.id, { name: 'Manual' });
    await ageCollection(userRow.collection.id, { daysAgoCreated: 30 });
    for (const origin of ['seed', 'search']) {
      await dbQuery(
        "INSERT INTO collections (owner_id, name, origin, publish_mode, created_at, updated_at) VALUES (?, ?, ?, 'ask', ?, ?)",
        [
          ctx.user.id,
          `Non ${origin}`,
          origin,
          new Date(Date.now() - 30 * DAY_OF_MS).toISOString(),
          new Date().toISOString(),
        ]
      );
    }
    expect(await evolutionService.runArchivePass(ctx.user.id)).toEqual({ archived: 0 });
    const rows = await dbQuery(
      "SELECT status FROM collections WHERE owner_id = ? AND origin IN ('user','seed','search')",
      [ctx.user.id]
    );
    for (const row of rows.rows) expect(row.status).toBe('active');
  });

  it('purges archived system rows past retention with tombstone + journal purge; never user/seed/search', async () => {
    await setConfig('ARCHIVE_RETENTION_DAYS', '30');
    const ctx = await createUserWithRoot('purge');
    const definition = { kind: 'predicate', any_of: [{ type: 'path', value: '/gone' }] };
    const stale = await createSystemCollection(ctx, { name: 'Stale', definition });
    const fresh = await createSystemCollection(ctx, { name: 'Fresh', definition });
    const userRow = await collectionsService.createCollection(ctx.user.id, { name: 'Manual' });
    await collectionsStore.archiveCollection(stale.id, { actor: 'system' });
    await collectionsStore.archiveCollection(fresh.id, { actor: 'system' });
    await collectionsStore.archiveCollection(userRow.collection.id, { actor: ctx.user.id });
    await ageCollection(stale.id, { daysAgoArchived: 40 });
    await ageCollection(fresh.id, { daysAgoArchived: 5 });
    await ageCollection(userRow.collection.id, { daysAgoArchived: 40 });
    expect(await journalCount(stale.id, 'archive')).toBeGreaterThan(0);

    const fingerprint = definitionEngine.fingerprintDefinition(definition);
    expect(await collectionsStore.isTombstoned(ctx.user.id, fingerprint)).toBe(false);

    expect(await evolutionService.runPurgePass(ctx.user.id)).toEqual({ purged: 1 });
    expect(await collectionsStore.getCollection(stale.id)).toBeNull();
    expect((await collectionsStore.getCollection(fresh.id)).status).toBe('archived');
    expect((await collectionsStore.getCollection(userRow.collection.id)).status).toBe('archived');
    expect(await collectionsStore.isTombstoned(ctx.user.id, fingerprint)).toBe(true);
    expect(await journalCount(stale.id, 'archive')).toBe(0);
    // idempotent
    expect(await evolutionService.runPurgePass(ctx.user.id)).toEqual({ purged: 0 });
  });

  it('full leg runs archive + purge and reports the counts; cheap leg never acts', async () => {
    const ctx = await createUserWithRoot('archive-dispatch');
    const stale = await createSystemCollection(ctx, { name: 'Stale full' });
    await ageCollection(stale.id, { daysAgoCreated: 30 });
    await collectionsStore.archiveCollection(stale.id, { actor: 'system' });
    await ageCollection(stale.id, { daysAgoArchived: 40 });

    const cheap = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'cheap',
    });
    expect(cheap.perUser[0].archived).toBeNull();
    expect(cheap.perUser[0].purged).toBeNull();
    expect(await collectionsStore.getCollection(stale.id)).not.toBeNull();

    const full = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });
    expect(full.perUser[0].archived).toEqual({ archived: 0 });
    expect(full.perUser[0].purged).toEqual({ purged: 1 });
    expect(full.report.totals.purged).toBe(1);
    expect(await collectionsStore.getCollection(stale.id)).toBeNull();
  });
});
