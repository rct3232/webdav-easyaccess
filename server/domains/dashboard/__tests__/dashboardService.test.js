'use strict';

/**
 * dashboardService tests (T0.10 — docs/spec/server/services/dashboardService.md,
 * AI_FEATURE_PLAN §4.16). Real DB; the accept path delegates to the files-domain
 * trash core, so composition is overridden the same way trash.test.js does it
 * (S3 mode = zero physical I/O on trash).
 */
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbQuery,
  grantTestPermissionByNodeId,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const composition = require('@server/service/composition');
const dashboardService = require('@server/domains/dashboard/service');

let fileNodeService;
let dbCleanup;

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

async function journalRowCount() {
  const { rows } = await dbQuery('SELECT COUNT(*) AS count FROM action_journal', []);
  return Number(rows[0].count);
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

describe('getDashboardSummary', () => {
  it('feeds duplicates + computed suggestions from ONE exact-dup pass (keep = smallest node id)', async () => {
    const { user, homeId } = await storageUser('dup');
    const hash = `dash-dup-${Date.now()}`;
    const a = await addFile(homeId, 'a.bin', { hash, size: 120 });
    const folder = await createTestFileNode({ name: 'sub', type: 'directory', parentId: homeId });
    const b = await addFile(folder.nodeId, 'b.bin', { hash, size: 120 });
    const c = await addFile(homeId, 'c.bin', { hash, size: 120 });
    await addFile(homeId, 'solo.bin', { hash: `solo-${Date.now()}` });

    const summary = await dashboardService.getDashboardSummary(user.id);

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
      expect(row.reason).toEqual({ kind: 'exact_dup', keepNodeId: keepId });
      expect(row.sizeBytes).toBe(120);
      expect(typeof row.path).toBe('string');
    }
  });

  it('NULL content_hash rows never surface (register (b) consumer-side)', async () => {
    const { user, homeId } = await storageUser('null');
    const x = await addFile(homeId, `x-${Date.now()}.bin`, { hash: null, size: 999 });
    const y = await addFile(homeId, `y-${Date.now()}.bin`, { hash: null, size: 999 });

    const summary = await dashboardService.getDashboardSummary(user.id);
    const ids = [...summary.suggestions.map((row) => row.nodeId)];
    expect(ids).not.toContain(Number(x.nodeId));
    expect(ids).not.toContain(Number(y.nodeId));
    expect(summary.duplicates.groupCount).toBe(0);
    expect(summary.duplicates.duplicateCount).toBe(0);
    expect(summary.duplicates.reclaimableBytes).toBe(0);
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

    const summary = await dashboardService.getDashboardSummary(user.id);

    expect(summary.trash.itemCount).toBe(2);
    expect(summary.trash.totalBytes).toBe(350);
    expect(typeof summary.trash.oldestDeletedAt).toBe('string');
    expect(summary.trash.retentionDays).toBeGreaterThanOrEqual(0);
    void keep;
  });

  it('empty trash ⇒ zeros with oldestDeletedAt null; retention defaults to 30', async () => {
    const { user, homeId } = await storageUser('empty');
    void homeId;
    const summary = await dashboardService.getDashboardSummary(user.id);
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
    const summary = await dashboardService.getDashboardSummary(user.id);
    expect(summary.duplicates.groupCount).toBe(0);
    expect(summary.suggestions).toEqual([]);
    expect(summary.trash.itemCount).toBe(0);
  });

  it('two consecutive reads on unchanged data are deep-equal (pure read)', async () => {
    const { user, homeId } = await storageUser('idempotent');
    const hash = `dash-idem-${Date.now()}`;
    await addFile(homeId, 'one.bin', { hash });
    await addFile(homeId, 'two.bin', { hash });

    const first = await dashboardService.getDashboardSummary(user.id);
    const second = await dashboardService.getDashboardSummary(user.id);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });
});

describe('acceptSuggestions', () => {
  it('trashes own live files; foreign/unknown/already-trashed land in rejectedNotOwned', async () => {
    const { user, homeId } = await storageUser('accept');
    const stranger = await storageUser('accept-stranger');
    const one = await addFile(homeId, 'one.bin', { hash: `h-${Date.now()}` });
    const two = await addFile(homeId, 'two.bin', { hash: `h2-${Date.now()}` });
    const foreign = await addFile(stranger.homeId, 'foreign.bin', {});
    const alreadyGone = await addFile(homeId, 'gone.bin', {});
    await createFileNodesStore().markSubtreeDeleted([Number(alreadyGone.nodeId)]);

    const journalBefore = await journalRowCount();
    const result = await dashboardService.acceptSuggestions(
      user.id,
      { id: user.id, username: user.username, is_admin: user.is_admin },
      [
        Number(one.nodeId),
        Number(two.nodeId),
        Number(foreign.nodeId),
        Number(alreadyGone.nodeId),
        999999999,
      ]
    );

    expect(result.trashed.sort((a, b) => a - b)).toEqual([Number(one.nodeId), Number(two.nodeId)]);
    expect(result.rejectedNotOwned.sort((a, b) => a - b)).toEqual([
      Number(foreign.nodeId),
      Number(alreadyGone.nodeId),
      999999999,
    ]);
    expect(result.skipped).toEqual([]);

    const { rows: nodeRows } = await dbQuery(
      `SELECT id, deleted_at FROM file_nodes WHERE id IN (${[Number(one.nodeId), Number(two.nodeId), Number(foreign.nodeId)].join(',')})`,
      []
    );
    const byId = new Map(nodeRows.map((row) => [Number(row.id), row.deleted_at]));
    expect(byId.get(Number(one.nodeId))).not.toBeNull();
    expect(byId.get(Number(two.nodeId))).not.toBeNull();
    // the foreign row is untouched
    expect(byId.get(Number(foreign.nodeId))).toBeNull();

    // P0 decision: accept is NOT journaled (writers = collections only)
    expect(await journalRowCount()).toBe(journalBefore);
  });

  it('validates the batch BEFORE any work: [], missing, >200 ⇒ emptyNodeIds', async () => {
    const { user } = await storageUser('validate');
    await expect(dashboardService.acceptSuggestions(user.id, {}, [])).rejects.toThrow(
      'emptyNodeIds'
    );
    await expect(dashboardService.acceptSuggestions(user.id, {}, undefined)).rejects.toThrow(
      'emptyNodeIds'
    );
    await expect(dashboardService.acceptSuggestions(user.id, {}, 'nope')).rejects.toThrow(
      'emptyNodeIds'
    );
    await expect(
      dashboardService.acceptSuggestions(
        user.id,
        {},
        Array.from({ length: 201 }, (_, i) => i + 1)
      )
    ).rejects.toThrow('emptyNodeIds');
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
      const result = await dashboardService.acceptSuggestions(user.id, { id: user.id }, [
        Number(ok.nodeId),
        Number(bad.nodeId),
      ]);
      expect(result.trashed).toEqual([Number(ok.nodeId)]);
      expect(result.skipped).toEqual([Number(bad.nodeId)]);
    } finally {
      spy.mockRestore();
    }
  });
});
