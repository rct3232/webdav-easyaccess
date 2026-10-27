/**
 * evolutionService — Pass 5 merge-arbiter leg
 * (docs/spec/server/services/evolutionService.md §2.8; owner ruling R1 per
 * AI_FEATURE_PLAN §12.15; PLAN §30.3 row T3.1c).
 *
 * R1 pins: the card gate stays Jaccard ≥ 0.7 in the LLM-free default — 0.55–0.7
 * band pairs become cards ONLY via an arbiter verdict. Fake chat rides the
 * adapter seam (R3 — jest.mock of llmAdapterRuntime, same idiom as the parse.nl
 * suite); no provider, no E2E. Chat-off paths stay byte-identical.
 */
jest.mock('../../../infrastructure/llmAdapterRuntime', () => {
  const state = {
    configured: false,
    reply: null,
    error: null,
    calls: [],
  };
  const adapter = {
    roleConfigured: async (role) => state.configured && role === 'chat',
    chat: async (messages, opts) => {
      state.calls.push({ messages, opts });
      if (state.error) throw state.error;
      return { json: state.reply };
    },
  };
  return {
    initLlmAdapter: jest.fn(),
    resetLlmAdapter: jest.fn(),
    getLlmAdapter: () => adapter,
    __arbiterMock: state,
    __resetArbiterMock: () => {
      state.configured = false;
      state.reply = null;
      state.error = null;
      state.calls.length = 0;
    },
  };
});

const evolutionService = require('../evolutionService');
const collectionsService = require('../service');
const mergeArbiterRuntime = require('../../../infrastructure/llmAdapterRuntime');
const collectionsStore = require('@server/store/collectionsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const Settings = require('@server/models/Settings');
const { getSharedResolver } = require('@server/infrastructure/configResolver');
const { getEntry, getDefault } = require('@server/infrastructure/configRegistry');
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
  AI_EVOLUTION_NIGHTLY_ENABLED: 'true',
  AI_MERGE_SUGGESTIONS_ENABLED: 'true',
  AI_MERGE_ARBITER_ENABLED: 'true',
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
  mergeArbiterRuntime.__resetArbiterMock();
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
  const { user } = await createAuthenticatedTestUser({
    username: `arb-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, root };
}

async function createSystemCollection(userId, name) {
  return collectionsStore.createCollection(
    { ownerId: userId, name, origin: 'system' },
    { actor: userId }
  );
}

async function addMembers(collectionId, nodeIds, ownerId) {
  await collectionsStore.addItems(
    collectionId,
    nodeIds,
    ownerId,
    { published: true, source: 'system' },
    { actor: ownerId }
  );
}

async function makeFiles(rootId, folderName, count) {
  const folder = await fileNodeService.createDirectory(rootId, folderName);
  const files = [];
  for (let i = 0; i < count; i += 1) {
    files.push(await fileNodeService.createFile(folder.id, `f${i}.jpg`));
  }
  return files;
}

async function pairRow(a, b) {
  const rows = await collectionsStore.listMergeSuggestions([a.id, b.id], { state: 'pending' });
  return rows.find(
    (row) =>
      row.aId === Math.min(a.id, b.id) && row.bId === Math.max(a.id, b.id)
  );
}

/**
 * Band fixture: A = m0..m4, B = m0..m3 + m5 → intersection 4, union 6,
 * jaccard 0.667 (inside 0.55–0.7), sizeRatio 1.0. The unique members carry
 * distinctive summaries so the symmetric-difference pin is observable in the
 * captured prompt.
 */
async function setupBandPair(tag) {
  const ctx = await createUserWithRoot(tag);
  const files = await makeFiles(ctx.root.id, `band-${tag}`, 6);
  const a = await createSystemCollection(ctx.user.id, `Europe ${tag}`);
  const b = await createSystemCollection(ctx.user.id, `2026 trip ${tag}`);
  await addMembers(
    a.id,
    [files[0], files[1], files[2], files[3], files[4]].map((f) => f.id),
    ctx.user.id
  );
  await addMembers(
    b.id,
    [files[0], files[1], files[2], files[3], files[5]].map((f) => f.id),
    ctx.user.id
  );
  await aiEnrichmentsStore.upsert(Number(files[0].id), { summary: 'shared plaza photo' });
  await aiEnrichmentsStore.upsert(Number(files[4].id), {
    summary: 'A-ONLY Madrid flea market shot',
  });
  await aiEnrichmentsStore.upsert(Number(files[5].id), {
    summary: 'B-ONLY Tokyo street shot',
  });
  return { ctx, files, a, b };
}

describe('config registry — AI_MERGE_ARBITER_ENABLED (T2 dbOnly)', () => {
  it('registers the arbiter kill switch with the shipped default', () => {
    const entry = getEntry('AI_MERGE_ARBITER_ENABLED');
    expect(entry).toBeDefined();
    expect(entry.dbOnly).toBe(true);
    expect(entry.secret).toBe(false);
    expect(getDefault('AI_MERGE_ARBITER_ENABLED')).toBe(true);
  });
});

describe('evolutionService merge-arbiter (§2.8, owner ruling R1)', () => {
  it('R1 pin — chat unconfigured: band pairs write NO rows and issue ZERO calls', async () => {
    const { ctx, a, b } = await setupBandPair('off');
    mergeArbiterRuntime.__arbiterMock.configured = false;

    const result = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });

    expect(mergeArbiterRuntime.__arbiterMock.calls).toHaveLength(0);
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
    expect(result.perUser[0].arbiterCalls).toBe(0);
    expect(result.perUser[0].mergeCandidates).toMatchObject({
      suggested: 0,
      arbiterCalls: 0,
      arbiterSuggested: 0,
    });
    expect(result.report.totals).toMatchObject({ arbiter_calls: 0, arbiter_suggested: 0 });
  });

  it('promotes a band pair on a merge verdict — persisted prefill + symmetric-difference prompt', async () => {
    const { ctx, files, a, b } = await setupBandPair('merge');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = {
      decisions: [{ pair_id: 0, verdict: 'merge', reason: 'same theme, twice' }],
    };

    const result = await evolutionService.runEvolutionPass({
      users: [ctx.user.id],
      passes: 'full',
    });

    expect(mock.calls).toHaveLength(1);
    const prompt = JSON.stringify(mock.calls[0].messages);
    // Load-bearing: BOTH sides' unique samples + counts reach the prompt.
    expect(prompt).toContain('A-ONLY Madrid flea market shot');
    expect(prompt).toContain('B-ONLY Tokyo street shot');
    const payload = JSON.parse(mock.calls[0].messages[1].content);
    expect(payload.pairs[0].a.unique_count).toBe(1);
    expect(payload.pairs[0].b.unique_count).toBe(1);

    const row = await pairRow(a, b);
    expect(row).toMatchObject({
      state: 'pending',
      score: 667,
      arbiterVerdict: 'merge',
      arbiterReason: 'same theme, twice',
    });
    expect(result.perUser[0].arbiterCalls).toBe(1);
    expect(result.perUser[0].mergeCandidates).toMatchObject({ arbiterSuggested: 1 });
    expect(result.report.totals).toMatchObject({ arbiter_calls: 1, arbiter_suggested: 1 });

    // The service read renders the recommendation prefill (advisory wire shape).
    const listed = await collectionsService.listMergeSuggestions(ctx.user.id);
    const suggestion = listed.suggestions.find(
      (s) => s.a_id === Math.min(a.id, b.id) && s.b_id === Math.max(a.id, b.id)
    );
    expect(suggestion.recommendation).toEqual({ verdict: 'merge', reason: 'same theme, twice' });
    expect(suggestion.a_unique_sample.map((s) => s.node_id)).toContain(Number(files[4].id));
    expect(suggestion.b_unique_sample.map((s) => s.node_id)).toContain(Number(files[5].id));

    // Advise only — nothing merged itself: both collections stay active and intact.
    expect(await collectionsStore.getCollection(a.id)).not.toBeNull();
    expect(await collectionsStore.getCollection(b.id)).not.toBeNull();
    expect((await collectionsStore.listStoredItems(a.id)).map((r) => Number(r.nodeId))).toEqual(
      [files[0], files[1], files[2], files[3], files[4]].map((f) => Number(f.id)).sort((x, y) => x - y)
    );
  });

  it('keep_separate verdict promotes the card with that recommendation', async () => {
    const { ctx, a, b } = await setupBandPair('keep');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = {
      decisions: [{ pair_id: 0, verdict: 'keep_separate', reason: 'different continents' }],
    };

    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    const row = await pairRow(a, b);
    expect(row).toMatchObject({ state: 'pending', arbiterVerdict: 'keep_separate' });
  });

  it('sibling verdict writes NO row (suppression rule) — the call is still counted', async () => {
    const { ctx, a, b } = await setupBandPair('sib');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = {
      decisions: [{ pair_id: 0, verdict: 'sibling', reason: 'theme + sibling theme' }],
    };

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(1);
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
    expect(result.perUser[0].arbiterCalls).toBe(1);
    expect(result.perUser[0].mergeCandidates.arbiterSuggested).toBe(0);
  });

  it('off-contract verdict strings never promote a row (closed vocabulary)', async () => {
    const { ctx, a, b } = await setupBandPair('vocab');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'probably_merge', reason: 'hallucinated' }] };

    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
  });

  it('AI_MERGE_ARBITER_ENABLED:false pauses adjudication even with chat configured', async () => {
    const { ctx, a, b } = await setupBandPair('kill');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    await setConfig('AI_MERGE_ARBITER_ENABLED', 'false');

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(0);
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
    expect(result.perUser[0].arbiterCalls).toBe(0);
  });

  it('budget pin — the arbiter runs on the FULL (nightly) leg only; cheap passes never call chat', async () => {
    const { ctx, a, b } = await setupBandPair('cheap');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'merge', reason: 'should not fire' }] };

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id] });

    expect(mock.calls).toHaveLength(0);
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
    expect(result.perUser[0].arbiterCalls).toBe(0);
  });

  it('≥0.7 pairs stay cards WITHOUT adjudication even when chat is configured', async () => {
    const ctx = await createUserWithRoot('above');
    const files = await makeFiles(ctx.root.id, 'above-band', 4);
    const a = await createSystemCollection(ctx.user.id, 'Twin A');
    const b = await createSystemCollection(ctx.user.id, 'Twin B');
    await addMembers(
      a.id,
      files.map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      b.id,
      files.map((f) => f.id),
      ctx.user.id
    );
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'sibling', reason: 'nope' }] };

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(0);
    const row = await pairRow(a, b);
    expect(row).toMatchObject({ state: 'pending', score: 1000, arbiterVerdict: null });
    expect(result.perUser[0].arbiterCalls).toBe(0);
  });

  it('one batched multi-pair call promotes several band rows in a single pass', async () => {
    const ctx = await createUserWithRoot('batch');
    const first = await makeFiles(ctx.root.id, 'batch-one', 6);
    const second = await makeFiles(ctx.root.id, 'batch-two', 8);
    const a = await createSystemCollection(ctx.user.id, 'P1 A');
    const b = await createSystemCollection(ctx.user.id, 'P1 B');
    const c = await createSystemCollection(ctx.user.id, 'P2 C');
    const d = await createSystemCollection(ctx.user.id, 'P2 D');
    await addMembers(
      a.id,
      [first[0], first[1], first[2], first[3], first[4]].map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      b.id,
      [first[0], first[1], first[2], first[3], first[5]].map((f) => f.id),
      ctx.user.id
    );
    // Pair 2: intersection 4, union 7 ⇒ jaccard 0.571 (also in band, below pair 1).
    await addMembers(
      c.id,
      [second[0], second[1], second[2], second[3], second[4], second[5]].map((f) => f.id),
      ctx.user.id
    );
    await addMembers(
      d.id,
      [second[0], second[1], second[2], second[3], second[7]].map((f) => f.id),
      ctx.user.id
    );
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = {
      decisions: [
        { pair_id: 0, verdict: 'merge', reason: 'same theme twice' },
        { pair_id: 1, verdict: 'keep_separate', reason: 'sibling-ish themes' },
      ],
    };

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(1);
    const payload = JSON.parse(mock.calls[0].messages[1].content);
    expect(payload.pairs).toHaveLength(2);
    // Highest Jaccard first: pair 0 = the 0.667 pair.
    expect(payload.pairs[0].jaccard).toBeGreaterThan(payload.pairs[1].jaccard);
    const row1 = await pairRow(a, b);
    const row2 = await pairRow(c, d);
    expect(row1).toMatchObject({ arbiterVerdict: 'merge', score: 667 });
    expect(row2).toMatchObject({ arbiterVerdict: 'keep_separate', score: 571 });
    expect(result.perUser[0].arbiterCalls).toBe(1);
    expect(result.perUser[0].mergeCandidates.arbiterSuggested).toBe(2);
  });

  it('idempotent — a pending verdict row is never re-adjudicated', async () => {
    const { ctx, a, b } = await setupBandPair('idem');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'merge', reason: 'once is enough' }] };

    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'sibling', reason: 'would demote' }] };
    const second = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(1);
    const row = await pairRow(a, b);
    expect(row).toMatchObject({ arbiterVerdict: 'merge' });
    expect(second.perUser[0].arbiterCalls).toBe(0);
  });

  it('rejected band pair is terminal — never re-adjudicated', async () => {
    const { ctx, a, b } = await setupBandPair('rej');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'merge', reason: 'seed' }] };
    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    const row = await pairRow(a, b);
    const repo = await collectionsStore.setSuggestionState(row.id, 'rejected');
    expect(repo.changes).toBe(1);

    const second = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    expect(mock.calls).toHaveLength(1);
    expect(second.perUser[0].arbiterCalls).toBe(0);
    const rows = await collectionsStore.listMergeSuggestions([a.id, b.id], { state: 'pending' });
    expect(rows).toHaveLength(0);
  });

  it('a due dismissed band row re-raises on the cadence with its verdict preserved — chat off included', async () => {
    const { ctx, a, b } = await setupBandPair('cad');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    mock.reply = { decisions: [{ pair_id: 0, verdict: 'merge', reason: 'keep me' }] };
    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    const row = await pairRow(a, b);
    await collectionsStore.setSuggestionState(row.id, 'dismissed');

    // Not due yet (dismiss_count = 1 ⇒ +14d): stays dismissed.
    await dbQuery(
      "UPDATE collection_merge_suggestions SET dismissed_at = datetime('now', '-10 days') WHERE id = ?",
      [row.id]
    );
    mock.configured = false; // chat goes dark — the lifecycle must still run.
    await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    let current = await collectionsStore.listMergeSuggestions([a.id, b.id], { state: 'dismissed' });
    expect(current.map((r) => r.id)).toContain(row.id);

    // Due (+15d): re-raise, verdict preserved, zero chat calls.
    await dbQuery(
      "UPDATE collection_merge_suggestions SET dismissed_at = datetime('now', '-15 days') WHERE id = ?",
      [row.id]
    );
    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });
    current = await pairRow(a, b);
    expect(current).toMatchObject({ state: 'pending', arbiterVerdict: 'merge' });
    expect(mock.calls).toHaveLength(1);
    expect(result.perUser[0].mergeCandidates.reopened).toBe(1);
  });

  it('chat failures (budget/breaker classes) are swallowed — zero rows, pass unaffected', async () => {
    const { ctx, a, b } = await setupBandPair('fail');
    const mock = mergeArbiterRuntime.__arbiterMock;
    mock.configured = true;
    const err = new Error('chat role paused by budget breaker');
    err.class = 'budget';
    mock.error = err;

    const result = await evolutionService.runEvolutionPass({ users: [ctx.user.id], passes: 'full' });

    expect(mock.calls).toHaveLength(1);
    expect(result.perUser[0].error).toBeUndefined();
    expect(await collectionsStore.listMergeSuggestions([a.id, b.id])).toHaveLength(0);
    expect(result.report).not.toBeNull();
  });
});
