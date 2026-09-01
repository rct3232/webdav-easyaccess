/**
 * permissionStore tests — nodeId-based API.
 * Verifies grant, revoke, checkPermission via closure table inheritance,
 * share permissions, and effective permission resolution using file_node_id references.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

// Helper: build a mock SQLite client that tracks queries in-memory
function createMockSQLiteClient() {
  const state = {
    userPaths: [], // { user_id, file_node_id, permission, updated_at }
    userFiles: [], // { user_id, file_node_id, permission, updated_at }
    shares: [], // { token, file_node_id, permission, updated_at }
    ancestors: [], // { ancestor_id, descendant_id, depth }
    files: [], // { id, parent_id, name, type } — file_nodes table
  };

  const queries = [];

  // Upsert (INSERT ... ON CONFLICT ... DO UPDATE) into a row collection.
  function upsertInto(rows, predicate, row) {
    const idx = rows.findIndex(predicate);
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
    return { rows: [row], changes: 1, lastID: row.file_node_id };
  }

  // Simulate closure-table inheritance at the data level. Production resolves
  // this with `JOIN node_ancestors ... ORDER BY a.depth ASC LIMIT 1`; here the
  // nearest ancestor (smallest depth) holding a matching permission wins.
  function nearestAncestorPermission(permRows, descendantId, ownerKey, ownerValue) {
    const ordered = state.ancestors
      .filter((a) => a.descendant_id === descendantId)
      .sort((a, b) => a.depth - b.depth);
    for (const anc of ordered) {
      const row = permRows.find(
        (r) => r.file_node_id === anc.ancestor_id && r[ownerKey] === ownerValue
      );
      if (row) return { permission: row.permission, depth: anc.depth };
    }
    return null;
  }

  // Route by WHICH OPERATION/TABLE the statement targets, using the params —
  // not by re-implementing the store's SQL branching via full-text matching.
  function resolveQuerySync(sql, params = []) {
    const s = String(sql);
    queries.push({ sql: s, params });

    const targetsUserPaths = s.includes('permissions_user_paths');
    const targetsUserFiles = s.includes('permissions_user_files');
    const targetsShares = s.includes('permissions_shares');
    const joinsAncestors = s.includes('node_ancestors');

    // INSERT ... ON CONFLICT upserts
    if (s.startsWith('INSERT') && targetsUserPaths) {
      return upsertInto(
        state.userPaths,
        (r) => r.user_id === params[0] && r.file_node_id === params[1],
        {
          user_id: params[0],
          file_node_id: params[1],
          permission: params[2],
          updated_at: new Date(),
        }
      );
    }
    if (s.startsWith('INSERT') && targetsUserFiles) {
      return upsertInto(
        state.userFiles,
        (r) => r.user_id === params[0] && r.file_node_id === params[1],
        {
          user_id: params[0],
          file_node_id: params[1],
          permission: params[2],
          updated_at: new Date(),
        }
      );
    }
    if (s.startsWith('INSERT') && targetsShares) {
      return upsertInto(state.shares, (r) => r.token === params[0], {
        token: params[0],
        file_node_id: params[1],
        permission: params[2],
        updated_at: new Date(),
      });
    }

    // DELETE ... WHERE user_id = ? AND file_node_id IN (SELECT ... node_ancestors ...)
    // removeOwnSubtreePermissions uses `AND depth > 0` (preserves home-root);
    // revokeUserSubtreePermissions has no depth filter (revokes root too).
    if (s.startsWith('DELETE') && s.includes('node_ancestors')) {
      const ownRootId = params[1];
      const depthFilter = s.includes('depth > 0');
      const ownDescendantIds = new Set(
        state.ancestors
          .filter((a) => a.ancestor_id === ownRootId && (depthFilter ? a.depth > 0 : true))
          .map((a) => a.descendant_id)
      );
      const target = targetsUserPaths ? 'userPaths' : 'userFiles';
      const before = state[target].length;
      state[target] = state[target].filter(
        (r) => !(r.user_id === params[0] && ownDescendantIds.has(r.file_node_id))
      );
      return { rows: [], changes: before - state[target].length };
    }

    // DELETE — single row when two params (user_id + file_node_id), else all rows for the user/token
    if (s.startsWith('DELETE') && targetsUserPaths) {
      state.userPaths =
        params.length > 1
          ? state.userPaths.filter(
              (r) => !(r.user_id === params[0] && r.file_node_id === params[1])
            )
          : state.userPaths.filter((r) => r.user_id !== params[0]);
      return { rows: [], changes: 1 };
    }
    if (s.startsWith('DELETE') && targetsUserFiles) {
      state.userFiles =
        params.length > 1
          ? state.userFiles.filter(
              (r) => !(r.user_id === params[0] && r.file_node_id === params[1])
            )
          : state.userFiles.filter((r) => r.user_id !== params[0]);
      return { rows: [], changes: 1 };
    }
    if (s.startsWith('DELETE') && targetsShares) {
      state.shares = state.shares.filter((r) => r.token !== params[0]);
      return { rows: [], changes: 1 };
    }

    // SELECT ... JOIN file_nodes ... NOT IN (SELECT descendant_id ...) — getSharedPermissions
    if (s.includes('file_nodes') && s.includes('NOT IN') && s.includes('node_ancestors')) {
      const ownRootId = params[1];
      const ownDescendantIds = new Set(
        state.ancestors.filter((a) => a.ancestor_id === ownRootId).map((a) => a.descendant_id)
      );
      const rows = (targetsUserPaths ? state.userPaths : state.userFiles)
        .filter((r) => r.user_id === params[0] && !ownDescendantIds.has(r.file_node_id))
        .map((r) => {
          const node = state.files.find((f) => f.id === r.file_node_id);
          return {
            file_node_id: r.file_node_id,
            permission: r.permission,
            name: node ? node.name : null,
            type: node ? node.type : null,
          };
        });
      return { rows };
    }

    // SELECT with ancestor JOIN — closure inheritance simulated at the data level
    if (joinsAncestors && targetsUserPaths) {
      const res = nearestAncestorPermission(state.userPaths, params[0], 'user_id', params[1]);
      return res ? { rows: [res] } : { rows: [] };
    }
    if (joinsAncestors && targetsShares) {
      const res = nearestAncestorPermission(state.shares, params[0], 'token', params[1]);
      return res ? { rows: [res] } : { rows: [] };
    }

    // SELECT from permissions_user_files WHERE user_id AND file_node_id (getFilePermission)
    if (targetsUserFiles && params.length > 1) {
      const row = state.userFiles.find(
        (r) => r.user_id === params[0] && r.file_node_id === params[1]
      );
      return { rows: row ? [{ permission: row.permission }] : [] };
    }

    // SELECT ... FROM permissions_user_paths/user_files WHERE user_id (getUserPermissions / getUserFilePermissions)
    if (targetsUserPaths) {
      const rows = state.userPaths.filter((r) => r.user_id === params[0]);
      return {
        rows: rows.map((r) => ({
          file_node_id: r.file_node_id,
          permission: r.permission,
          updated_at: r.updated_at,
        })),
      };
    }
    if (targetsUserFiles) {
      const rows = state.userFiles.filter((r) => r.user_id === params[0]);
      return {
        rows: rows.map((r) => ({
          file_node_id: r.file_node_id,
          permission: r.permission,
          updated_at: r.updated_at,
        })),
      };
    }

    // SELECT from permissions_shares WHERE token
    if (targetsShares) {
      const row = state.shares.find((r) => r.token === params[0]);
      return {
        rows: row
          ? [
              {
                file_node_id: row.file_node_id,
                permission: row.permission,
                updated_at: row.updated_at,
              },
            ]
          : [],
      };
    }

    // SELECT DISTINCT user_id FROM (paths UNION files) — listPermissionUserIds
    if (s.includes('permission_user_ids')) {
      const userIds = new Set([
        ...state.userPaths.map((r) => r.user_id),
        ...state.userFiles.map((r) => r.user_id),
      ]);
      return { rows: [...userIds].map((u) => ({ user_id: u })) };
    }

    return { rows: [] };
  }

  async function query(sql, params = []) {
    return resolveQuerySync(sql, params);
  }

  async function run(sql, params = []) {
    return resolveQuerySync(sql, params);
  }

  const allCallback = (sql, params, cb) => {
    try {
      const result = resolveQuerySync(sql, params);
      cb(null, result.rows || []);
    } catch (err) {
      cb(err);
    }
  };

  return { query, run, state, queries, all: allCallback, resolveSync: resolveQuerySync };
}

describe('permissionStore (nodeId)', () => {
  let mockClient;
  let permissionStore;
  let userId = 1;

  beforeEach(() => {
    jest.resetModules();
    mockClient = createMockSQLiteClient();

    const { state } = mockClient;
    // Seed file_nodes: root (id=1), subdir (id=2), file (id=3)
    state.files = [
      { id: 1, parent_id: null, name: 'root', type: 'directory' },
      { id: 2, parent_id: 1, name: 'subdir', type: 'directory' },
      { id: 3, parent_id: 2, name: 'document.txt', type: 'file' },
    ];

    // Seed node_ancestors closure table
    state.ancestors = [
      // Root is ancestor of everything
      { ancestor_id: 1, descendant_id: 1, depth: 0 },
      { ancestor_id: 1, descendant_id: 2, depth: 1 },
      { ancestor_id: 1, descendant_id: 3, depth: 2 },
      // Subdir is ancestor of itself and file
      { ancestor_id: 2, descendant_id: 2, depth: 0 },
      { ancestor_id: 2, descendant_id: 3, depth: 1 },
      // File is ancestor of itself
      { ancestor_id: 3, descendant_id: 3, depth: 0 },
    ];

    jest.doMock('../../../../store/storage', () => ({
      getBackend: () => 'sqlite',
      isSqliteBackend: () => true,
      isPostgresqlBackend: () => false,
      withSqliteTransaction: async (cb) => {
        // For transactional writes, call query on the client directly
        const txClient = {
          query: async (sql, params) => mockClient.query(sql, params),
        };
        return await cb(txClient);
      },
      sqliteRun: async (sql, params) => mockClient.run(sql, params),
      getSqliteConnection: () => ({
        all: (sql, params, cb) => {
          const result = mockClient.resolveSync(sql, params);
          cb(null, result.rows || []);
        },
        run: async (sql, params) => {
          return mockClient.run(sql, params);
        },
        query: async (sql, params) => mockClient.query(sql, params),
      }),
    }));

    jest.doMock('../../../../store/locks', () => {
      const { createLockManagerMock } = require('@testing/mocks/storeMocks');
      return createLockManagerMock();
    });

    jest.doMock('../permissionExistenceIndex', () => ({
      invalidateExistenceIndexForAclMutation: jest.fn(),
    }));

    jest.doMock('../../../../store/userStore', () => {
      const { createUserStoreMock } = require('@testing/mocks/storeMocks');
      return createUserStoreMock({
        findById: jest.fn((id) => ({
          id,
          username: `user${id}`,
          email: `u${id}@test.com`,
          is_admin: false,
        })),
      });
    });

    jest.isolateModules(() => {
      permissionStore = require('../permissionStore');
    });
  });

  // V1: grant directory permission
  it('V1: grants directory permission for nodeId', async () => {
    const result = await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    expect(result).toMatchObject({ userId, nodeId: 1, permission: PERMISSIONS.READ });
    const perms = await permissionStore.getUserPermissions(userId);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ file_node_id: 1, permission: PERMISSIONS.READ });
  });

  // V2: grant duplicate with higher permission → upsert replaces
  it('V2: grants duplicate with higher permission (upsert)', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    expect(await permissionStore.getUserPermissions(userId)).toHaveLength(1);

    await permissionStore.grant(userId, 1, PERMISSIONS.WRITE);
    const after = await permissionStore.getUserPermissions(userId);
    expect(after).toHaveLength(1);
    expect(after[0].permission).toBe(PERMISSIONS.WRITE);
  });

  // V3: grant file permission
  it('V3: grants file permission for fileNodeId', async () => {
    const result = await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);
    expect(result).toMatchObject({ userId, fileNodeId: 3, permission: PERMISSIONS.READ });
    const perms = await permissionStore.getUserFilePermissions(userId);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ file_node_id: 3, permission: PERMISSIONS.READ });
  });

  // V4: revoke directory permission
  it('V4: revokes directory permission', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    expect(await permissionStore.getUserPermissions(userId)).toHaveLength(1);

    await permissionStore.revoke(userId, 1);
    expect(await permissionStore.getUserPermissions(userId)).toHaveLength(0);
    expect(await permissionStore.checkPermission(userId, 1, PERMISSIONS.READ)).toBe(false);
  });

  // V5: getUserPermissions returns nodeId-based results
  it('V5: getUserPermissions returns { file_node_id, permission }', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    const perms = await permissionStore.getUserPermissions(userId);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ file_node_id: 1, permission: PERMISSIONS.READ });
  });

  // V6: checkPermission direct match
  it('V6: checkPermission with direct nodeId match returns true', async () => {
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);
    const ok = await permissionStore.checkPermission(userId, 2, PERMISSIONS.READ);
    expect(ok).toBe(true);
  });

  // V7: checkPermission ancestor inheritance via closure table
  it('V7: checkPermission inherits from ancestor', async () => {
    // Grant on root (id=1), should apply to file node id=3 via ancestors
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    const ok = await permissionStore.checkPermission(userId, 3, PERMISSIONS.READ);
    expect(ok).toBe(true);
  });

  // V8: grantSharePermission with nodeId
  it('V8: grants share permission for nodeId', async () => {
    const token = 'share-token-abc';
    await permissionStore.grantSharePermission(token, 1);
    expect(await permissionStore.checkSharePermission(token, 1, PERMISSIONS.READ)).toBe(true);
    expect(await permissionStore.checkSharePermission(token, 2, PERMISSIONS.READ)).toBe(true);
  });

  // V9: checkSharePermission with ancestor inheritance
  it('V9: share applies to descendant node', async () => {
    const token = 'share-token-desc';
    await permissionStore.grantSharePermission(token, 2);
    // File id=3 is descendant of dir id=2
    const ok = await permissionStore.checkSharePermission(token, 3);
    expect(ok).toBe(true);
  });

  // V11: getEffectivePermission — file overrides folder
  it('V11: file-level permission overrides ancestor directory', async () => {
    // Grant READ on parent dir (id=2), WRITE directly on file (id=3)
    await permissionStore.grant(userId, 2, PERMISSIONS.READ);
    await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.WRITE);

    const eff = await permissionStore.getEffectivePermission(userId, 3);
    expect(eff).toBe(PERMISSIONS.WRITE);
  });

  // V12: getSharedPermissions excludes own subtree and returns name/type
  it('V12: getSharedPermissions excludes own subtree and returns name/type', async () => {
    const { state } = mockClient;
    // home root = 1; external dir = 7 (not under home); external file = 8 (under 7)
    state.files.push(
      { id: 7, parent_id: null, name: 'external', type: 'directory' },
      { id: 8, parent_id: 7, name: 'doc.txt', type: 'file' }
    );
    state.ancestors.push(
      { ancestor_id: 7, descendant_id: 7, depth: 0 },
      { ancestor_id: 7, descendant_id: 8, depth: 1 },
      { ancestor_id: 8, descendant_id: 8, depth: 0 }
    );

    // Own subtree rows (home root id=1, descendant id=2) and file id=3
    await permissionStore.grant(userId, 1, PERMISSIONS.ADMIN);
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);
    await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);
    // External grants
    await permissionStore.grant(userId, 7, PERMISSIONS.READ);
    await permissionStore.grantFilePermission(userId, 8, PERMISSIONS.WRITE);

    const shared = await permissionStore.getSharedPermissions(userId, 1);

    expect(shared).toHaveLength(2);
    expect(shared).toEqual(
      expect.arrayContaining([
        { file_node_id: 7, name: 'external', permission: PERMISSIONS.READ, type: 'directory' },
        { file_node_id: 8, name: 'doc.txt', permission: PERMISSIONS.WRITE, type: 'file' },
      ])
    );
  });

  // V13: removeOwnSubtreePermissions removes descendant self-grants, keeps home-root
  it('V13: removeOwnSubtreePermissions removes descendant self-grants, keeps home-root', async () => {
    const { state } = mockClient;
    state.files.push({ id: 7, parent_id: null, name: 'external', type: 'directory' });
    state.ancestors.push({ ancestor_id: 7, descendant_id: 7, depth: 0 });

    // Own rows: home root (1), descendants (2, file 3)
    await permissionStore.grant(userId, 1, PERMISSIONS.ADMIN);
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);
    await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);
    // External row (kept)
    await permissionStore.grant(userId, 7, PERMISSIONS.READ);

    const result = await permissionStore.removeOwnSubtreePermissions(userId, 1);

    expect(result).toEqual({ removedPaths: 1, removedFiles: 1 });

    const remaining = await permissionStore.getUserPermissions(userId);
    const remainingIds = remaining.map((r) => r.file_node_id);
    expect(remainingIds).toContain(1); // home-root admin preserved
    expect(remainingIds).toContain(7); // external grant preserved
    expect(remainingIds).not.toContain(2);
    expect(remainingIds).not.toContain(3);
  });

  // V14: getSharedPermissions — no cross-table duplicate for the same node
  it('V14: getSharedPermissions never returns the same node twice across the paths and files tables', async () => {
    const { state } = mockClient;
    // home root = 1; external dir = 7; external file = 8 (under 7)
    state.files.push(
      { id: 7, parent_id: null, name: 'external', type: 'directory' },
      { id: 8, parent_id: 7, name: 'doc.txt', type: 'file' }
    );
    state.ancestors.push(
      { ancestor_id: 7, descendant_id: 7, depth: 0 },
      { ancestor_id: 7, descendant_id: 8, depth: 1 },
      { ancestor_id: 8, descendant_id: 8, depth: 0 }
    );

    // Genuine directory grant (paths table)
    await permissionStore.grant(userId, 7, PERMISSIONS.READ);
    // The same file node 8 is granted through BOTH APIs: a directory-level row
    // (permissions_user_paths) and a file-level row (permissions_user_files).
    await permissionStore.grant(userId, 8, PERMISSIONS.READ);
    await permissionStore.grantFilePermission(userId, 8, PERMISSIONS.WRITE);

    const shared = await permissionStore.getSharedPermissions(userId, 1);

    const ids = shared.map((r) => r.file_node_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(shared.filter((r) => r.file_node_id === 8)).toHaveLength(1);
    expect(shared).toHaveLength(2);
  });

  // V15: checkPermission — depth-0 direct grant beats a weaker inherited depth-N grant
  it('V15: checkPermission — direct depth-0 grant beats a weaker inherited depth-N grant', async () => {
    // READ inherited from root (depth 2 for node 3), WRITE granted directly on subdir (depth 0 for node 2)
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);

    // Direct grant on node 2 is authoritative: WRITE wins over the inherited READ from root
    expect(await permissionStore.checkPermission(userId, 2, PERMISSIONS.WRITE)).toBe(true);
    // The weaker inherited READ must not grant anything above WRITE on the node itself
    expect(await permissionStore.checkPermission(userId, 2, PERMISSIONS.ADMIN)).toBe(false);
    // Closest ancestor grant for node 3 is subdir WRITE (depth 1), not root READ (depth 2)
    expect(await permissionStore.checkPermission(userId, 3, PERMISSIONS.WRITE)).toBe(true);
  });

  // V16: revoke — immediate reflection and row removal at the store level
  it('V16: revoke reflects immediately — checkPermission false and getUserPermissions drops the revoked row', async () => {
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);
    await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);

    await permissionStore.revoke(userId, 2);

    expect(await permissionStore.checkPermission(userId, 2, PERMISSIONS.READ)).toBe(false);
    const remaining = await permissionStore.getUserPermissions(userId);
    const remainingIds = remaining.map((r) => r.file_node_id);
    expect(remainingIds).not.toContain(2);
    expect(remainingIds).toContain(3);

    // file-level row untouched by the directory revoke
    const filePerms = await permissionStore.getUserFilePermissions(userId);
    expect(filePerms.map((r) => r.file_node_id)).toEqual([3]);
  });

  // V17: grant upsert — read→write→admin keeps a single row; admin preserved on read
  it('V17: grant upsert read→write→admin keeps a single row and admin is preserved on read', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    await permissionStore.grant(userId, 1, PERMISSIONS.WRITE);
    await permissionStore.grant(userId, 1, PERMISSIONS.ADMIN);

    expect(mockClient.state.userPaths).toHaveLength(1);

    const perms = await permissionStore.getUserPermissions(userId);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ file_node_id: 1, permission: PERMISSIONS.ADMIN });

    expect(await permissionStore.checkPermission(userId, 1, PERMISSIONS.ADMIN)).toBe(true);
    expect(await permissionStore.checkPermission(userId, 3, PERMISSIONS.ADMIN)).toBe(true);
  });

  // V18: revokeUserSubtreePermissions removes rows on the subtree root AND all
  // descendants (depth >= 0) from both tables, preserving rows outside.
  it('V18: revokeUserSubtreePermissions removes rows on subtree root + descendants, keeps external rows', async () => {
    const { state } = mockClient;
    state.files.push({ id: 7, parent_id: null, name: 'external', type: 'directory' });
    state.ancestors.push({ ancestor_id: 7, descendant_id: 7, depth: 0 });

    // Own rows: home root (1), descendants (2, file 3) — INCLUDING the root itself
    await permissionStore.grant(userId, 1, PERMISSIONS.ADMIN);
    await permissionStore.grant(userId, 2, PERMISSIONS.WRITE);
    await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);
    // External row (kept)
    await permissionStore.grant(userId, 7, PERMISSIONS.READ);

    const result = await permissionStore.revokeUserSubtreePermissions(userId, 1);

    expect(result).toEqual({ removedPaths: 2, removedFiles: 1 });

    const remaining = await permissionStore.getUserPermissions(userId);
    const remainingIds = remaining.map((r) => r.file_node_id);
    expect(remainingIds).not.toContain(1); // home-root row revoked too (depth 0)
    expect(remainingIds).not.toContain(2);
    expect(remainingIds).toContain(7); // external grant preserved

    const remainingFiles = await permissionStore.getUserFilePermissions(userId);
    expect(remainingFiles.map((r) => r.file_node_id)).not.toContain(3);
  });
});
