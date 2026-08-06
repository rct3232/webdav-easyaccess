/**
 * permissionStore tests — nodeId-based API.
 * Verifies grant, revoke, checkPermission via closure table inheritance,
 * share permissions, and effective permission resolution using file_node_id references.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

// Helper: build a mock SQLite client that tracks queries in-memory
function createMockSQLiteClient() {
  const state = {
    userPaths: [],     // { user_id, file_node_id, permission, updated_at }
    userFiles: [],     // { user_id, file_node_id, permission, updated_at }
    shares: [],        // { token, file_node_id, permission, updated_at }
    ancestors: [],     // { ancestor_id, descendant_id, depth }
    files: [],         // { id, parent_id, name, type } — file_nodes table
  };

  const queries = [];

  function normalize(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  function resolveQuerySync(sql, params = []) {
    const normed = normalize(sql);
    queries.push({ sql: normed, params });

    // INSERT INTO permissions_user_paths ... ON CONFLICT ... DO UPDATE
    if (normed.includes('INSERT INTO permissions_user_paths') && normed.includes('ON CONFLICT')) {
      const [userId, fileNodeId, permission] = params;
      const idx = state.userPaths.findIndex(
        r => r.user_id === userId && r.file_node_id === fileNodeId
      );
      const row = { user_id: userId, file_node_id: fileNodeId, permission, updated_at: new Date() };
      if (idx >= 0) state.userPaths[idx] = row;
      else state.userPaths.push(row);
      return { rows: [row], changes: 1, lastID: row.file_node_id };
    }

    // INSERT INTO permissions_user_paths ... (no conflict clause — legacy bulk insert pattern, unused)
    if (normed.includes('INSERT INTO permissions_user_paths') && !normed.includes('ON CONFLICT')) {
      const [userId, fileNodeId, permission] = params;
      state.userPaths.push({ user_id: userId, file_node_id: fileNodeId, permission, updated_at: new Date() });
      return { changes: 1 };
    }

    // INSERT INTO permissions_user_files ... ON CONFLICT ... DO UPDATE
    if (normed.includes('INSERT INTO permissions_user_files') && normed.includes('ON CONFLICT')) {
      const [userId, fileNodeId, permission] = params;
      const idx = state.userFiles.findIndex(
        r => r.user_id === userId && r.file_node_id === fileNodeId
      );
      const row = { user_id: userId, file_node_id: fileNodeId, permission, updated_at: new Date() };
      if (idx >= 0) state.userFiles[idx] = row;
      else state.userFiles.push(row);
      return { rows: [row], changes: 1, lastID: row.file_node_id };
    }

    // INSERT INTO permissions_user_files ... (no conflict clause — legacy bulk insert pattern, unused)
    if (normed.includes('INSERT INTO permissions_user_files') && !normed.includes('ON CONFLICT')) {
      const [userId, fileNodeId, permission] = params;
      state.userFiles.push({ user_id: userId, file_node_id: fileNodeId, permission, updated_at: new Date() });
      return { changes: 1 };
    }

    // INSERT INTO permissions_shares ... ON CONFLICT ... DO UPDATE
    if (normed.includes('INSERT INTO permissions_shares') && normed.includes('ON CONFLICT')) {
      const [token, fileNodeId, permission] = params;
      const idx = state.shares.findIndex(r => r.token === token);
      const row = { token, file_node_id: fileNodeId, permission, updated_at: new Date() };
      if (idx >= 0) state.shares[idx] = row;
      else state.shares.push(row);
      return { rows: [row], changes: 1 };
    }

    // DELETE FROM permissions_user_paths WHERE user_id AND file_node_id (revoke single — more specific first)
    if (normed.includes('DELETE FROM permissions_user_paths') && normed.includes('file_node_id')) {
      const userId = params[0];
      const fileNodeId = params[1];
      state.userPaths = state.userPaths.filter(
        r => !(r.user_id === userId && r.file_node_id === fileNodeId)
      );
      return { rows: [], changes: 1 };
    }

    // DELETE FROM permissions_user_paths WHERE user_id (bulk delete all for user)
    if (normed.includes('DELETE FROM permissions_user_paths') && normed.includes('user_id')) {
      const userId = params[0];
      state.userPaths = state.userPaths.filter(r => r.user_id !== userId);
      return { rows: [], changes: 1 };
    }

    // DELETE FROM permissions_user_files WHERE user_id AND file_node_id (revoke single — more specific first)
    if (normed.includes('DELETE FROM permissions_user_files') && normed.includes('file_node_id')) {
      const userId = params[0];
      const fileNodeId = params[1];
      state.userFiles = state.userFiles.filter(
        r => !(r.user_id === userId && r.file_node_id === fileNodeId)
      );
      return { rows: [], changes: 1 };
    }

    // DELETE FROM permissions_user_files WHERE user_id (bulk delete all for user)
    if (normed.includes('DELETE FROM permissions_user_files') && normed.includes('user_id')) {
      const userId = params[0];
      state.userFiles = state.userFiles.filter(r => r.user_id !== userId);
      return { rows: [], changes: 1 };
    }

    // DELETE FROM permissions_shares WHERE token
    if (normed.includes('DELETE FROM permissions_shares') && normed.includes('token')) {
      const tokenVal = params[0];
      state.shares = state.shares.filter(r => r.token !== tokenVal);
      return { rows: [], changes: 1 };
    }

    // SELECT FROM permissions_user_paths WHERE user_id (no JOIN — listPermissionUserIds / getUserPermissions)
    if (normed.includes('SELECT') && normed.includes('FROM permissions_user_paths') && !normed.includes('node_ancestors')) {
      const userId = params[0];
      const rows = state.userPaths.filter(r => r.user_id === userId);
      return { rows: rows.map(r => ({ file_node_id: r.file_node_id, permission: r.permission, updated_at: r.updated_at })) };
    }

    // SELECT FROM permissions_user_files WHERE user_id (no JOIN)
    if (normed.includes('SELECT') && normed.includes('FROM permissions_user_files') && !normed.includes('node_ancestors')) {
      const userId = params[0];
      const rows = state.userFiles.filter(r => r.user_id === userId);
      return { rows: rows.map(r => ({ file_node_id: r.file_node_id, permission: r.permission, updated_at: r.updated_at })) };
    }

    // SELECT FROM permissions_user_files WHERE user_id AND file_node_id (getFilePermission)
    if (normed.includes('SELECT') && normed.includes('FROM permissions_user_files') && normed.includes('file_node_id')) {
      const userId = params[0];
      const fnodeId = params[1];
      const row = state.userFiles.find(r => r.user_id === userId && r.file_node_id === fnodeId);
      if (!row) return { rows: [] };
      return { rows: [{ permission: row.permission }] };
    }

    // SELECT FROM permissions_shares WHERE token (share lookup, no JOIN)
    if (normed.includes('SELECT') && normed.includes('FROM permissions_shares') && !normed.includes('node_ancestors')) {
      const tokenVal = params[0];
      const row = state.shares.find(r => r.token === tokenVal);
      if (!row) return { rows: [] };
      return { rows: [{ file_node_id: row.file_node_id, permission: row.permission, updated_at: row.updated_at }] };
    }

    // SELECT DISTINCT user_id FROM (SELECT ... UNION ...)  — listPermissionUserIds
    if (normed.includes('DISTINCT') && normed.includes('permission_user_ids')) {
      const userIds = new Set([
        ...state.userPaths.map(r => r.user_id),
        ...state.userFiles.map(r => r.user_id),
      ]);
      return { rows: [...userIds].map(u => ({ user_id: u })) };
    }

    // checkPermission via closure table JOIN node_ancestors + permissions_user_paths
    if (normed.includes('node_ancestors') && normed.includes('permissions_user_paths')) {
      const targetNodeId = params[0];
      const userId = params[1];
      for (const anc of state.ancestors) {
        if (anc.descendant_id !== targetNodeId) continue;
        const permRow = state.userPaths.find(
          r => r.file_node_id === anc.ancestor_id && r.user_id === userId
        );
        if (permRow) {
          return { rows: [{ permission: permRow.permission, depth: anc.depth }] };
        }
      }
      return { rows: [] };
    }

    // checkSharePermission via node_ancestors JOIN + permissions_shares
    if (normed.includes('node_ancestors') && normed.includes('permissions_shares')) {
      const targetNodeId = params[0];
      const tokenVal = params[1];
      for (const anc of state.ancestors) {
        if (anc.descendant_id !== targetNodeId) continue;
        const shareRow = state.shares.find(
          r => r.file_node_id === anc.ancestor_id && r.token === tokenVal
        );
        if (shareRow) {
          return { rows: [{ permission: shareRow.permission, depth: anc.depth }] };
        }
      }
      return { rows: [] };
    }

    // SELECT FROM file_nodes WHERE id = ?
    if (normed.includes('FROM file_nodes') && normed.includes('id')) {
      const nodeId = params[0];
      const row = state.files.find(f => f.id === nodeId);
      return { rows: row ? [{ ...row }] : [] };
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

    jest.doMock('../../../../store/locks', () => ({
      withLock: async (_name, fn) => fn(),
    }));

    jest.doMock('../permissionExistenceIndex', () => ({
      invalidateExistenceIndexForAclMutation: jest.fn(),
    }));

    jest.doMock('../../../../store/userStore', () => ({
      findById: jest.fn((id) => ({ id, username: `user${id}`, email: `u${id}@test.com`, is_admin: false })),
    }));

    jest.isolateModules(() => {
      permissionStore = require('../permissionStore');
    });
  });

  // V1: grant directory permission
  it('V1: grants directory permission for nodeId', async () => {
    const result = await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    expect(result).toBeDefined();
    const { state } = mockClient;
    const row = state.userPaths.find(r => r.user_id === userId && r.file_node_id === 1);
    expect(row).toBeDefined();
    expect(row.permission).toBe(PERMISSIONS.READ);
  });

  // V2: grant duplicate with higher permission → upsert replaces
  it('V2: grants duplicate with higher permission (upsert)', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    const before = mockClient.state.userPaths.filter(r => r.user_id === userId && r.file_node_id === 1).length;
    expect(before).toBe(1);

    await permissionStore.grant(userId, 1, PERMISSIONS.WRITE);
    const after = mockClient.state.userPaths.filter(r => r.user_id === userId && r.file_node_id === 1);
    expect(after).toHaveLength(1);
    expect(after[0].permission).toBe(PERMISSIONS.WRITE);
  });

  // V3: grant file permission
  it('V3: grants file permission for fileNodeId', async () => {
    const result = await permissionStore.grantFilePermission(userId, 3, PERMISSIONS.READ);
    expect(result).toBeDefined();
    const row = mockClient.state.userFiles.find(r => r.user_id === userId && r.file_node_id === 3);
    expect(row).toBeDefined();
    expect(row.permission).toBe(PERMISSIONS.READ);
  });

  // V4: revoke directory permission
  it('V4: revokes directory permission', async () => {
    await permissionStore.grant(userId, 1, PERMISSIONS.READ);
    expect(mockClient.state.userPaths.filter(r => r.file_node_id === 1)).toHaveLength(1);

    await permissionStore.revoke(userId, 1);
    expect(mockClient.state.userPaths.filter(r => r.file_node_id === 1)).toHaveLength(0);
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
    const row = mockClient.state.shares.find(r => r.token === token);
    expect(row).toBeDefined();
    expect(row.file_node_id).toBe(1);
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
});
