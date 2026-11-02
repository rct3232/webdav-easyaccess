'use strict';

/**
 * storageService tests (docs/spec/server/services/storageService.md —
 * persisted storage_suggestions leg). Real DB; the accept path delegates to the
 * files-domain trash core, so composition is overridden the same way
 * trash.test.js does it (S3 mode = zero physical I/O on trash).
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
const storageSuggestionsStore = require('@server/store/storageSuggestionsStore');
const storageUsageSnapshotsStore = require('@server/store/storageUsageSnapshotsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const presets = require('@server/infrastructure/adapters/llm/presets');

let fileNodeService;
let dbCleanup;

const DAY_MS = 86400000;

function s3BlobStub() {
  return {
    downloadBlob: jest.fn(),
    headBlob: jest.fn().mockResolvedValue(null),
    moveBlob: jest.fn().mockResolvedValue(undefined),
    deleteBlob: jest.fn().mockResolvedValue(undefined),
  };
}

async function storageUser(tag) {
  const { user } = await createAuthenticatedTestUser({ username: `dash-${tag}-${Date.now()}` });
  const home = await fileNodeService.createDirectory(null, user.username);
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: home.id, permission: 'admin' });
  return { user, homeId: home.id };
}

async function addFile(parentId, name, { size = 100, hash } = {}) {
  const node = await createTestFileNode({ name, type: 'file', parentId });
  await createFileNodesStore().upsertCache(node.nodeId, size, 'text/plain', hash ?? null);
  return node;
}

async function ageFile(nodeId, ageDays) {
  await dbRun('UPDATE file_nodes SET created_at = ? WHERE id = ?', [
    new Date(Date.now() - ageDays * DAY_MS - 3600000).toISOString(),
    Number(nodeId),
  ]);
}

async function journalRowCount() {
  const { rows } = await dbQuery('SELECT COUNT(*) AS count FROM action_journal', []);
  return Number(rows[0].count);
}

async function journalRows() {
  const { rows } = await dbQuery('SELECT * FROM action_journal ORDER BY id DESC', []);
  return rows;
}

async function allSuggestionRows(userId) {
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

describe('getStorageSummary — persisted suggestions', () => {
  it('materializes exact-dup rows with id/expiresAt; keep = smallest node id; ONE pass', async () => {
    const { user, homeId } = await storageUser('dup');
    const hash = `dash-dup-${Date.now()}`;
    const a = await addFile(homeId, 'a.bin', { hash, size: 120 });
    const folder = await createTestFileNode({ name: 'sub', type: 'directory', parentId: homeId });
    const b = await addFile(folder.nodeId, 'b.bin', { hash, size: 120 });
    const c = await addFile(homeId, 'c.bin', { hash, size: 120 });
    await addFile(homeId, 'solo.bin', { hash: `solo-${Date.now()}` });

    const summary = await storageService.getStorageSummary(user.id);

    expect(summary.duplicates).toMatchObject({
      groupCount: 1,
      duplicateCount: 3,
      reclaimableBytes: 240,
    });
    const keepId = Math.min(Number(a.nodeId), Number(b.nodeId), Number(c.nodeId));
    expect(summary.suggestions.map((row) => row.nodeId).sort((x, y) => x - y)).toEqual(
      [Number(a.nodeId), Number(b.nodeId), Number(c.nodeId)].filter((id) => id !== keepId)
    );
    for (const row of summary.suggestions) {
      expect(row.kind).toBe('exact_dup');
      expect(row.reason).toEqual({ kind: 'exact_dup', keep_node_id: keepId });
      expect(row.sizeBytes).toBe(120);
      expect(typeof row.path).toBe('string');
      expect(Number.isInteger(row.id)).toBe(true);
      expect(typeof row.createdAt).toBe('string');
      expect(row.expiresAt).not.toBeNull();
      expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBeGreaterThan(28 * DAY_MS);
    }

    // Persisted side: exactly the two non-keeper rows exist as pending.
    const stored = await allSuggestionRows(user.id);
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.state === 'pending' && r.kind === 'exact_dup')).toBe(true);
  });

  it('two consecutive reads are deep-equal and insert zero new rows (idempotent materialize)', async () => {
    const { user, homeId } = await storageUser('idem');
    const hash = `dash-idem-${Date.now()}`;
    await addFile(homeId, 'one.bin', { hash });
    await addFile(homeId, 'two.bin', { hash });

    const first = await storageService.getStorageSummary(user.id);
    const before = await allSuggestionRows(user.id);
    const second = await storageService.getStorageSummary(user.id);
    const after = await allSuggestionRows(user.id);

    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
    expect(after).toHaveLength(before.length);
  });

  it('dismissed rows leave the list and are NEVER re-inserted for the same node+kind', async () => {
    const { user, homeId } = await storageUser('dismiss');
    const hash = `dash-dismiss-${Date.now()}`;
    await addFile(homeId, `keep-${hash}.bin`, { hash });
    const member = await addFile(homeId, `member-${hash}.bin`, { hash });

    const first = await storageService.getStorageSummary(user.id);
    expect(first.suggestions).toHaveLength(1);
    const row = first.suggestions[0];

    await expect(storageService.dismissSuggestion(user.id, row.id)).resolves.toEqual({
      id: row.id,
      state: 'dismissed',
    });

    const second = await storageService.getStorageSummary(user.id);
    expect(second.suggestions).toEqual([]);
    const stored = await allSuggestionRows(user.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].state).toBe('dismissed');
    void member;
  });

  it('NULL content_hash rows never surface (register (b) consumer-side)', async () => {
    const { user, homeId } = await storageUser('null');
    const x = await addFile(homeId, `x-${Date.now()}.bin`, { hash: null, size: 999 });
    const y = await addFile(homeId, `y-${Date.now()}.bin`, { hash: null, size: 999 });

    const summary = await storageService.getStorageSummary(user.id);
    const ids = [...summary.suggestions.map((row) => row.nodeId)];
    expect(ids).not.toContain(Number(x.nodeId));
    expect(ids).not.toContain(Number(y.nodeId));
    expect(summary.duplicates.groupCount).toBe(0);
    expect((await allSuggestionRows(user.id)).some((r) => r.kind === 'exact_dup')).toBe(false);
  });

  it('expired-but-unflipped rows are filtered from the list server-side', async () => {
    const { user, homeId } = await storageUser('expired');
    const node = await addFile(homeId, 'old-expiry.bin', {});
    await storageSuggestionsStore.insert({
      userId: user.id,
      nodeId: Number(node.nodeId),
      kind: 'temp_pattern',
      reason: { kind: 'temp_pattern', pattern: 'temp' },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.suggestions.some((row) => row.nodeId === Number(node.nodeId))).toBe(false);
  });

  it('reconcile: a pending row whose node was trashed out-of-band flips to expired', async () => {
    const { user, homeId } = await storageUser('reconcile');
    const hash = `dash-reconcile-${Date.now()}`;
    await addFile(homeId, `keep-${hash}.bin`, { hash });
    const member = await addFile(homeId, `member-${hash}.bin`, { hash });

    const first = await storageService.getStorageSummary(user.id);
    expect(first.suggestions).toHaveLength(1);

    await createFileNodesStore().markSubtreeDeleted([Number(member.nodeId)]);
    const second = await storageService.getStorageSummary(user.id);
    expect(second.suggestions).toEqual([]);
    const stored = await allSuggestionRows(user.id);
    expect(stored.find((r) => Number(r.node_id) === Number(member.nodeId)).state).toBe('expired');
  });

  it('rule variants: temp pattern, stale screenshot, old installer age gates', async () => {
    const { user, homeId } = await storageUser('rules');
    const temp = await addFile(homeId, 'temp_scratch.bin', { hash: `r1-${Date.now()}` });
    const shot = await addFile(homeId, 'Screenshot_old.png', { hash: `r2-${Date.now()}` });
    const fresh = await addFile(homeId, 'Screenshot_fresh.png', { hash: `r3-${Date.now()}` });
    const installer = await addFile(homeId, 'tool-installer.exe', { hash: `r4-${Date.now()}` });
    await ageFile(shot.nodeId, 31);
    await ageFile(fresh.nodeId, 2);
    await ageFile(installer.nodeId, 91);

    const summary = await storageService.getStorageSummary(user.id);
    const byKind = Object.fromEntries(summary.suggestions.map((r) => [r.kind, r]));
    expect(byKind.temp_pattern.nodeId).toBe(Number(temp.nodeId));
    expect(byKind.temp_pattern.reason).toEqual({ kind: 'temp_pattern', pattern: 'temp' });
    expect(byKind.stale_screenshot.nodeId).toBe(Number(shot.nodeId));
    expect(byKind.stale_screenshot.reason.pattern).toBe('screenshot');
    expect(byKind.stale_screenshot.reason.age_days).toBeGreaterThanOrEqual(31);
    expect(byKind.old_installer.nodeId).toBe(Number(installer.nodeId));
    expect(byKind.old_installer.reason.pattern).toBe('installer');
    expect(summary.suggestions.some((r) => r.nodeId === Number(fresh.nodeId))).toBe(false);
  });

  it('keepers never list for any kind; per-node kind priority keeps one row (exact wins over temp)', async () => {
    const { user, homeId } = await storageUser('priority');
    const hash = `dash-prio-${Date.now()}`;
    const keeper = await addFile(homeId, 'temp_keeper.bin', { hash }); // keeper + temp name
    const member = await addFile(homeId, 'temp_member.bin', { hash }); // member + temp name

    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.suggestions).toHaveLength(1);
    expect(summary.suggestions[0].nodeId).toBe(Number(member.nodeId));
    expect(summary.suggestions[0].kind).toBe('exact_dup');
    expect(summary.suggestions[0].reason.keep_node_id).toBe(Number(keeper.nodeId));
    void member;
  });

  it('trash summary counts subtree-wide trashed files incl. children of trashed folders', async () => {
    const { user, homeId } = await storageUser('trash');
    const keep = await addFile(homeId, 'keep.bin', { size: 7 });
    const folder = await createTestFileNode({ name: 'gone', type: 'directory', parentId: homeId });
    const inner = await addFile(folder.nodeId, 'inner.bin', { size: 100 });
    const solo = await addFile(homeId, 'solo.bin', { size: 250 });
    await createFileNodesStore().markSubtreeDeleted([
      Number(folder.nodeId),
      Number(inner.nodeId),
      Number(solo.nodeId),
    ]);

    const summary = await storageService.getStorageSummary(user.id);

    expect(summary.trash.itemCount).toBe(2);
    expect(summary.trash.totalBytes).toBe(350);
    expect(typeof summary.trash.oldestDeletedAt).toBe('string');
    expect(summary.trash.retentionDays).toBeGreaterThanOrEqual(0);
    void keep;
  });

  it('empty trash ⇒ zeros with oldestDeletedAt null; retention defaults to 30', async () => {
    const { user, homeId } = await storageUser('empty');
    void homeId;
    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.trash).toEqual({
      itemCount: 0,
      totalBytes: 0,
      oldestDeletedAt: null,
      retentionDays: 30,
    });
    expect(summary.duplicates).toEqual({ groupCount: 0, duplicateCount: 0, reclaimableBytes: 0 });
    expect(summary.suggestions).toEqual([]);
  });

  it('a user without a root node reads as all-zero (no error)', async () => {
    const { user } = await createAuthenticatedTestUser({ username: `dash-noroot-${Date.now()}` });
    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.duplicates.groupCount).toBe(0);
    expect(summary.suggestions).toEqual([]);
    expect(summary.trash.itemCount).toBe(0);
  });
});

describe('acceptSuggestions — journaled command', () => {
  const userArg = (user) => ({ id: user.id, username: user.username, is_admin: user.is_admin });

  it('trashes own live files, flips pending rows, ONE command row with items = trashed count', async () => {
    const { user, homeId } = await storageUser('accept');
    const stranger = await storageUser('accept-stranger');
    const dupHash = `h-${Date.now()}`;
    await addFile(homeId, `dup-keep-${Date.now()}.bin`, { hash: dupHash }); // keeper (smallest id)
    const one = await addFile(homeId, 'dup-one.bin', { hash: dupHash });
    const two = await addFile(homeId, `dup-two-${Date.now()}.bin`, { hash: `h2-${Date.now()}` });
    const foreign = await addFile(stranger.homeId, 'foreign.bin', {});
    const alreadyGone = await addFile(homeId, 'gone.bin', {});
    await createFileNodesStore().markSubtreeDeleted([Number(alreadyGone.nodeId)]);

    // Materialize so `one` carries a pending exact_dup row.
    await storageService.getStorageSummary(user.id);

    const journalBefore = await journalRowCount();
    const result = await storageService.acceptSuggestions(user.id, userArg(user), [
      Number(one.nodeId),
      Number(two.nodeId),
      Number(foreign.nodeId),
      Number(alreadyGone.nodeId),
      999999999,
    ]);

    expect(result.trashed.sort((a, b) => a - b)).toEqual([Number(one.nodeId), Number(two.nodeId)]);
    expect(result.rejectedNotOwned.sort((a, b) => a - b)).toEqual([
      Number(foreign.nodeId),
      Number(alreadyGone.nodeId),
      999999999,
    ]);
    expect(result.skipped).toEqual([]);
    expect(Number.isInteger(result.actionId)).toBe(true);

    const { rows: nodeRows } = await dbQuery(
      `SELECT id, deleted_at FROM file_nodes WHERE id IN (${[Number(one.nodeId), Number(two.nodeId), Number(foreign.nodeId)].join(',')})`,
      []
    );
    const byId = new Map(nodeRows.map((row) => [Number(row.id), row.deleted_at]));
    expect(byId.get(Number(one.nodeId))).not.toBeNull();
    expect(byId.get(Number(two.nodeId))).not.toBeNull();
    expect(byId.get(Number(foreign.nodeId))).toBeNull();

    // ONE command row: domain 'file', cleanup-accept, items per trashed node.
    expect(await journalRowCount()).toBe(journalBefore + 1);
    const [row] = await journalRows();
    expect(row.domain).toBe('file');
    expect(row.action).toBe('cleanup-accept');
    expect(String(row.subject)).toMatch(/^file:suggestion-accept:/);
    expect(String(row.actor)).toBe(String(user.id));
    const payload = JSON.parse(
      typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload)
    );
    expect(payload.inverse).toEqual({ op: 'restore-from-trash' });
    expect(payload.items).toHaveLength(2);
    for (const item of payload.items) {
      expect(Number.isInteger(item.nodeId)).toBe(true);
      expect(typeof item.deletedAt).toBe('string');
      expect(Array.isArray(item.suggestionIds)).toBe(true);
    }
    const oneItem = payload.items.find((i) => i.nodeId === Number(one.nodeId));
    expect(oneItem.suggestionIds.length).toBeGreaterThanOrEqual(1);

    // The exact-dup pending row for `one` flipped to accepted and left the list.
    const stored = await allSuggestionRows(user.id);
    const oneRows = stored.filter((r) => Number(r.node_id) === Number(one.nodeId));
    expect(oneRows.length).toBeGreaterThan(0);
    expect(oneRows.every((r) => r.state === 'accepted')).toBe(true);
    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.suggestions.some((r) => r.nodeId === Number(one.nodeId))).toBe(false);
  });

  it('nothing trashed ⇒ NO command row (actionId null, journal count unchanged)', async () => {
    const { user } = await storageUser('accept-empty');
    const journalBefore = await journalRowCount();
    const result = await storageService.acceptSuggestions(user.id, userArg(user), [999999997]);
    expect(result.trashed).toEqual([]);
    expect(result.actionId).toBeNull();
    expect(await journalRowCount()).toBe(journalBefore);
  });

  it('validates the batch BEFORE any work: [], missing, >200 ⇒ emptyNodeIds, zero journal rows', async () => {
    const { user } = await storageUser('validate');
    const journalBefore = await journalRowCount();
    await expect(storageService.acceptSuggestions(user.id, {}, [])).rejects.toThrow('emptyNodeIds');
    await expect(storageService.acceptSuggestions(user.id, {}, undefined)).rejects.toThrow(
      'emptyNodeIds'
    );
    await expect(storageService.acceptSuggestions(user.id, {}, 'nope')).rejects.toThrow(
      'emptyNodeIds'
    );
    await expect(
      storageService.acceptSuggestions(
        user.id,
        {},
        Array.from({ length: 201 }, (_, i) => i + 1)
      )
    ).rejects.toThrow('emptyNodeIds');
    expect(await journalRowCount()).toBe(journalBefore);
  });

  it('isolates per-node failures: a throwing trash core lands in skipped, the loop continues', async () => {
    const { user, homeId } = await storageUser('flaky');
    const ok = await addFile(homeId, 'ok.bin', {});
    const bad = await addFile(homeId, 'bad.bin', {});

    const original = composition.getComposition().fileService.deleteNode;
    const spy = jest
      .spyOn(composition.getComposition().fileService, 'deleteNode')
      .mockImplementation(async (nodeId, userId, u) => {
        if (Number(nodeId) === Number(bad.nodeId)) throw new Error('backend down');
        return original(nodeId, userId, u);
      });

    try {
      const result = await storageService.acceptSuggestions(user.id, { id: user.id }, [
        Number(ok.nodeId),
        Number(bad.nodeId),
      ]);
      expect(result.trashed).toEqual([Number(ok.nodeId)]);
      expect(result.skipped).toEqual([Number(bad.nodeId)]);
      const [row] = await journalRows();
      const payload = JSON.parse(
        typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload)
      );
      expect(payload.items).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('dismissSuggestion', () => {
  it("flips the requester's pending row; unknown/foreign/non-pending ⇒ suggestionNotFound", async () => {
    const { user, homeId } = await storageUser('dismiss-svc');
    const node = await addFile(homeId, 'temp_dismiss.bin', {});
    const { id } = await storageSuggestionsStore.insert({
      userId: user.id,
      nodeId: Number(node.nodeId),
      kind: 'temp_pattern',
      reason: { kind: 'temp_pattern', pattern: 'temp' },
    });

    await expect(storageService.dismissSuggestion(user.id, id)).resolves.toEqual({
      id,
      state: 'dismissed',
    });
    await expect(storageService.dismissSuggestion(user.id, id)).rejects.toThrow(
      'suggestionNotFound'
    );
    await expect(storageService.dismissSuggestion(999999, id)).rejects.toThrow(
      'suggestionNotFound'
    );
    await expect(storageService.dismissSuggestion(user.id, 999999)).rejects.toThrow(
      'suggestionNotFound'
    );
  });

  it('non-numeric or ≤0 suggestionId ⇒ invalidSuggestionId', async () => {
    const { user } = await storageUser('dismiss-invalid');
    await expect(storageService.dismissSuggestion(user.id, 'x')).rejects.toThrow(
      'invalidSuggestionId'
    );
    await expect(storageService.dismissSuggestion(user.id, 0)).rejects.toThrow(
      'invalidSuggestionId'
    );
    await expect(storageService.dismissSuggestion(user.id, undefined)).rejects.toThrow(
      'invalidSuggestionId'
    );
  });
});

describe('resolveStorageSuggestionRetentionDays', () => {
  it('defaults to the shipped 30-day horizon (finite ≥0 registry values win)', async () => {
    const days = await storageService.resolveStorageSuggestionRetentionDays();
    expect(days).toBe(30);
  });
});

describe('getStorageSummary — vector near-dup feed + persisted variant (nearDupFinderService.md)', () => {
  const THETA = presets.getPresetByFamilyRole('embedded', 'embed').profile.thetaDup;

  afterEach(async () => {
    await dbQuery('DELETE FROM embeddings', []);
    await dbQuery("DELETE FROM llm_models WHERE role = 'embed'", []);
  });

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

  it('profile θ_dup gates the vector leg: a pair just BELOW it contributes no near_duplicates block rows', async () => {
    const { user, homeId } = await storageUser('theta');
    const a = await addFile(homeId, 'below-a.txt', { hash: `th-a-${Date.now()}`, size: 100 });
    const b = await addFile(homeId, 'below-b.txt', { hash: `th-b-${Date.now()}`, size: 100 });
    const modelId = await activateEmbedModel();
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
      vector: nearPairVector(THETA - 0.002),
      source: 'fulltext',
      contentHash: null,
    });

    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.nearDuplicates).toEqual({ groupCount: 0, duplicateCount: 0 });
    expect(summary.suggestions.filter((r) => r.kind === 'near_dup')).toEqual([]);
    // grep-gate corollary: the leg reads the ACTIVE profile, never a hardcoded
    // threshold — the pair was constructed relative to the profile constant.
    expect(Number.isFinite(THETA)).toBe(true);
  });

  it('appends near_duplicates + persisted near_dup rows; hash twins stay exact-only; exact rows rank first', async () => {
    const { user, homeId } = await storageUser('neardup');
    const a = await addFile(homeId, 'near-a.txt', { hash: `nd-a-${Date.now()}`, size: 100 });
    const b = await addFile(homeId, 'near-b.txt', { hash: `nd-b-${Date.now()}`, size: 140 });
    const twinHash = `nd-twin-${Date.now()}`;
    const c = await addFile(homeId, 'twin-c.txt', { hash: twinHash, size: 50 });
    const d = await addFile(homeId, 'twin-d.txt', { hash: twinHash, size: 50 });

    const modelId = await activateEmbedModel();
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
    // hash twins with identical vectors: cosine 1.0 — hash-first keeps them OUT
    await embeddingsStore.upsert(Number(c.nodeId), {
      modelId,
      dim: 4,
      vector: [0, 0, 1, 0],
      source: 'fulltext',
      contentHash: null,
    });
    await embeddingsStore.upsert(Number(d.nodeId), {
      modelId,
      dim: 4,
      vector: [0, 0, 1, 0],
      source: 'fulltext',
      contentHash: null,
    });

    const summary = await storageService.getStorageSummary(user.id);

    expect(summary.nearDuplicates).toEqual({ groupCount: 1, duplicateCount: 2 });
    const nearRows = summary.suggestions.filter((row) => row.kind === 'near_dup');
    expect(nearRows).toHaveLength(1);
    const keepId = Math.min(Number(a.nodeId), Number(b.nodeId));
    const memberId = Math.max(Number(a.nodeId), Number(b.nodeId));
    expect(nearRows[0]).toMatchObject({
      nodeId: memberId,
      kind: 'near_dup',
      path: expect.any(String),
      sizeBytes: memberId === Number(b.nodeId) ? 140 : 100,
      reason: { kind: 'near_dup', keep_node_id: keepId },
    });
    expect(Number.isInteger(nearRows[0].id)).toBe(true);
    expect(typeof nearRows[0].reason.score).toBe('number');

    // exact rows rank BEFORE near rows; twin rows are exact_dup kind only.
    const kinds = summary.suggestions.map((r) => r.kind);
    const twinRows = summary.suggestions.filter((r) =>
      [Number(c.nodeId), Number(d.nodeId)].includes(r.nodeId)
    );
    expect(twinRows.length).toBeGreaterThan(0);
    expect(twinRows.every((r) => r.kind === 'exact_dup')).toBe(true);
    expect(kinds.indexOf('exact_dup')).toBeLessThan(kinds.indexOf('near_dup'));

    // Persisted: the twin member + the near member exist as pending rows.
    const stored = await allSuggestionRows(user.id);
    expect(stored.filter((r) => r.kind === 'near_dup')).toHaveLength(1);
    expect(stored.filter((r) => r.kind === 'exact_dup').length).toBeGreaterThanOrEqual(1);
  });

  it('short-doc exception: a ≤1-sentence enriched member never lists near_dup; members WITHOUT enrichment do', async () => {
    const { user, homeId } = await storageUser('shortdoc');
    const a = await addFile(homeId, 'sd-a.txt', { hash: `sd-a-${Date.now()}`, size: 100 });
    const b = await addFile(homeId, 'sd-b.txt', { hash: `sd-b-${Date.now()}`, size: 110 });
    const c = await addFile(homeId, 'sd-c.txt', { hash: `sd-c-${Date.now()}`, size: 120 });
    const modelId = await activateEmbedModel();
    const t = THETA + 0.001;
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
      vector: nearPairVector(t),
      source: 'fulltext',
      contentHash: null,
    });
    // c mirrors b on the other side of a: a is the central member (keeper),
    // b and c sit at ±θ from it and fall below θ to each other.
    await embeddingsStore.upsert(Number(c.nodeId), {
      modelId,
      dim: 4,
      vector: [t, -Math.sqrt(1 - t * t), 0, 0],
      source: 'fulltext',
      contentHash: null,
    });
    // keeper a = a two-sentence doc; b = one sentence (excluded); c = no enrichment (listed)
    await aiEnrichmentsStore.upsert(Number(a.nodeId), {
      summary: 'First sentence. Second sentence.',
    });
    await aiEnrichmentsStore.upsert(Number(b.nodeId), { summary: 'A single short line.' });

    const summary = await storageService.getStorageSummary(user.id);
    const nearRows = summary.suggestions.filter((r) => r.kind === 'near_dup');
    expect(nearRows.map((r) => r.nodeId).sort((x, y) => x - y)).toEqual([Number(c.nodeId)]);
    expect(nearRows[0].reason.keep_node_id).toBe(Number(a.nodeId));
    expect(nearRows[0].reason.keep.basis).toBe('centrality');
    const stored = await allSuggestionRows(user.id);
    expect(
      stored.some((r) => r.kind === 'near_dup' && Number(r.node_id) === Number(b.nodeId))
    ).toBe(false);
  });

  it('no active embed model ⇒ no near_duplicates key, NO near_dup row ever materialized, GET 200-shaped', async () => {
    const { user, homeId } = await storageUser('noembed');
    const hash = `ne-${Date.now()}`;
    await addFile(homeId, `k-${hash}.bin`, { hash });
    await addFile(homeId, `m-${hash}.bin`, { hash });
    await addFile(homeId, 'temp_z.bin', {});

    const summary = await storageService.getStorageSummary(user.id);
    expect(summary.nearDuplicates).toBeUndefined();
    expect(summary.suggestions.every((r) => r.kind !== 'near_dup')).toBe(true);
    const stored = await allSuggestionRows(user.id);
    expect(stored.some((r) => r.kind === 'near_dup')).toBe(false);
    // rule + exact variants still ship with embed unconfigured (§4.12 None column)
    expect(stored.some((r) => r.kind === 'exact_dup')).toBe(true);
    expect(stored.some((r) => r.kind === 'temp_pattern')).toBe(true);
  });
});

describe('undo (accept command rows)', () => {
  const userArg = (user) => ({ id: user.id, username: user.username, is_admin: user.is_admin });
  const actionJournalStore = require('@server/store/actionJournalStore');
  require('@server/domains/storage/suggestionUndoService'); // ensure the file-domain executor is registered

  it('full restore: nodes live again, rows pending, re-listed with the SAME ids', async () => {
    const { user, homeId } = await storageUser('undo-full');
    const hash = `ud-${Date.now()}`;
    await addFile(homeId, `k-${hash}.bin`, { hash });
    const m1 = await addFile(homeId, `m1-${hash}.bin`, { hash });
    const m2 = await addFile(homeId, `m2-${hash}.bin`, { hash });

    await storageService.getStorageSummary(user.id);
    const before = await storageService.getStorageSummary(user.id);
    const ids = before.suggestions.map((r) => r.id);

    const accept = await storageService.acceptSuggestions(user.id, userArg(user), [
      Number(m1.nodeId),
      Number(m2.nodeId),
    ]);
    expect(Number.isInteger(accept.actionId)).toBe(true);

    const undone = await actionJournalStore.undoAction(accept.actionId, {});
    expect(undone.undone).toBe(2);
    expect(undone.skipped).toEqual([]);

    const store = createFileNodesStore();
    await expect(store.getNode(Number(m1.nodeId))).resolves.toMatchObject({
      id: Number(m1.nodeId),
    });
    await expect(store.getNode(Number(m2.nodeId))).resolves.toMatchObject({
      id: Number(m2.nodeId),
    });

    const after = await storageService.getStorageSummary(user.id);
    expect(after.suggestions.map((r) => r.id).sort((x, y) => x - y)).toEqual(
      [...ids].sort((x, y) => x - y)
    );
  });

  it('fingerprint mismatch is a per-item SKIP (hand-restored node), other items still undone', async () => {
    const { user, homeId } = await storageUser('undo-mixed');
    const h1 = `ux1-${Date.now()}`;
    const h2 = `ux2-${Date.now()}`;
    await addFile(homeId, `k1-${h1}.bin`, { hash: h1 });
    const kept2 = await addFile(homeId, `k2-${h2}.bin`, { hash: h2 });
    const m1 = await addFile(homeId, `x1-${h1}.bin`, { hash: h1 });
    const m2 = await addFile(homeId, `x2-${h2}.bin`, { hash: h2 });

    await storageService.getStorageSummary(user.id);
    const accept = await storageService.acceptSuggestions(user.id, userArg(user), [
      Number(m1.nodeId),
      Number(m2.nodeId),
    ]);

    // hand-restore m2 through the trash marking (the user already used the trash UX)
    await createFileNodesStore().untrashSubtree([Number(m2.nodeId)]);

    const undone = await actionJournalStore.undoAction(accept.actionId, {});
    expect(undone.undone).toBe(1);
    expect(undone.skipped).toHaveLength(1);
    expect(undone.skipped[0].reason).toBe('changed');

    const store = createFileNodesStore();
    await expect(store.getNode(Number(m1.nodeId))).resolves.toMatchObject({
      id: Number(m1.nodeId),
    });
    const stored = await allSuggestionRows(user.id);
    // the applied item's row is pending again; the skipped item (already
    // hand-restored) converges to pending too — a retry must not strand it
    const m1State = stored.find((r) => Number(r.node_id) === Number(m1.nodeId)).state;
    const m2State = stored.find((r) => Number(r.node_id) === Number(m2.nodeId)).state;
    expect(m1State).toBe('pending');
    expect(m2State).toBe('pending');
    void kept2;
  });
});

describe('getStorageUsage', () => {
  async function insertObject(nodeId, suffix, version, status, size) {
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status, size)
       VALUES (?, ?, 's3', ?, ?, ?)`,
      [Number(nodeId), `svc-usage-${suffix}-${Date.now()}-${Math.random()}`, version, status, size]
    );
  }

  it('returns current zeros and an empty series below the two-point minimum', async () => {
    const { user } = await storageUser('su-svc-one');
    await storageUsageSnapshotsStore.upsertSnapshot({
      userId: user.id,
      day: '2032-01-01',
      bytes: 7,
    });

    const result = await storageService.getStorageUsage(user.id);
    expect(result).toEqual({
      current: {
        totalBytes: 0,
        liveBytes: 0,
        trashBytes: 0,
        versionBytes: 0,
        versionHistorySupported: true,
        incomplete: false,
        asOf: expect.any(String),
      },
      series: { points: [] },
    });
    expect(Number.isNaN(Date.parse(result.current.asOf))).toBe(false);
  });

  it('maps retained rows to day/bytes points in ascending day order', async () => {
    const { user } = await storageUser('su-svc-two');
    await storageUsageSnapshotsStore.upsertSnapshot({
      userId: user.id,
      day: '2032-02-02',
      bytes: 20,
    });
    await storageUsageSnapshotsStore.upsertSnapshot({
      userId: user.id,
      day: '2032-02-01',
      bytes: 10,
    });

    const result = await storageService.getStorageUsage(user.id);
    expect(result.series).toEqual({
      points: [
        { day: '2032-02-01', bytes: 10 },
        { day: '2032-02-02', bytes: 20 },
      ],
    });
  });

  it('S3 current partitions live, trash and history bytes (total = sum)', async () => {
    const { user, homeId } = await storageUser('su-svc-breakdown');
    const live = await addFile(homeId, 'live.bin', { hash: `su-live-${Date.now()}` });
    const trashed = await addFile(homeId, 'trashed.bin', { hash: `su-trash-${Date.now()}` });
    await insertObject(live.nodeId, 'live-active', 1, 'active', 100);
    await insertObject(live.nodeId, 'live-history', 2, 'history', 50);
    await insertObject(trashed.nodeId, 'trash-active', 1, 'active', 200);
    await insertObject(trashed.nodeId, 'trash-pending', 2, 'pending', 900);
    await createFileNodesStore().markSubtreeDeleted([Number(trashed.nodeId)]);

    const result = await storageService.getStorageUsage(user.id);
    expect(result.current).toMatchObject({
      totalBytes: 350,
      liveBytes: 100,
      trashBytes: 200,
      versionBytes: 50,
      versionHistorySupported: true,
      incomplete: false,
    });
  });

  it('marks the current total incomplete when a counted size is NULL', async () => {
    const { user, homeId } = await storageUser('su-svc-incomplete');
    const file = await addFile(homeId, 'null-size.bin', { hash: `su-null-${Date.now()}` });
    await insertObject(file.nodeId, 'null-active', 1, 'active', null);

    const result = await storageService.getStorageUsage(user.id);
    expect(result.current).toMatchObject({
      totalBytes: 0,
      liveBytes: 0,
      trashBytes: 0,
      versionBytes: 0,
      incomplete: true,
    });
  });

  it('WebDAV current sums live + trash filecache and reports no version history', async () => {
    const { user, homeId } = await storageUser('su-svc-webdav');
    await addFile(homeId, 'live-webdav.bin', { size: 30, hash: null });
    const trashed = await addFile(homeId, 'trashed-webdav.bin', { size: 40, hash: null });
    await createFileNodesStore().markSubtreeDeleted([Number(trashed.nodeId)]);
    composition.__setCompositionForTests({
      fileStorageMode: 'webdav',
      blobStore: s3BlobStub(),
      fileNodeService,
    });

    try {
      const result = await storageService.getStorageUsage(user.id);
      expect(result.current).toMatchObject({
        totalBytes: 70,
        liveBytes: 30,
        trashBytes: 40,
        versionBytes: 0,
        versionHistorySupported: false,
        incomplete: false,
      });
    } finally {
      composition.__setCompositionForTests({
        fileStorageMode: 's3',
        blobStore: s3BlobStub(),
        fileNodeService,
      });
    }
  });
});
