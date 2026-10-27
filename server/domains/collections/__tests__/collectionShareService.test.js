/**
 * collectionShareService unit tests (domain objects, thrown bare string codes).
 * @see docs/spec/server/services/collectionShareService.md
 *
 * The sharing half of the collections platform: role matrix, publish gate and
 * pending count, grants CRUD + instant revocation, grantee self-revocation and
 * the download/preview consumption pre-check. Surfaces that stayed in
 * collectionsService (createCollection/addItems/getItems/listCollections/
 * checkUploadAdmissions) are exercised through it as fixtures.
 */
const shareService = require('../shareService');
const collectionsService = require('../service');
// Load the actions domain once: it registers the collection-domain undo
// executor (actions/service.js) that actionJournalStore.undoAction dispatches
// to for the re-grant/revoke-undo cases below.
require('@server/domains/actions/service');
const collectionsStore = require('@server/store/collectionsStore');
const actionJournalStore = require('@server/store/actionJournalStore');
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
    username: `share-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
}

async function createAdminUserWithRoot(tag) {
  const { user } = await createAuthenticatedTestUser({
    username: `share-adm-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    isAdmin: true,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, root };
}

async function setupShareUser(tag) {
  const ctx = await createUserWithRoot(tag);
  const travel = await fileNodeService.createDirectory(ctx.root.id, 'travel');
  const beach = await fileNodeService.createFile(travel.id, 'beach.jpg');
  return { ...ctx, travel, beach };
}

async function journalActionCount(collectionId, action) {
  const rows = await dbQuery(
    'SELECT COUNT(*) AS n FROM action_journal WHERE subject = ? AND action = ?',
    [`collection:${collectionId}`, action]
  );
  return Number(rows.rows[0].n);
}

/** Shared fixture: owner collection granted to a role. */
async function setupSharedCollection(tag, role) {
  const owner = await createUserWithRoot(`${tag}-owner`);
  const grantee = await createUserWithRoot(`${tag}-grantee`);
  const stranger = await createUserWithRoot(`${tag}-stranger`);
  const { collection } = await collectionsService.createCollection(owner.user.id, {
    name: `Shared ${tag}`,
  });
  await collectionsStore.grantAccess(collection.id, grantee.user.id, role, owner.user.id, {
    actor: owner.user.id,
  });
  return { owner, grantee, stranger, collection };
}

// ---------------------------------------------------------------------------
// getRole + read/role gates (§2.2)
// ---------------------------------------------------------------------------

describe('shareService getRole / role gates', () => {
  it('resolves owner/editor/viewer live from the collection + grant rows', async () => {
    const owner = await createUserWithRoot('role-owner');
    const editor = await createUserWithRoot('role-editor');
    const viewer = await createUserWithRoot('role-viewer');
    const stranger = await createUserWithRoot('role-stranger');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Roles',
    });

    expect(await shareService.getRole(owner.user.id, collection.id)).toBe('owner');
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: editor.user.id,
      role: 'editor',
    });
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: viewer.user.id,
      role: 'viewer',
    });
    expect(await shareService.getRole(editor.user.id, collection.id)).toBe('editor');
    expect(await shareService.getRole(viewer.user.id, collection.id)).toBe('viewer');
    expect(await shareService.getRole(stranger.user.id, collection.id)).toBeNull();

    // revocation is instant: next read resolves role=null
    await shareService.revoke(owner.user.id, collection.id, viewer.user.id);
    expect(await shareService.getRole(viewer.user.id, collection.id)).toBeNull();
  });

  it('archived collections resolve role normally (display state, not ACL state)', async () => {
    const { owner, grantee, collection } = await setupSharedCollection('role-arch', 'editor');
    await collectionsService.archiveCollection(owner.user.id, collection.id);
    expect(await shareService.getRole(grantee.user.id, collection.id)).toBe('editor');
  });

  it('requireOwnerOrRole: below-minimum forbidden, zero-access notFound, hidden grantee notFound', async () => {
    const owner = await createUserWithRoot('gate-owner');
    const editor = await createUserWithRoot('gate-editor');
    const viewer = await createUserWithRoot('gate-viewer');
    const stranger = await createUserWithRoot('gate-stranger');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Gates',
    });
    await collectionsStore.grantAccess(collection.id, editor.user.id, 'editor', owner.user.id, {
      actor: owner.user.id,
    });
    await collectionsStore.grantAccess(collection.id, viewer.user.id, 'viewer', owner.user.id, {
      actor: owner.user.id,
    });

    await expect(
      shareService.requireOwnerOrRole(viewer.user.id, collection, 'editor')
    ).rejects.toMatchObject({ message: 'forbidden' });
    await expect(
      shareService.requireOwnerOrRole(stranger.user.id, collection, 'editor')
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
    await expect(
      shareService.requireOwnerOrRole(editor.user.id, collection, 'editor')
    ).resolves.toBe('editor');
    await expect(
      shareService.requireOwnerOrRole(owner.user.id, collection, 'editor')
    ).resolves.toBe('owner');

    // hidden flag keeps the read-side 404 masquerade (P0 read-side input)
    await collectionsStore.setVisible(viewer.user.id, collection.id, true);
    await expect(
      shareService.requireOwnerOrRole(viewer.user.id, collection, 'viewer')
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });

    await expect(shareService.requireOwner(editor.user.id, collection)).rejects.toMatchObject({
      message: 'forbidden',
    });
    await expect(shareService.requireOwner(owner.user.id, collection)).resolves.toBeUndefined();
  });

  it('getCollectionForRead: owner grant=null, grantee carries role, unknown/zero-access masquerade 404', async () => {
    const { owner, grantee, stranger, collection } = await setupSharedCollection(
      'read-gate',
      'viewer'
    );

    const own = await shareService.getCollectionForRead(owner.user.id, collection.id);
    expect(own.role).toBe('owner');
    expect(own.grant).toBeNull();

    const shared = await shareService.getCollectionForRead(grantee.user.id, collection.id);
    expect(shared.role).toBe('viewer');
    expect(shared.grant).toMatchObject({ granteeId: grantee.user.id, role: 'viewer' });

    await expect(
      shareService.getCollectionForRead(stranger.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
    await expect(
      shareService.getCollectionForRead(stranger.user.id, 99999999)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Publish gate + pending count (§2.3)
// ---------------------------------------------------------------------------

describe('shareService isVisibleToGrantee / publishPendingCount', () => {
  it('live resolution formula: flag-gated rows, virtual rows follow auto', () => {
    const publishedRow = { published: true };
    const parkedRow = { published: false };
    const virtual = { published: false, virtual: true };

    expect(shareService.isVisibleToGrantee({ publishMode: 'ask' }, publishedRow)).toBe(true);
    expect(shareService.isVisibleToGrantee({ publishMode: 'ask' }, parkedRow)).toBe(false);
    expect(shareService.isVisibleToGrantee({ publishMode: 'off' }, parkedRow)).toBe(false);
    // auto publishes ON ADD — a parked materialized row is NOT republished
    // retroactively (routes/collections.md §2.4: grantees only ever see true)
    expect(shareService.isVisibleToGrantee({ publishMode: 'auto' }, parkedRow)).toBe(false);
    // the auto arm covers the VIRTUAL row materialization lag only
    expect(shareService.isVisibleToGrantee({ publishMode: 'auto' }, virtual)).toBe(true);
    expect(shareService.isVisibleToGrantee({ publishMode: 'ask' }, virtual)).toBe(false);
  });

  it('publishPendingCount is owner-only over the resolved rows', async () => {
    const owner = await createUserWithRoot('ppc-owner');
    const editor = await createUserWithRoot('ppc-editor');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Pending count',
    });
    // rows fixture: three parked, one published
    const rows = [
      { published: false },
      { published: false },
      { published: false },
      { published: true },
    ];

    expect(await shareService.publishPendingCount(owner.user.id, collection.id, rows)).toBe(3);
    await expect(
      shareService.publishPendingCount(editor.user.id, collection.id, rows)
    ).rejects.toMatchObject({ message: 'forbidden' });
  });
});

// ---------------------------------------------------------------------------
// grant (§2.4)
// ---------------------------------------------------------------------------

describe('shareService grant', () => {
  it('grants a viewer: row + username + undo pointer; listGrants then carries granted_role', async () => {
    const owner = await createUserWithRoot('grant-owner');
    const grantee = await createUserWithRoot('grant-grantee');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Grant ok',
    });

    const result = await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    expect(result.grant).toMatchObject({ granteeId: grantee.user.id, role: 'viewer' });
    expect(result.username).toBe(grantee.user.username);
    expect(result.undo.actionId).toBeGreaterThan(0);
    expect(await journalActionCount(collection.id, 'grant')).toBe(1);

    const listed = await shareService.listGrants(owner.user.id, collection.id);
    expect(listed.grants).toHaveLength(1);
    expect(listed.grants[0]).toMatchObject({
      grantee_id: grantee.user.id,
      username: grantee.user.username,
      role: 'viewer',
      granted_by: owner.user.id,
    });
  });

  it('role outside viewer|editor throws invalidRole before any ownership read', async () => {
    const owner = await createUserWithRoot('grant-role-o');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Grant role',
    });
    await expect(
      shareService.grant(owner.user.id, collection.id, {
        granteeId: owner.user.id,
        role: 'admin',
      })
    ).rejects.toMatchObject({ message: 'invalidRole' });
  });

  it('unknown grantee throws granteeNotFound; self-grant on the own collection throws forbidden', async () => {
    const owner = await createUserWithRoot('grant-unknown-o');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Grant unknown',
    });
    await expect(
      shareService.grant(owner.user.id, collection.id, { granteeId: 99999999, role: 'viewer' })
    ).rejects.toMatchObject({ message: 'granteeNotFound', status: 404 });

    // spec §2.4: granting one's own collection is never an exposure act
    await expect(
      shareService.grant(owner.user.id, collection.id, {
        granteeId: owner.user.id,
        role: 'viewer',
      })
    ).rejects.toMatchObject({ message: 'forbidden' });
    expect(await collectionsStore.getGrant(collection.id, owner.user.id)).toBeNull();
  });

  it('non-owner callers: viewer grantee forbidden, stranger notFound masquerade', async () => {
    const { grantee, stranger, collection } = await setupSharedCollection('grant-acl', 'viewer');
    const other = await createUserWithRoot('grant-acl-target');
    await expect(
      shareService.grant(grantee.user.id, collection.id, {
        granteeId: other.user.id,
        role: 'viewer',
      })
    ).rejects.toMatchObject({ message: 'forbidden' });
    await expect(
      shareService.grant(stranger.user.id, collection.id, {
        granteeId: other.user.id,
        role: 'viewer',
      })
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
  });

  it('admin-as-grantee is banned at grant creation (`forbidden`); non-admin grantees unaffected', async () => {
    const admin = await createAdminUserWithRoot('ban');
    const alice = await createUserWithRoot('ban-alice');
    const bob = await createUserWithRoot('ban-bob');
    const manual = await collectionsService.createCollection(alice.user.id, { name: 'BanAdm' });

    await expect(
      shareService.grant(alice.user.id, manual.collection.id, {
        granteeId: admin.user.id,
        role: 'viewer',
      })
    ).rejects.toMatchObject({ message: 'forbidden' });

    const ok = await shareService.grant(alice.user.id, manual.collection.id, {
      granteeId: bob.user.id,
      role: 'viewer',
    });
    expect(ok.grant.granteeId).toBe(bob.user.id);
  });

  it('re-grant replaces the role in ONE journaled command; undo restores the PREVIOUS role, not absence', async () => {
    const owner = await createUserWithRoot('regrant-o');
    const grantee = await createUserWithRoot('regrant-g');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Regrant',
    });

    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    const second = await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'editor',
    });

    // single PK row, replaced in place
    const replaced = await collectionsStore.getGrant(collection.id, grantee.user.id);
    expect(replaced.role).toBe('editor');
    const rows = await collectionsStore.listGrants(collection.id);
    expect(rows).toHaveLength(1);
    // the re-grant lands exactly ONE additional command row
    expect(await journalActionCount(collection.id, 'grant')).toBe(2);

    // undo of the re-grant restores viewer (the replaced grant), NOT absence
    const undone = await actionJournalStore.undoAction(second.undo.actionId, { cascade: true });
    expect(undone.undone).toBeGreaterThanOrEqual(1);
    const restored = await collectionsStore.getGrant(collection.id, grantee.user.id);
    expect(restored).not.toBeNull();
    expect(restored.role).toBe('viewer');
  });

  it('re-grant over a set hidden flag clears it; the collection reappears with granted_role', async () => {
    const owner = await createUserWithRoot('rehide-o');
    const grantee = await createUserWithRoot('rehide-g');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'Rehide',
    });
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    await collectionsStore.setVisible(grantee.user.id, collection.id, true);

    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'editor',
    });

    expect(await collectionsStore.isHiddenFor(grantee.user.id, collection.id)).toBe(false);
    const { collections } = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toBeDefined();
    expect(row.granted_role).toBe('editor');
  });
});

// ---------------------------------------------------------------------------
// revoke + digest-cursor coupling (owner-side and self-side)
// ---------------------------------------------------------------------------

describe('shareService revoke / revokeOwnGrant', () => {
  async function setupOpenedShare(tag) {
    const owner = await setupShareUser(`${tag}-o`);
    const grantee = await setupShareUser(`${tag}-g`);
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: `RB ${tag}`,
    });
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    // the read IS the visit — stamps the grantee's cursor row
    await collectionsService.getItems(grantee.user.id, collection.id);
    return { owner, grantee, collection };
  }

  it('owner-side revoke deletes the grantee cursor row; other users keep theirs', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('own');
    const other = await setupShareUser('rb-own-other');
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: other.user.id,
      role: 'viewer',
    });
    await collectionsService.getItems(other.user.id, collection.id);
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).not.toBeNull();

    const result = await shareService.revoke(owner.user.id, collection.id, grantee.user.id);
    expect(result.revoked).toBe(true);
    expect(result.grantee_id).toBe(grantee.user.id);
    expect(result.undo.actionId).toBeGreaterThan(0);

    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    expect(await collectionsStore.getDigestCursor(other.user.id, collection.id)).not.toBeNull();
    const ownerMap = await collectionsStore.listDigestCursorMap(owner.user.id);
    expect(ownerMap[collection.id]).toBeDefined();

    // revoking a missing row throws grantNotFound
    await expect(
      shareService.revoke(owner.user.id, collection.id, grantee.user.id)
    ).rejects.toMatchObject({ message: 'grantNotFound', status: 404 });
  });

  it('revoking a never-opened grant (no cursor row) succeeds: absent row is a no-op, not a throw', async () => {
    const owner = await setupShareUser('rb-noc-o');
    const grantee = await setupShareUser('rb-noc-g');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'RB NoCursor',
    });
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    await expect(
      shareService.revoke(owner.user.id, collection.id, grantee.user.id)
    ).resolves.toMatchObject({ revoked: true });
  });

  it('re-grant after revoke re-dots: the grantee list row carries last_visited_at null', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('regrant');
    await shareService.revoke(owner.user.id, collection.id, grantee.user.id);
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: grantee.user.id,
      role: 'viewer',
    });
    const { collections } = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toHaveProperty('last_visited_at', null);
  });

  it('undo-revoke restores the GRANT but NOT the cursor — re-dots (owner-accepted boundary)', async () => {
    const { owner, grantee, collection } = await setupOpenedShare('undo');
    const revoked = await shareService.revoke(owner.user.id, collection.id, grantee.user.id);
    const actionsService = require('@server/domains/actions/service');
    await actionsService.undoAction(owner.user.id, revoked.undo.actionId);

    expect(await collectionsStore.getGrant(collection.id, grantee.user.id)).not.toBeNull();
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
    const { collections } = await collectionsService.listCollections(grantee.user.id, {
      include: 'mine,shared',
    });
    const row = collections.find((c) => c.collection_id === collection.id);
    expect(row).toHaveProperty('last_visited_at', null);
  });

  it.each(['viewer', 'editor'])(
    '%s grantee self-revokes: row removed via the owner-side store path (undo pointer returned)',
    async (role) => {
      const { grantee, collection } = await setupSharedCollection(`self-${role}`, role);

      const result = await shareService.revokeOwnGrant(grantee.user.id, collection.id);
      expect(result).toMatchObject({ grantee_id: grantee.user.id, revoked: true });
      expect(result.undo.actionId).toBeGreaterThan(0);
      expect(await collectionsStore.getGrant(collection.id, grantee.user.id)).toBeNull();
    }
  );

  it('self-revoke rides the same store TX: the caller cursor row is deleted', async () => {
    const { grantee, collection } = await setupOpenedShare('self');
    const result = await shareService.revokeOwnGrant(grantee.user.id, collection.id);
    expect(result.revoked).toBe(true);
    expect(await collectionsStore.getDigestCursor(grantee.user.id, collection.id)).toBeNull();
  });

  it('collection owner self-calls throw grantNotFound (no self-grant row)', async () => {
    const { owner, collection } = await setupSharedCollection('owner-self', 'viewer');
    await expect(shareService.revokeOwnGrant(owner.user.id, collection.id)).rejects.toMatchObject({
      message: 'grantNotFound',
      status: 404,
    });
  });

  it('zero-access callers and unknown collections throw the notFound masquerade', async () => {
    const { stranger, collection } = await setupSharedCollection('stranger', 'viewer');
    await expect(
      shareService.revokeOwnGrant(stranger.user.id, collection.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
    await expect(shareService.revokeOwnGrant(stranger.user.id, 99999999)).rejects.toMatchObject({
      message: 'notFound',
      status: 404,
    });
  });

  it('a revoked grantee re-calling is zero-access: notFound masquerade', async () => {
    const { grantee, collection } = await setupSharedCollection('twice', 'viewer');
    await shareService.revokeOwnGrant(grantee.user.id, collection.id);
    await expect(shareService.revokeOwnGrant(grantee.user.id, collection.id)).rejects.toMatchObject(
      { message: 'notFound', status: 404 }
    );
  });
});

// ---------------------------------------------------------------------------
// publish (route surface PUT /:id/items/publish, §2.3)
// ---------------------------------------------------------------------------

describe('shareService publish', () => {
  async function publishedOf(collectionId, nodeId) {
    const stored = await collectionsStore.getStoredItem(collectionId, nodeId);
    return stored ? stored.published : null;
  }

  it('owner flips stored rows both directions; the row is never deleted; journal inverse restores', async () => {
    const ctx = await setupShareUser('publish-flip');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Flip' });
    await collectionsService.addItems(ctx.user.id, manual.collection.id, [ctx.beach.id]);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(false);

    const publish = await shareService.publish(
      ctx.user.id,
      manual.collection.id,
      [ctx.beach.id],
      true
    );
    expect(publish).toMatchObject({ published: [ctx.beach.id], ignored: [] });
    expect(publish.undo.actionId).toBeGreaterThan(0);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(true);

    const unpublish = await shareService.publish(
      ctx.user.id,
      manual.collection.id,
      [ctx.beach.id],
      false
    );
    expect(unpublish.published).toEqual([ctx.beach.id]);
    expect(await publishedOf(manual.collection.id, ctx.beach.id)).toBe(false);
    // unpublish NEVER deletes the stored row
    expect(await collectionsStore.getStoredItem(manual.collection.id, ctx.beach.id)).not.toBeNull();

    const journal = await dbQuery(
      'SELECT payload FROM action_journal WHERE subject = ? AND action = ? ORDER BY id DESC LIMIT 1',
      [`collection:${manual.collection.id}`, 'set-items-published']
    );
    const inverse = JSON.parse(journal.rows[0].payload).inverse;
    expect(inverse).toMatchObject({ op: 'set-items-published', published: true });
  });

  it('publishing a rule-managed stored member flips it and auto-pins the system collection', async () => {
    const ctx = await setupShareUser('publish-derived');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Derived pub',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    // write-boundary materialization: beach is a stored rule-managed row
    await collectionsService.checkUploadAdmissions(ctx.user.id, ctx.beach.id);
    const before = await collectionsService.getItems(ctx.user.id, system.id, {});
    const beforeRow = before.items.find((i) => i.nodeId === ctx.beach.id);
    expect(beforeRow).toMatchObject({ membership: 'derived', published: false });
    expect(before.publishPendingCount).toBeGreaterThan(0);

    const result = await shareService.publish(ctx.user.id, system.id, [ctx.beach.id], true);
    expect(result.published).toEqual([ctx.beach.id]);
    const stored = await collectionsStore.getStoredItem(system.id, ctx.beach.id);
    expect(stored).toMatchObject({ published: true, addedBy: ctx.user.id, source: 'system' });

    const after = await collectionsService.getItems(ctx.user.id, system.id, {});
    const rows = after.items.filter((i) => i.nodeId === ctx.beach.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].published).toBe(true);
    expect(after.publishPendingCount).toBe(before.publishPendingCount - 1);

    // §4.9b: publishing on a system collection touches the auto-pin
    const col = await collectionsStore.getCollection(system.id);
    expect(col.pinnedBy).toBe('auto');
  });

  it('unpublishing a non-member row is a NO-OP (never materializes) — ignored', async () => {
    const ctx = await setupShareUser('publish-unpub');
    const system = await collectionsStore.createCollection(
      {
        ownerId: ctx.user.id,
        name: 'Derived unpub',
        origin: 'system',
        definition: {
          kind: 'predicate',
          any_of: [{ type: 'path', value: `/${ctx.user.username}/travel` }],
        },
      },
      { actor: ctx.user.id }
    );
    const result = await shareService.publish(ctx.user.id, system.id, [ctx.beach.id], false);
    expect(result.published).toEqual([]);
    expect(result.ignored).toEqual([ctx.beach.id]);
    expect(result.undo).toBeNull();
    expect(await collectionsStore.getStoredItem(system.id, ctx.beach.id)).toBeNull();
  });

  it('ACL: editor may flip stored rows; viewer throws forbidden; ungranted throws notFound', async () => {
    const owner = await createUserWithRoot('pub-owner');
    const editor = await createUserWithRoot('pub-editor');
    const viewer = await createUserWithRoot('pub-viewer');
    const stranger = await createUserWithRoot('pub-stranger');
    const manual = await collectionsService.createCollection(owner.user.id, { name: 'Acl pub' });
    await collectionsStore.grantAccess(
      manual.collection.id,
      editor.user.id,
      'editor',
      owner.user.id
    );
    await collectionsStore.grantAccess(
      manual.collection.id,
      viewer.user.id,
      'viewer',
      owner.user.id
    );
    const ownerBeach = await fileNodeService.createFile(owner.root.id, 'apub.jpg');

    const ok = await shareService.publish(
      editor.user.id,
      manual.collection.id,
      [ownerBeach.id],
      true
    );
    expect(ok).toMatchObject({ published: [], ignored: [ownerBeach.id] });

    await collectionsService.addItems(owner.user.id, manual.collection.id, [ownerBeach.id]);
    const editorFlip = await shareService.publish(
      editor.user.id,
      manual.collection.id,
      [ownerBeach.id],
      true
    );
    expect(editorFlip.published).toEqual([ownerBeach.id]);

    await expect(
      shareService.publish(viewer.user.id, manual.collection.id, [ownerBeach.id], true)
    ).rejects.toMatchObject({ message: 'forbidden' });
    await expect(
      shareService.publish(stranger.user.id, manual.collection.id, [ownerBeach.id], true)
    ).rejects.toMatchObject({ message: 'notFound' });
  });

  it('empty/oversized nodeIds reuse the parseNodeIds boundary (emptyNodeIds)', async () => {
    const ctx = await setupShareUser('publish-vals');
    const manual = await collectionsService.createCollection(ctx.user.id, { name: 'Vals' });
    await expect(
      shareService.publish(ctx.user.id, manual.collection.id, [], true)
    ).rejects.toMatchObject({ message: 'emptyNodeIds' });
    await expect(
      shareService.publish(ctx.user.id, manual.collection.id, [ctx.beach.id], 'yes')
    ).rejects.toMatchObject({ message: 'invalidPublishMode' });
  });
});

// ---------------------------------------------------------------------------
// assertMemberConsumable (§2.6 download/preview bridge pre-check)
// ---------------------------------------------------------------------------

describe('shareService assertMemberConsumable', () => {
  it('grantee of a PUBLISHED owner-owned member passes; unpublished fails (forbidden)', async () => {
    const owner = await setupShareUser('amc-owner');
    const viewer = await setupShareUser('amc-viewer');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'AMC gate',
    });
    await collectionsService.addItems(owner.user.id, collection.id, [owner.beach.id]);
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: viewer.user.id,
      role: 'viewer',
    });

    // ask mode: parked row is not consumable through the collection
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, owner.beach.id)
    ).rejects.toMatchObject({ message: 'forbidden' });

    await shareService.publish(owner.user.id, collection.id, [owner.beach.id], true);
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, owner.beach.id)
    ).resolves.not.toThrow();

    // the owner path skips the visibility gate entirely
    await shareService.publish(owner.user.id, collection.id, [owner.beach.id], false);
    await expect(
      shareService.assertMemberConsumable(owner.user.id, collection.id, owner.beach.id)
    ).resolves.not.toThrow();
  });

  it('auto mode: adds publish-on-add and consume through the gate; parked history stays forbidden', async () => {
    const owner = await setupShareUser('amc-auto-o');
    const viewer = await setupShareUser('amc-auto-v');
    const stay = await fileNodeService.createFile(owner.root.id, 'stay.jpg');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'AMC auto',
    });
    await collectionsService.addItems(owner.user.id, collection.id, [owner.beach.id]);
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: viewer.user.id,
      role: 'viewer',
    });
    await collectionsService.updateCollection(owner.user.id, collection.id, {
      publishMode: 'auto',
    });
    await collectionsService.addItems(owner.user.id, collection.id, [stay.id]);

    // the auto-mode add starts published:true → consumable immediately
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, stay.id)
    ).resolves.not.toThrow();
    // the parked pre-switch row is NOT republished retroactively
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, owner.beach.id)
    ).rejects.toMatchObject({ message: 'forbidden' });
  });

  it('foreign-owned member is never consumable through a shared view (cross-leak parity)', async () => {
    const owner = await setupShareUser('amc-leak-o');
    const viewer = await setupShareUser('amc-leak-v');
    const carol = await setupShareUser('amc-leak-carol');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'AMC leak',
    });
    // carol's file, READ-granted to the OWNER and added as a member (the owner
    // can read it — the addItems rule); it stays foreign-owned.
    await grantTestPermissionByNodeId({
      userId: owner.user.id,
      fileNodeId: carol.beach.id,
      permission: 'read',
    });
    await collectionsService.addItems(owner.user.id, collection.id, [carol.beach.id]);
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: viewer.user.id,
      role: 'viewer',
    });
    await shareService.publish(owner.user.id, collection.id, [carol.beach.id], true);

    // grantee: the foreign row is never consumable through the collection
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, carol.beach.id)
    ).rejects.toMatchObject({ message: 'forbidden' });

    // the member view omits the row for the grantee entirely (parity)
    const view = await collectionsService.getItems(viewer.user.id, collection.id);
    expect(view.items.find((i) => i.nodeId === carol.beach.id)).toBeUndefined();

    // owner: readable via the file's own ACL → passes the pre-check
    await expect(
      shareService.assertMemberConsumable(owner.user.id, collection.id, carol.beach.id)
    ).resolves.not.toThrow();
  });

  it('zero-access/hidden/non-member/trashed collapse to the notFound masquerade', async () => {
    const owner = await setupShareUser('amc-masq-o');
    const viewer = await setupShareUser('amc-masq-v');
    const stranger = await setupShareUser('amc-masq-s');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'AMC masq',
    });
    await collectionsService.addItems(owner.user.id, collection.id, [owner.beach.id]);
    await shareService.publish(owner.user.id, collection.id, [owner.beach.id], true);
    await shareService.grant(owner.user.id, collection.id, {
      granteeId: viewer.user.id,
      role: 'viewer',
    });

    // non-member nodeId behind an accessible collection → notFound (nothing there)
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, viewer.beach.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });

    // zero-access requester → notFound
    await expect(
      shareService.assertMemberConsumable(stranger.user.id, collection.id, owner.beach.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });

    // hidden-flag grantee → notFound (read-side visibility rule)
    await collectionsStore.setVisible(viewer.user.id, collection.id, true);
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, owner.beach.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
    await collectionsStore.setVisible(viewer.user.id, collection.id, false);

    // trashed member (hidden from every view) → notFound
    await dbRun("UPDATE file_nodes SET deleted_at = datetime('now') WHERE id = ?", [
      owner.beach.id,
    ]);
    await expect(
      shareService.assertMemberConsumable(viewer.user.id, collection.id, owner.beach.id)
    ).rejects.toMatchObject({ message: 'notFound', status: 404 });
  });

  it('owner requester on a member their own file ACL cannot read → forbidden', async () => {
    const owner = await setupShareUser('amc-unread-o');
    const carol = await setupShareUser('amc-unread-carol');
    const { collection } = await collectionsService.createCollection(owner.user.id, {
      name: 'AMC unread',
    });
    // store-level row WITHOUT the addItems ACL gate — a vanished/never-granted member
    await collectionsStore.addItem(
      collection.id,
      carol.beach.id,
      owner.user.id,
      {},
      {
        actor: owner.user.id,
      }
    );

    await expect(
      shareService.assertMemberConsumable(owner.user.id, collection.id, carol.beach.id)
    ).rejects.toMatchObject({ message: 'forbidden' });
  });

  it('permission stores and caches are never written by the pre-check (invariant 1 seam)', async () => {
    // grep-gate companion: the module must hold no permissionStore import — the
    // ACL reads ride aclService.checkFilePermission only.
    const src = require('fs').readFileSync(require.resolve('../shareService'), 'utf8');
    expect(src).not.toMatch(/permissionStore/);
    expect(src).not.toMatch(/CacheAdapter|operationProgress/);
  });
});
