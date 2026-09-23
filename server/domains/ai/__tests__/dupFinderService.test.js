'use strict';

/**
 * dupFinderService tests (docs/spec/server/services/dupFinderService.md,
 * AI_FEATURE_PLAN §4.17 hash-first ruling, PLAN T0.1/register (b): NULL
 * content_hash rows NEVER form a dup group). Real DB over
 * fileNodesStore.listSubtreeCacheRows — the service is pure read/compute.
 */

const {
  createTestDatabase,
  createUserRootNode,
  createTestFileNode,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const dupFinder = require('@server/domains/ai/dupFinderService');

function makeUser(tag) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return createAuthenticated(tag, stamp);
}

async function createAuthenticated(tag, stamp) {
  const User = require('@server/models/User');
  const user = await User.create(`dup-${tag}-${stamp}`, `dup-${tag}-${stamp}@t.test`, 'pw', false);
  const root = await createUserRootNode({ userId: user.id });
  return { user, rootId: root.nodeId };
}

describe('dupFinderService.findExactDuplicateGroups (hash-first)', () => {
  let dbCleanup;
  let store;
  let owner;
  let stranger;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    store = createFileNodesStore();
    owner = await makeUser('owner');
    stranger = await makeUser('stranger');
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function addFile(parentId, name, { size = 100, mimeType = 'text/plain', hash } = {}) {
    const node = await createTestFileNode({ name, type: 'file', parentId });
    await store.upsertCache(node.nodeId, size, mimeType, hash ?? null);
    return node;
  }

  it('groups nodes sharing a content_hash (≥2 only) with sizes and paths', async () => {
    const hash = `dup-a-${Date.now()}`;
    const folder = await createTestFileNode({
      name: 'docs',
      type: 'directory',
      parentId: owner.rootId,
    });
    const one = await addFile(owner.rootId, 'one copy.txt', { hash, size: 120 });
    const two = await addFile(folder.nodeId, 'two copy.txt', { hash, size: 120 });
    const solo = await addFile(owner.rootId, 'solo.txt', { hash: `unique-${Date.now()}` });

    const result = await dupFinder.findExactDuplicateGroups(owner.user.id);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.contentHash).toBe(hash);
    expect(group.nodeIds).toEqual([Number(one.nodeId), Number(two.nodeId)].sort((a, b) => a - b));
    expect(group.sizeBytes).toBe(120);
    expect(group.filePaths).toHaveLength(2);
    expect(group.filePaths.map((p) => p.split('/').pop())).toEqual(
      expect.arrayContaining(['one copy.txt', 'two copy.txt'])
    );
    expect(result.groupCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.reclaimableBytes).toBe(120); // (2 − 1) × size
    expect(JSON.stringify(result.groups.flatMap((g) => g.nodeIds))).not.toContain(
      String(solo.nodeId)
    );
  });

  it('NULL content_hash rows NEVER form a group (register (b) ruling)', async () => {
    const a = await addFile(owner.rootId, `null-a-${Date.now()}.bin`, { hash: null, size: 999 });
    const b = await addFile(owner.rootId, `null-b-${Date.now()}.bin`, { hash: null, size: 999 });

    const result = await dupFinder.findExactDuplicateGroups(owner.user.id);
    const allIds = result.groups.flatMap((group) => group.nodeIds);
    expect(allIds).not.toContain(Number(a.nodeId));
    expect(allIds).not.toContain(Number(b.nodeId));
  });

  it('rows without any filecache row are ignored', async () => {
    const node = await createTestFileNode({
      name: `nocache-${Date.now()}.txt`,
      parentId: owner.rootId,
    });
    const result = await dupFinder.findExactDuplicateGroups(owner.user.id);
    expect(result.groups.flatMap((g) => g.nodeIds)).not.toContain(Number(node.nodeId));
  });

  it('excludes directories, trashed nodes and other users’ files', async () => {
    const sharedHash = `dup-x-${Date.now()}`;
    // same content on the stranger's side — must never group with owner's
    await addFile(stranger.rootId, 'twin-of-owner.bin', { hash: sharedHash, size: 42 });
    const mine = await addFile(owner.rootId, 'mine.bin', { hash: sharedHash, size: 42 });

    const baseline = await dupFinder.findExactDuplicateGroups(owner.user.id);
    expect(baseline.groups.flatMap((g) => g.nodeIds)).not.toContain(Number(mine.nodeId));

    // second copy of mine → group; then trash it → group collapses again
    const alsoMine = await addFile(owner.rootId, 'mine2.bin', { hash: sharedHash, size: 42 });
    const grouped = await dupFinder.findExactDuplicateGroups(owner.user.id);
    const group = grouped.groups.find((g) => g.contentHash === sharedHash);
    expect(group.nodeIds).toEqual([Number(mine.nodeId), Number(alsoMine.nodeId)]);

    await store.markSubtreeDeleted([alsoMine.nodeId]);
    const afterTrash = await dupFinder.findExactDuplicateGroups(owner.user.id);
    expect(afterTrash.groups.find((g) => g.contentHash === sharedHash)).toBeUndefined();
  });

  it('multiple groups order by their smallest nodeId and sum reclaimable bytes', async () => {
    const local = await makeUser('multi');
    const h1 = `m1-${Date.now()}`;
    const h2 = `m2-${Date.now()}`;
    const a1 = await addFile(local.rootId, 'a1', { hash: h1, size: 10 });
    const a2 = await addFile(local.rootId, 'a2', { hash: h1, size: 10 });
    const b1 = await addFile(local.rootId, 'b1', { hash: h2, size: 7 });
    const b2 = await addFile(local.rootId, 'b2', { hash: h2, size: 7 });
    const b3 = await addFile(local.rootId, 'b3', { hash: h2, size: 7 });

    const result = await dupFinder.findExactDuplicateGroups(local.user.id);
    const h1Group = result.groups.find((g) => g.contentHash === h1);
    const h2Group = result.groups.find((g) => g.contentHash === h2);
    expect(result.groups[0].nodeIds[0]).toBe(Math.min(...result.groups.map((g) => g.nodeIds[0])));
    expect(h1Group.nodeIds).toEqual([Number(a1.nodeId), Number(a2.nodeId)]);
    expect(h2Group.nodeIds).toEqual(
      [Number(b1.nodeId), Number(b2.nodeId), Number(b3.nodeId)].sort((x, y) => x - y)
    );
    expect(result.groupCount).toBeGreaterThanOrEqual(2);
    expect(result.duplicateCount).toBeGreaterThanOrEqual(5);
    expect(result.reclaimableBytes).toBeGreaterThanOrEqual(10 + 2 * 7);
  });

  it('is idempotent: two consecutive calls deep-equal on unchanged data', async () => {
    const first = await dupFinder.findExactDuplicateGroups(owner.user.id);
    const second = await dupFinder.findExactDuplicateGroups(owner.user.id);
    expect(second).toEqual(first);
  });

  it('empty corpus (no root / no hashed files) ⇒ zeroed summary', async () => {
    const lonely = await makeUser('lonely');
    const summary = await dupFinder.summarizeExactDuplicates(lonely.user.id);
    expect(summary).toEqual({ groupCount: 0, duplicateCount: 0, reclaimableBytes: 0 });

    const noRoot = await dupFinder.findExactDuplicateGroups(999999999);
    expect(noRoot.groups).toEqual([]);
  });

  it('summarizeExactDuplicates is the card projection of findExactDuplicateGroups', async () => {
    const full = await dupFinder.findExactDuplicateGroups(owner.user.id);
    const summary = await dupFinder.summarizeExactDuplicates(owner.user.id);
    expect(summary).toEqual({
      groupCount: full.groupCount,
      duplicateCount: full.duplicateCount,
      reclaimableBytes: full.reclaimableBytes,
    });
  });
});
