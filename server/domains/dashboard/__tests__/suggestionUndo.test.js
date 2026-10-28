'use strict';

/**
 * Suggestion-accept command undo executor
 * (docs/spec/server/services/dashboardService.md §2.6). Real DB; composition
 * toggles between S3 (zero physical I/O) and WebDAV (move-back asserted
 * through the stubbed blobStore — the trash.test.js precedent).
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
const actionJournalStore = require('@server/store/actionJournalStore');
const storage = require('@server/store/storage');
const { createSuggestionUndoService } = require('@server/domains/dashboard/suggestionUndoService');
const dashboardService = require('@server/domains/dashboard/service');

let fileNodeService;
let dbCleanup;
let blobStub;

const userArg = (user) => ({ id: user.id, username: user.username, is_admin: user.is_admin });

function makeBlobStub({ webdav = false } = {}) {
  // Stateful trash-entry registry: an accepted file's blob MOVES into
  // /.wea-trash/<id> on trashing and moves back on undo — headBlob reflects
  // the current position so the trash-target guard and the undo probe both
  // see the truth (the trash.test.js stub idiom).
  const trashed = new Set();
  return {
    downloadBlob: jest.fn(),
    headBlob: jest.fn(async (key) => {
      const k = String(key);
      if (k.startsWith('/.wea-trash/')) {
        return webdav && trashed.has(k) ? { exists: true } : null;
      }
      return webdav ? { exists: true } : null;
    }),
    moveBlob: jest.fn(async (from, to) => {
      const f = String(from);
      const t = String(to);
      if (f.startsWith('/.wea-trash/')) trashed.delete(f);
      if (t.startsWith('/.wea-trash/')) trashed.add(t);
    }),
    deleteBlob: jest.fn().mockResolvedValue(undefined),
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
  };
}

async function storageUser(tag) {
  const { user } = await createAuthenticatedTestUser({ username: `undo-${tag}-${Date.now()}` });
  const home = await fileNodeService.createDirectory(null, user.username);
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: home.id, permission: 'admin' });
  return { user, homeId: home.id };
}

async function addFile(parentId, name, { size = 100, hash } = {}) {
  const node = await createTestFileNode({ name, type: 'file', parentId });
  await createFileNodesStore().upsertCache(node.nodeId, size, 'text/plain', hash ?? null);
  return node;
}

function setMode(mode) {
  blobStub = makeBlobStub({ webdav: mode === 'webdav' });
  composition.__setCompositionForTests({
    fileStorageMode: mode,
    blobStore: blobStub,
    fileNodeService,
  });
}

async function suggestionState(userId, nodeId) {
  const { rows } = await dbQuery(
    'SELECT state FROM file_suggestions WHERE user_id = ? AND node_id = ?',
    [Number(userId), Number(nodeId)]
  );
  return rows.map((r) => r.state);
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  setMode('s3');
});

afterAll(async () => {
  composition.resetComposition();
  await dbCleanup?.();
});

async function acceptDupPair(tag) {
  const { user, homeId } = await storageUser(tag);
  const hash = `${tag}-${Date.now()}`;
  await addFile(homeId, `k-${hash}.bin`, { hash }); // keeper first (smallest node id)
  const member = await addFile(homeId, `m-${hash}.bin`, { hash });
  await dashboardService.getDashboardSummary(user.id);
  const accept = await dashboardService.acceptSuggestions(user.id, userArg(user), [
    Number(member.nodeId),
  ]);
  return { user, member, accept };
}

describe('restore-from-trash undo', () => {
  it('S3 mode: undo restores the node, re-pends its rows, performs ZERO remote moves', async () => {
    const { user, member, accept } = await acceptDupPair('s3');
    expect(Number.isInteger(accept.actionId)).toBe(true);
    blobStub.moveBlob.mockClear();

    const result = await actionJournalStore.undoAction(accept.actionId, {});
    expect(result).toMatchObject({ undone: 1, skipped: [] });

    await expect(createFileNodesStore().getNode(Number(member.nodeId))).resolves.toMatchObject({
      id: Number(member.nodeId),
    });
    expect((await suggestionState(user.id, member.nodeId))[0]).toBe('pending');
    expect(blobStub.moveBlob).not.toHaveBeenCalled();

    const summary = await dashboardService.getDashboardSummary(user.id);
    expect(summary.suggestions.map((r) => r.nodeId)).toContain(Number(member.nodeId));
  });

  it('WebDAV mode: content moves back BEFORE the untrash marking (moveBlob trash→display)', async () => {
    setMode('webdav');
    try {
      const { user, member, accept } = await acceptDupPair('webdav');
      // accept already moved display→trash
      expect(blobStub.moveBlob).toHaveBeenCalled();
      blobStub.moveBlob.mockClear();

      const result = await actionJournalStore.undoAction(accept.actionId, {});
      expect(result.undone).toBe(1);

      expect(blobStub.moveBlob).toHaveBeenCalledWith(
        expect.stringContaining('/.wea-trash/'),
        expect.stringContaining('m-')
      );
      await expect(createFileNodesStore().getNode(Number(member.nodeId))).resolves.toMatchObject({
        id: Number(member.nodeId),
      });
      expect((await suggestionState(user.id, member.nodeId))[0]).toBe('pending');
    } finally {
      setMode('s3');
    }
  });

  it('WebDAV retry: trash path already gone + display path present continues idempotently (no second move)', async () => {
    setMode('webdav');
    try {
      const { user, member, accept } = await acceptDupPair('webdav-retry');
      // Simulate an earlier attempt that moved the blob out of the trash but
      // whose DB TX rolled back: the node is still trashed in the DB while the
      // external content already sits at the display path.
      const trashPath = `/.wea-trash/${Number(member.nodeId)}`;
      await blobStub.moveBlob(trashPath, '/simulated/display/retry.bin');
      blobStub.moveBlob.mockClear();

      const result = await actionJournalStore.undoAction(accept.actionId, {});
      expect(result).toMatchObject({ undone: 1, skipped: [] });
      // Idempotent: the retry verifies the display path instead of re-moving.
      expect(blobStub.moveBlob).not.toHaveBeenCalled();

      await expect(createFileNodesStore().getNode(Number(member.nodeId))).resolves.toMatchObject({
        id: Number(member.nodeId),
      });
      expect((await suggestionState(user.id, member.nodeId))[0]).toBe('pending');
    } finally {
      setMode('s3');
    }
  });

  it('name collision at undo time: the restored row lands under the trash-restore suffix idiom', async () => {
    const { member, accept } = await acceptDupPair('collision');
    const parentDirOf = (
      await dbQuery('SELECT parent_id FROM file_nodes WHERE id = ?', [Number(member.nodeId)])
    ).rows[0];
    await createTestFileNode({
      name: member.path.slice(member.path.lastIndexOf('/') + 1),
      type: 'file',
      parentId: Number(parentDirOf.parent_id),
    });

    const result = await actionJournalStore.undoAction(accept.actionId, {});
    expect(result.undone).toBe(1);
    const restored = await createFileNodesStore().getNode(Number(member.nodeId));
    expect(restored.name).toMatch(/^(.*) \(\d+\)\.bin$/);
  });

  it('retry after a committed node restore: skipped item re-pends its suggestions and the journal flips undone', async () => {
    const { user, member, accept } = await acceptDupPair('retry-restored');
    // Simulate a previous attempt that committed the node restore but never
    // reached the journal/suggestion flip: live node, row still accepted.
    await createFileNodesStore().untrashSubtree([Number(member.nodeId)]);
    expect((await suggestionState(user.id, member.nodeId))[0]).toBe('accepted');
    expect((await actionJournalStore.getAction(accept.actionId)).status).toBe('applied');

    const result = await actionJournalStore.undoAction(accept.actionId, {});
    expect(result.undone).toBe(0);
    expect(result.skipped).toEqual([{ reason: 'changed' }]);
    // Convergence: the retry must not leave the suggestion stranded in accepted.
    expect((await suggestionState(user.id, member.nodeId))[0]).toBe('pending');
    expect((await actionJournalStore.getAction(accept.actionId)).status).toBe('undone');
  });

  it('failure after the node restore inside the journal TX rolls the restore back (nothing applied)', async () => {
    const { user, member, accept } = await acceptDupPair('rollback');
    const action = await actionJournalStore.getAction(accept.actionId);
    const item = action.payload.items[0];
    const svc = createSuggestionUndoService({
      suggestionsStore: {
        flipStatesTx: jest.fn().mockRejectedValue(new Error('injected failure after node restore')),
      },
    });

    await expect(
      storage.getExecutor().transaction(async (tx) => {
        await svc.applyRestoreItem(item, tx);
      })
    ).rejects.toThrow();

    // The node-restore and suggestion-flip writes share the journal TX: the
    // failure rolls them back, and the journal row is still applied.
    const row = await createFileNodesStore().getNodeIncludingTrashed(Number(member.nodeId));
    expect(row.deletedAt).not.toBeNull();
    expect((await suggestionState(user.id, member.nodeId))[0]).toBe('accepted');
    expect((await actionJournalStore.getAction(accept.actionId)).status).toBe('applied');
  });

  it('trashed-parent guard: a node whose parent was trashed after accept is skipped, not orphan-restored', async () => {
    const { user, member, accept } = await acceptDupPair('orphangate');
    const parentDirOf = (
      await dbQuery('SELECT parent_id FROM file_nodes WHERE id = ?', [Number(member.nodeId)])
    ).rows[0];
    // trash ONLY the parent row (direct marking — the node's accepted
    // deleted_at fingerprint stays intact)
    await dbRun('UPDATE file_nodes SET deleted_at = ? WHERE id = ?', [
      new Date().toISOString(),
      Number(parentDirOf.parent_id),
    ]);

    const result = await actionJournalStore.undoAction(accept.actionId, {});
    expect(result.undone).toBe(0);
    expect(result.skipped).toEqual([{ reason: 'changed' }]);
    const row = await createFileNodesStore().getNodeIncludingTrashed(Number(member.nodeId));
    expect(row.deletedAt).not.toBeNull();
    expect((await suggestionState(user.id, member.nodeId))[0]).toBe('accepted');
  });

  it('undo flips the journal row even when every item skipped (status IS the record)', async () => {
    const { member, accept } = await acceptDupPair('allskip');
    await createFileNodesStore().untrashSubtree([Number(member.nodeId)]);
    const result = await actionJournalStore.undoAction(accept.actionId, {});
    expect(result.undone).toBe(0);
    expect(result.skipped).toHaveLength(1);
    const row = await actionJournalStore.getAction(accept.actionId);
    expect(row.status).toBe('undone');
  });
});
