const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { meetsRank } = require('../policy/permissionRank');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../../../utils/errorHandler');
const { getBackend, getPgPool, withTransaction, isSqliteBackend, getSqliteConnection, withSqliteTransaction, sqliteRun } = require('../../../store/storage');
const { invalidateExistenceIndexForAclMutation } = require('./permissionExistenceIndex');
const userStore = require('../../../store/userStore');

function isPostgresqlBackend() {
  return getBackend() === 'postgresql';
}

const cache = new Map();
const CACHE_TTL_MS =
  process.env.NODE_ENV === 'test'
    ? 0
    : parseInt(process.env.PERMISSION_CACHE_TTL_MS || '5000', 10) || 5000;

/* ------------------------------------------------------------------ */
/*  Share Permissions                                                 */
/* ------------------------------------------------------------------ */

async function grantSharePermission(token, nodeId) {
  const node = Number(nodeId);
  if (!Number.isFinite(node)) {
    throw createError(SERVER_ERROR_CODES.files.invalidPath, 400);
  }

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_shares (token, file_node_id, permission, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (token)
           DO UPDATE
             SET file_node_id = EXCLUDED.file_node_id,
                 permission = EXCLUDED.permission,
                 updated_at = NOW()`,
          [String(token), node, PERMISSIONS.READ]
        );
      });
      return { token, nodeId: node };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_shares (token, file_node_id, permission, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (token)
           DO UPDATE
             SET file_node_id = excluded.file_node_id,
                 permission = excluded.permission,
                 updated_at = CURRENT_TIMESTAMP`,
          [String(token), node, PERMISSIONS.READ]
        );
      });
      return { token, nodeId: node };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function revokeSharePermission(token) {
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_shares WHERE token = $1`, [String(token)]);
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_shares WHERE token = ?`, [String(token)]);
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function checkSharePermission(token, targetNodeId, requiredPermission = 'read') {
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.permission, a.depth FROM permissions_shares p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.token = $2
         ORDER BY a.depth ASC LIMIT 1`,
        [Number(targetNodeId), String(token)]
      );
      if (res.rows.length === 0) return false;
      return meetsRank(res.rows[0].permission, requiredPermission);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.permission, a.depth FROM permissions_shares p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.token = ?
           ORDER BY a.depth ASC LIMIT 1`,
          [Number(targetNodeId), String(token)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return false;
      return meetsRank(res.rows[0].permission, requiredPermission);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/* ------------------------------------------------------------------ */
/*  User Directory Permissions                                        */
/* ------------------------------------------------------------------ */

async function listPermissionUserIds() {
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT DISTINCT user_id::text AS user_id
           FROM (
             SELECT user_id FROM permissions_user_paths
             UNION
             SELECT user_id FROM permissions_user_files
           ) AS permission_user_ids`
      );
      return res.rows.map((row) => row.user_id);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT DISTINCT user_id FROM (
             SELECT user_id FROM permissions_user_paths
             UNION
             SELECT user_id FROM permissions_user_files
           ) AS permission_user_ids`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      return res.rows.map((row) => row.user_id);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function grant(userId, nodeId, permission) {
  const uid = Number(userId);
  const node = Number(nodeId);

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_user_paths (user_id, file_node_id, permission, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()`,
          [uid, node, permission]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(node);
      return { userId: uid, nodeId: node, permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_user_paths (user_id, file_node_id, permission, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET permission = excluded.permission, updated_at = CURRENT_TIMESTAMP`,
          [uid, node, permission]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(node);
      return { userId: uid, nodeId: node, permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function revoke(userId, nodeId) {
  const uid = Number(userId);
  const node = Number(nodeId);

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM permissions_user_paths WHERE user_id = $1 AND file_node_id = $2`,
          [uid, node]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(node);
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `DELETE FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?`,
          [uid, node]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(node);
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function revokeAllUserPermissions(userId) {
  const uid = Number(userId);

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = $1`, [uid]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = $1`, [uid]);
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation('/');
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = ?`, [uid]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = ?`, [uid]);
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation('/');
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function deleteUserPermissionsFile(userId) {
  const uid = Number(userId);

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = $1`, [uid]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = $1`, [uid]);
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation('/');
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = ?`, [uid]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = ?`, [uid]);
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation('/');
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else {
    throw new Error('No database backend configured');
  }
}

async function getUserPermissions(userId) {
  const uid = Number(userId);
  const uidStr = String(uid);

  if (CACHE_TTL_MS > 0) {
    const cached = cache.get(uidStr);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  let pathPerms, filePerms;

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      [pathPerms, filePerms] = await Promise.all([
        pool.query(
          `SELECT file_node_id, permission FROM permissions_user_paths WHERE user_id = $1`,
          [uid]
        ),
        pool.query(
          `SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = $1`,
          [uid]
        ),
      ]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      [pathPerms, filePerms] = await Promise.all([
        new Promise((resolve, reject) => {
          db.all(
            `SELECT file_node_id, permission FROM permissions_user_paths WHERE user_id = ?`,
            [uid],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        }),
        new Promise((resolve, reject) => {
          db.all(
            `SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = ?`,
            [uid],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        }),
      ]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else {
    throw new Error('No database backend configured');
  }

  const result = [
    ...pathPerms.rows.map(r => ({ file_node_id: Number(r.file_node_id), permission: r.permission, type: 'directory' })),
    ...filePerms.rows.map(r => ({ file_node_id: Number(r.file_node_id), permission: r.permission, type: 'file' })),
  ];

  if (CACHE_TTL_MS > 0) {
    cache.set(uidStr, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  } else {
    cache.delete(uidStr);
  }
  return result;
}

async function checkPermission(userId, nodeId, requiredPermission) {
  const uid = Number(userId);
  const node = Number(nodeId);

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.permission, a.depth FROM permissions_user_paths p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.user_id = $2
         ORDER BY a.depth ASC LIMIT 1`,
        [node, uid]
      );
      if (res.rows.length === 0) return false;
      return meetsRank(res.rows[0].permission, requiredPermission);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.permission, a.depth FROM permissions_user_paths p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.user_id = ?
           ORDER BY a.depth ASC LIMIT 1`,
          [node, uid],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return false;
      return meetsRank(res.rows[0].permission, requiredPermission);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function checkPermissions(userId, nodeIds, requiredPermission) {
  const result = new Map();
  if (!Array.isArray(nodeIds)) return result;
  for (const nodeId of nodeIds) {
    if (typeof nodeId !== 'number') continue;
    result.set(nodeId, await checkPermission(userId, nodeId, requiredPermission));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  File Permissions                                                   */
/* ------------------------------------------------------------------ */

async function grantFilePermission(userId, fileNodeId, permission) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);

  if (!PERMISSIONS.isValid(permission)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidPermission, 400);
  }

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_user_files (user_id, file_node_id, permission, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()`,
          [uid, fnode, permission]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(fnode);
      return { userId: uid, fileNodeId: fnode, permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_user_files (user_id, file_node_id, permission, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET permission = excluded.permission, updated_at = CURRENT_TIMESTAMP`,
          [uid, fnode, permission]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(fnode);
      return { userId: uid, fileNodeId: fnode, permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function revokeFilePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM permissions_user_files WHERE user_id = $1 AND file_node_id = $2`,
          [uid, fnode]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(fnode);
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `DELETE FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?`,
          [uid, fnode]
        );
      });
      cache.delete(String(uid));
      invalidateExistenceIndexForAclMutation(fnode);
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function getFilePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT permission FROM permissions_user_files WHERE user_id = $1 AND file_node_id = $2 LIMIT 1`,
        [uid, fnode]
      );
      if (res.rows.length === 0) return null;
      return { userId: uid, fileNodeId: fnode, permission: res.rows[0].permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT permission FROM permissions_user_files WHERE user_id = ? AND file_node_id = ? LIMIT 1`,
          [uid, fnode],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return null;
      return { userId: uid, fileNodeId: fnode, permission: res.rows[0].permission };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function getUserFilePermissions(userId) {
  const uid = Number(userId);

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = $1`,
        [uid]
      );
      return res.rows.map(r => ({ file_node_id: Number(r.file_node_id), permission: r.permission }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = ?`,
          [uid],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      return res.rows.map(r => ({ file_node_id: Number(r.file_node_id), permission: r.permission }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/* ------------------------------------------------------------------ */
/*  Shared-with-me Listing                                             */
/* ------------------------------------------------------------------ */

const buildSharedSql = (table, ph1, ph2, excludeOwn) => {
  const exclusion = excludeOwn
    ? ` AND p.file_node_id NOT IN (
        SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2}
      )`
    : '';
  return `SELECT p.file_node_id, p.permission, n.name, n.type
          FROM ${table} p
          JOIN file_nodes n ON n.id = p.file_node_id
          WHERE p.user_id = ${ph1}${exclusion}`;
};

/**
 * List grants where the user is the grantee, excluding any node inside the
 * user's own home subtree (home root + descendants) via the closure table.
 * Each row includes the real node `name` and `type` from file_nodes.
 * @param {number} userId
 * @param {number|null} homeRootNodeId - user's home root node; when null no
 *   own-subtree exclusion is applied.
 */
async function getSharedPermissions(userId, homeRootNodeId) {
  const uid = Number(userId);
  const root = homeRootNodeId != null ? Number(homeRootNodeId) : null;
  const excludeOwn = root != null;

  let pathPerms, filePerms;

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const params = excludeOwn ? [uid, root] : [uid];
      [pathPerms, filePerms] = await Promise.all([
        pool.query(buildSharedSql('permissions_user_paths', '$1', '$2', excludeOwn), params),
        pool.query(buildSharedSql('permissions_user_files', '$1', '$2', excludeOwn), params),
      ]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const params = excludeOwn ? [uid, root] : [uid];
      const run = (sql) =>
        new Promise((resolve, reject) => {
          db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          });
        });
      [pathPerms, filePerms] = await Promise.all([
        run(buildSharedSql('permissions_user_paths', '?', '?', excludeOwn)),
        run(buildSharedSql('permissions_user_files', '?', '?', excludeOwn)),
      ]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else {
    throw new Error('No database backend configured');
  }

  // Dedupe across the two permission tables: at most one entry per file_node_id.
  const seen = new Set();
  const result = [];
  for (const row of [
    ...pathPerms.rows.map(r => ({ file_node_id: Number(r.file_node_id), name: r.name, permission: r.permission, type: r.type })),
    ...filePerms.rows.map(r => ({ file_node_id: Number(r.file_node_id), name: r.name, permission: r.permission, type: r.type })),
  ]) {
    if (seen.has(row.file_node_id)) continue;
    seen.add(row.file_node_id);
    result.push(row);
  }
  return result;
}

const buildRemovalSql = (table, ph1, ph2) =>
  `DELETE FROM ${table}
   WHERE user_id = ${ph1} AND file_node_id IN (
     SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2} AND depth > 0
   )`;

/**
 * Delete the user's permission rows on proper descendants (depth > 0) of their
 * home root. Preserves the home-root ADMIN grant (depth 0).
 * @returns {Promise<{ removedPaths: number, removedFiles: number }>}
 */
async function removeOwnSubtreePermissions(userId, homeRootNodeId) {
  const uid = Number(userId);
  const root = Number(homeRootNodeId);
  if (!Number.isFinite(root)) {
    return { removedPaths: 0, removedFiles: 0 };
  }

  let removedPaths = 0;
  let removedFiles = 0;

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const pathRes = await pool.query(buildRemovalSql('permissions_user_paths', '$1', '$2'), [uid, root]);
      const fileRes = await pool.query(buildRemovalSql('permissions_user_files', '$1', '$2'), [uid, root]);
      removedPaths = pathRes.rowCount || 0;
      removedFiles = fileRes.rowCount || 0;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else if (isSqliteBackend()) {
    try {
      const pathRes = await sqliteRun(buildRemovalSql('permissions_user_paths', '?', '?'), [uid, root]);
      const fileRes = await sqliteRun(buildRemovalSql('permissions_user_files', '?', '?'), [uid, root]);
      removedPaths = pathRes.changes || 0;
      removedFiles = fileRes.changes || 0;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else {
    throw new Error('No database backend configured');
  }

  cache.delete(String(uid));
  return { removedPaths, removedFiles };
}

const buildSubtreeRemovalSql = (table, ph1, ph2) =>
  `DELETE FROM ${table}
   WHERE user_id = ${ph1} AND file_node_id IN (
     SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2}
   )`;

/**
 * Delete the user's permission rows on every node in the subtree rooted at
 * rootNodeId, INCLUDING the root itself (depth 0). Used on ownership transfer
 * (D6): when a node the user owned is moved into another user's home subtree,
 * the mover's explicit rows on the moved subtree (historical self-grants,
 * admin-assigned rows) would otherwise resurface in getSharedPermissions as
 * "shared with me" leaks. Unlike removeOwnSubtreePermissions there is no
 * depth > 0 filter — the subtree root's own row is revoked too.
 * @returns {Promise<{ removedPaths: number, removedFiles: number }>}
 */
async function revokeUserSubtreePermissions(userId, rootNodeId) {
  const uid = Number(userId);
  const root = Number(rootNodeId);
  if (!Number.isFinite(root)) {
    return { removedPaths: 0, removedFiles: 0 };
  }

  let removedPaths = 0;
  let removedFiles = 0;

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const pathRes = await pool.query(buildSubtreeRemovalSql('permissions_user_paths', '$1', '$2'), [uid, root]);
      const fileRes = await pool.query(buildSubtreeRemovalSql('permissions_user_files', '$1', '$2'), [uid, root]);
      removedPaths = pathRes.rowCount || 0;
      removedFiles = fileRes.rowCount || 0;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else if (isSqliteBackend()) {
    try {
      const pathRes = await sqliteRun(buildSubtreeRemovalSql('permissions_user_paths', '?', '?'), [uid, root]);
      const fileRes = await sqliteRun(buildSubtreeRemovalSql('permissions_user_files', '?', '?'), [uid, root]);
      removedPaths = pathRes.changes || 0;
      removedFiles = fileRes.changes || 0;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  } else {
    throw new Error('No database backend configured');
  }

  cache.delete(String(uid));
  return { removedPaths, removedFiles };
}

async function getEffectivePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);

  // File-specific permission takes precedence
  const filePerm = await getFilePermission(uid, fnode);
  if (filePerm && filePerm.permission) return filePerm.permission;

  // Fall back to ancestor directory traversal
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.permission, a.depth FROM permissions_user_paths p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.user_id = $2
         ORDER BY a.depth ASC LIMIT 1`,
        [fnode, uid]
      );
      if (res.rows.length === 0) return null;
      return res.rows[0].permission;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.permission, a.depth FROM permissions_user_paths p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.user_id = ?
           ORDER BY a.depth ASC LIMIT 1`,
          [fnode, uid],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return null;
      return res.rows[0].permission;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function getPathEffectivePermission(userId, nodeId) {
  const uid = Number(userId);
  const node = Number(nodeId);

  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.permission, a.depth FROM permissions_user_paths p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.user_id = $2
         ORDER BY a.depth ASC LIMIT 1`,
        [node, uid]
      );
      if (res.rows.length === 0) return null;
      return res.rows[0].permission;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.permission, a.depth FROM permissions_user_paths p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.user_id = ?
           ORDER BY a.depth ASC LIMIT 1`,
          [node, uid],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return null;
      return res.rows[0].permission;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/* ------------------------------------------------------------------ */
/*  Folder / Path-level Permission Queries                             */
/* ------------------------------------------------------------------ */

async function getFolderPermissions(nodeId, fileNodeId) {
  const node = Number(nodeId);
  const userIds = await listPermissionUserIds();
  const results = [];

  for (const uid of userIds) {
    let perm = null;
    if (isPostgresqlBackend()) {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.permission, a.depth FROM permissions_user_paths p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.user_id = $2
         ORDER BY a.depth ASC LIMIT 1`,
        [node, Number(uid)]
      );
      if (res.rows.length > 0) perm = res.rows[0].permission;
    } else if (isSqliteBackend()) {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.permission, a.depth FROM permissions_user_paths p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.user_id = ?
           ORDER BY a.depth ASC LIMIT 1`,
          [node, Number(uid)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length > 0) perm = res.rows[0].permission;
    }

    let filePerm = null;
    if (fileNodeId != null) {
      const fnode = Number(fileNodeId);
      if (isPostgresqlBackend()) {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT permission FROM permissions_user_files WHERE user_id = $1 AND file_node_id = $2 LIMIT 1`,
          [Number(uid), fnode]
        );
        if (res.rows.length > 0) filePerm = res.rows[0].permission;
      } else if (isSqliteBackend()) {
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT permission FROM permissions_user_files WHERE user_id = ? AND file_node_id = ? LIMIT 1`,
            [Number(uid), fnode],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
        if (res.rows.length > 0) filePerm = res.rows[0].permission;
      }
    }

    if (perm == null && filePerm == null) continue;

    const user = await userStore.findById(uid);
    if (!user) continue;

    const item = {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      permission: perm,
    };
    if (fileNodeId != null) {
      item.file_permission = filePerm;
    }
    results.push(item);
  }

  return results;
}

async function hasPermissionsInPath(nodeId) {
  const node = Number(nodeId);
  const userIds = await listPermissionUserIds();
  const results = [];

  if (isPostgresqlBackend()) {
    for (const uid of userIds) {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT p.file_node_id, p.permission, a.depth FROM permissions_user_paths p
         JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
         WHERE a.descendant_id = $1 AND p.user_id = $2`,
        [node, Number(uid)]
      );
      for (const row of res.rows) {
        const user = await userStore.findById(Number(uid));
        if (!user) continue;
        results.push({
          id: user.id,
          username: user.username,
          email: user.email,
          is_admin: user.is_admin,
          file_node_id: Number(row.file_node_id),
          permission: row.permission,
        });
      }
    }
  } else if (isSqliteBackend()) {
    for (const uid of userIds) {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT p.file_node_id, p.permission, a.depth FROM permissions_user_paths p
           JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
           WHERE a.descendant_id = ? AND p.user_id = ?`,
          [node, Number(uid)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      for (const row of res.rows) {
        const user = await userStore.findById(Number(uid));
        if (!user) continue;
        results.push({
          id: user.id,
          username: user.username,
          email: user.email,
          is_admin: user.is_admin,
          file_node_id: Number(row.file_node_id),
          permission: row.permission,
        });
      }
    }
  } else {
    throw new Error('No database backend configured');
  }

  return results;
}

module.exports = {
  grantSharePermission,
  revokeSharePermission,
  checkSharePermission,
  grant,
  revoke,
  revokeAllUserPermissions,
  deleteUserPermissionsFile,
  getUserPermissions,
  checkPermission,
  checkPermissions,
  getFolderPermissions,
  hasPermissionsInPath,
  getFilePermission,
  getEffectivePermission,
  grantFilePermission,
  revokeFilePermission,
  getUserFilePermissions,
  getSharedPermissions,
  removeOwnSubtreePermissions,
  revokeUserSubtreePermissions,
  getPathEffectivePermission,
};
