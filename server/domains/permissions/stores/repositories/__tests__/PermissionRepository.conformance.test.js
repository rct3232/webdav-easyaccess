'use strict';

/**
 * PermissionRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 *
 * Exercises the storage layer through the repository interface only; the
 * facade (cache, existence-index invalidation, meetsRank policy) is covered by
 * the existing store/route suites.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createPermissionRepository = require('../PermissionRepository');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('PermissionRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;
  let userA;
  let userB;

  const uniqueName = (p) => `${p}-${Date.now()}-${++seq}`;

  const createUser = async (username) => {
    const User = require('@server/models/User');
    const u = await User.create(username, `${username}@conf.test`, 'pw', false);
    return u;
  };

  const createDir = async (name, parentId = null) =>
    createTestFileNode({ name, type: 'directory', parentId });

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createPermissionRepository(storage.getExecutor());
    userA = await createUser(uniqueName('perm-a'));
    userB = await createUser(uniqueName('perm-b'));
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('share permission upsert/delete + ancestor inheritance lookup', async () => {
    const dir = await createDir(uniqueName('share-dir'));
    const file = await createTestFileNode({ name: uniqueName('share-file'), parentId: dir.nodeId });

    await repo.upsertSharePermission('share-token-1', dir.nodeId);
    const direct = await repo.findSharePermissionForNode('share-token-1', dir.nodeId);
    expect(direct).toMatchObject({ permission: 'read' });

    // Grant lives on the ancestor; querying the descendant resolves it.
    const inherited = await repo.findSharePermissionForNode('share-token-1', file.nodeId);
    expect(inherited).not.toBeNull();

    await repo.deleteSharePermission('share-token-1');
    await expect(repo.findSharePermissionForNode('share-token-1', file.nodeId)).resolves.toBeNull();
  });

  it('path permission upsert/upsert-overwrite/delete + shallowest-ancestor lookup', async () => {
    const root = await createDir(uniqueName('path-root'));
    const child = await createDir(uniqueName('path-child'), root.nodeId);

    await repo.upsertPathPermission(userA.id, root.nodeId, PERMISSIONS.READ);
    let found = await repo.findPathPermissionForNode(userA.id, root.nodeId);
    expect(found.permission).toBe(PERMISSIONS.READ);

    await repo.upsertPathPermission(userA.id, root.nodeId, PERMISSIONS.WRITE);
    found = await repo.findPathPermissionForNode(userA.id, root.nodeId);
    expect(found.permission).toBe(PERMISSIONS.WRITE);

    // Inherited: grant on root resolves for the child.
    found = await repo.findPathPermissionForNode(userA.id, child.nodeId);
    expect(found.permission).toBe(PERMISSIONS.WRITE);

    await repo.deletePathPermission(userA.id, root.nodeId);
    await expect(repo.findPathPermissionForNode(userA.id, child.nodeId)).resolves.toBeNull();
  });

  it('file permission CRUD + list + user-id listing', async () => {
    const file = await createTestFileNode({ name: uniqueName('fperm') });
    await repo.upsertFilePermission(userA.id, file.nodeId, PERMISSIONS.WRITE);

    await expect(repo.findFilePermission(userA.id, file.nodeId)).resolves.toBe(PERMISSIONS.WRITE);
    const files = await repo.listFilePermissions(userA.id);
    expect(files.some((r) => r.file_node_id === Number(file.nodeId))).toBe(true);

    const userIds = await repo.listPermissionUserIds();
    expect(userIds.map(String)).toContain(String(userA.id));

    await repo.deleteFilePermission(userA.id, file.nodeId);
    await expect(repo.findFilePermission(userA.id, file.nodeId)).resolves.toBeNull();
  });

  it('listPathAndFilePermissions reports kind per table', async () => {
    const dir = await createDir(uniqueName('kind-dir'));
    const file = await createTestFileNode({ name: uniqueName('kind-file') });
    await repo.upsertPathPermission(userA.id, dir.nodeId, PERMISSIONS.READ);
    await repo.upsertFilePermission(userA.id, file.nodeId, PERMISSIONS.READ);

    const rows = await repo.listPathAndFilePermissions(userA.id);
    expect(rows.some((r) => r.kind === 'directory' && r.file_node_id === Number(dir.nodeId))).toBe(true);
    expect(rows.some((r) => r.kind === 'file' && r.file_node_id === Number(file.nodeId))).toBe(true);
  });

  it('deleteAllUserPermissions clears path and file grants', async () => {
    const dir = await createDir(uniqueName('delall-dir'));
    const file = await createTestFileNode({ name: uniqueName('delall-file') });
    await repo.upsertPathPermission(userB.id, dir.nodeId, PERMISSIONS.READ);
    await repo.upsertFilePermission(userB.id, file.nodeId, PERMISSIONS.READ);

    await repo.deleteAllUserPermissions(userB.id);
    await expect(repo.findPathPermissionForNode(userB.id, dir.nodeId)).resolves.toBeNull();
    await expect(repo.findFilePermission(userB.id, file.nodeId)).resolves.toBeNull();
  });

  it('findPathPermissionsForNode returns the actual grant-anchor node (not the queried node)', async () => {
    // Regression lock for the drift found in the D7 audit: the plural query must
    // expose p.file_node_id (the ancestor where the grant lives), not the
    // queried descendant id.
    const root = await createDir(uniqueName('grants-root'));
    const child = await createDir(uniqueName('grants-child'), root.nodeId);
    const leaf = await createTestFileNode({ name: uniqueName('grants-leaf'), parentId: child.nodeId });

    await repo.upsertPathPermission(userA.id, root.nodeId, PERMISSIONS.READ);

    const rows = await repo.findPathPermissionsForNode(userA.id, leaf.nodeId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      // Each returned anchor is a real ancestor grant row, distinct from leaf
      // unless the grant is on the leaf itself.
      expect(row.file_node_id).not.toBe(Number(leaf.nodeId));
      expect(row.file_node_id).toBe(Number(root.nodeId));
      expect(row.permission).toBe(PERMISSIONS.READ);
    }
  });

  it('getSharedPermissions excludes the user home subtree when a home root is given', async () => {
    const homeRoot = await createDir(uniqueName('home-root'));
    await repo.upsertPathPermission(userA.id, homeRoot.nodeId, PERMISSIONS.WRITE);
    const outside = await createDir(uniqueName('shared-outside'));
    await repo.upsertPathPermission(userA.id, outside.nodeId, PERMISSIONS.WRITE);

    const excluded = await repo.listSharedWithUser(userA.id, homeRoot.nodeId);
    const idsExcluded = excluded.shared.map((r) => r.file_node_id);
    expect(idsExcluded).not.toContain(Number(homeRoot.nodeId));
    expect(idsExcluded).toContain(Number(outside.nodeId));

    const included = await repo.listSharedWithUser(userA.id, null);
    const idsIncluded = included.shared.map((r) => r.file_node_id);
    expect(idsIncluded).toContain(Number(homeRoot.nodeId));
  });

  it('A9: listSharedWithUser EXCLUDES trashed nodes (grant row survives, listing join is gated)', async () => {
    const trashed = await createDir(uniqueName('shared-trashed'));
    const live = await createDir(uniqueName('shared-live'));
    await repo.upsertPathPermission(userA.id, trashed.nodeId, PERMISSIONS.WRITE);
    await repo.upsertPathPermission(userA.id, live.nodeId, PERMISSIONS.WRITE);

    const { dbRun } = require('@server/test-utils');
    await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [
      trashed.nodeId,
    ]);

    const res = await repo.listSharedWithUser(userA.id, null);
    const ids = res.shared.map((r) => r.file_node_id);
    expect(ids).not.toContain(Number(trashed.nodeId));
    expect(ids).toContain(Number(live.nodeId));

    // The grant row itself SURVIVES the trash (read-gated, not revoked).
    await expect(repo.findPathPermissionForNode(userA.id, trashed.nodeId)).resolves.toMatchObject({
      permission: PERMISSIONS.WRITE,
    });
  });

  it('deleteOwnSubtreePermissions removes depth>0 rows but preserves the home-root grant', async () => {
    const homeRoot = await createDir(uniqueName('own-home'));
    const inside = await createDir(uniqueName('own-inside'), homeRoot.nodeId);

    await repo.upsertPathPermission(userB.id, homeRoot.nodeId, PERMISSIONS.ADMIN);
    await repo.upsertPathPermission(userB.id, inside.nodeId, PERMISSIONS.READ);

    const res = await repo.deleteOwnSubtreePermissions(userB.id, homeRoot.nodeId);
    expect(res.removedPaths).toBeGreaterThanOrEqual(1);

    // Home-root grant (depth 0) survives. The explicit descendant READ row is
    // gone, so the descendant now resolves through the home-root ADMIN grant
    // (depth 1 = inherited ownership) instead of its own direct row.
    await expect(repo.findPathPermissionForNode(userB.id, homeRoot.nodeId)).resolves.toMatchObject({
      permission: PERMISSIONS.ADMIN,
      depth: 0,
    });
    const inherited = await repo.findPathPermissionForNode(userB.id, inside.nodeId);
    expect(inherited).toMatchObject({ permission: PERMISSIONS.ADMIN, depth: 1 });
  });

  it('deleteUserSubtreePermissions also removes the subtree-root row', async () => {
    const homeRoot = await createDir(uniqueName('st-home'));
    const inside = await createDir(uniqueName('st-inside'), homeRoot.nodeId);

    await repo.upsertPathPermission(userB.id, homeRoot.nodeId, PERMISSIONS.ADMIN);
    await repo.upsertPathPermission(userB.id, inside.nodeId, PERMISSIONS.READ);

    const res = await repo.deleteUserSubtreePermissions(userB.id, homeRoot.nodeId);
    expect(res.removedPaths).toBeGreaterThanOrEqual(2);

    await expect(repo.findPathPermissionForNode(userB.id, homeRoot.nodeId)).resolves.toBeNull();
    await expect(repo.findPathPermissionForNode(userB.id, inside.nodeId)).resolves.toBeNull();
  });
});
