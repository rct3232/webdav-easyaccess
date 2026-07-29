const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { getPermissionRank: permissionRankFromModule, meetsRank } = require('../policy/permissionRank');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../../../utils/errorHandler');
const {
  META_ROOT,
  PERMISSIONS_DIR,
  PERMISSIONS_USERS_DIR,
  PERMISSIONS_SHARES_DIR,
  userPermissionsPathByUserId,
  sharePermissionsPathByToken,
  normalizeWebdavPath,
} = require('../../../store/metaPaths');
const { getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { ensureDir, exists, readFile, writeFile, getBackend, getPgPool, withTransaction, isSqliteBackend, getSqliteConnection, withSqliteTransaction } = require('../../../store/storage');
const { withLock } = require('../../../store/locks');
const { invalidateExistenceIndexForAclMutation } = require('./permissionExistenceIndex');
const userStore = require('../../../store/userStore');
const { nowIso, safeJsonParse } = require('../../../utils/sharedHelpers');

function isPostgresqlBackend() {
  return getBackend() === 'postgresql';
}

const cache = new Map(); // userId -> { expiresAt:number, data: object }
const shareCache = new Map(); // token -> { expiresAt:number, data: object }
const CACHE_TTL_MS =
  process.env.NODE_ENV === 'test'
    ? 0
    : parseInt(process.env.PERMISSION_CACHE_TTL_MS || '5000', 10) || 5000;

async function ensureDirs() {
  if (isPostgresqlBackend() || isSqliteBackend()) return;
  await ensureDir(META_ROOT);
  await ensureDir(PERMISSIONS_DIR);
  await ensureDir(PERMISSIONS_USERS_DIR);
}

async function ensureShareDirs() {
  if (isPostgresqlBackend() || isSqliteBackend()) return;
  await ensureDir(META_ROOT);
  await ensureDir(PERMISSIONS_DIR);
  await ensureDir(PERMISSIONS_SHARES_DIR);
}

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

  const entries = await require('../../../store/storage').listDir(PERMISSIONS_USERS_DIR);
  return entries
    .filter((ent) => ent.basename && ent.basename.endsWith('.json'))
    .map((ent) => ent.basename.replace(/\.json$/, ''));
}

function containsPathTraversal(p) {
  const n = String(p || '');
  return n.includes('/../') || n.includes('\\..\\') || n.startsWith('../') || n.endsWith('/..') || n === '..';
}

async function grantSharePermission(token, rootPath, isDirectory) {
  const root = normalizeWebdavPath(rootPath);
  if (containsPathTraversal(root)) {
    throw createError(SERVER_ERROR_CODES.files.invalidPath, 400);
  }

  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_shares (token, root_path, is_directory, permission, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (token)
           DO UPDATE
             SET root_path = EXCLUDED.root_path,
                 is_directory = EXCLUDED.is_directory,
                 permission = EXCLUDED.permission,
                 updated_at = NOW()`,
          [String(token), root, Boolean(isDirectory), PERMISSIONS.READ]
        );
      });
      shareCache.delete(token);
      return { token, rootPath: root, isDirectory: Boolean(isDirectory) };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
          `INSERT INTO permissions_shares (token, root_path, is_directory, permission, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (token)
           DO UPDATE
             SET root_path = excluded.root_path,
                 is_directory = excluded.is_directory,
                 permission = excluded.permission,
                 updated_at = CURRENT_TIMESTAMP`,
          [String(token), root, Boolean(isDirectory), PERMISSIONS.READ]
        );
      });
      shareCache.delete(token);
      return { token, rootPath: root, isDirectory: Boolean(isDirectory) };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  await ensureShareDirs();
  const doc = {
    rootPath: root,
    isDirectory: Boolean(isDirectory),
    permission: 'read',
    updated_at: nowIso(),
  };
  const p = sharePermissionsPathByToken(token);
  await writeFile(p, JSON.stringify(doc, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  shareCache.delete(token);
  return { token, rootPath: root, isDirectory: doc.isDirectory };
}

async function revokeSharePermission(token) {
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_shares WHERE token = $1`, [String(token)]);
      });
      shareCache.delete(token);
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
      shareCache.delete(token);
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const p = sharePermissionsPathByToken(token);
  const { deletePath } = require('../../../store/storage');
  try {
    if (await exists(p)) {
      await deletePath(p);
    }
    shareCache.delete(token);
  } catch (error) {
    console.error(`Failed to revoke share permission for token:`, error);
  }
  return { success: true };
}

async function getSharePermissionDoc(token, { bypassCache = false } = {}) {
  if (CACHE_TTL_MS > 0) {
    const cached = shareCache.get(token);
    if (!bypassCache && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT token, root_path, is_directory, permission, updated_at
           FROM permissions_shares
          WHERE token = $1
          LIMIT 1`,
        [String(token)]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      const normalized = {
        rootPath: normalizeWebdavPath(row.root_path),
        isDirectory: Boolean(row.is_directory),
        permission: PERMISSIONS.isValid(row.permission) ? row.permission : PERMISSIONS.READ,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || nowIso()),
      };
      if (CACHE_TTL_MS > 0) {
        shareCache.set(token, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
      } else {
        shareCache.delete(token);
      }
      return normalized;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT token, root_path, is_directory, permission, updated_at
             FROM permissions_shares
            WHERE token = ?
            LIMIT 1`,
          [String(token)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      const normalized = {
        rootPath: normalizeWebdavPath(row.root_path),
        isDirectory: Boolean(row.is_directory),
        permission: PERMISSIONS.isValid(row.permission) ? row.permission : PERMISSIONS.READ,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || nowIso()),
      };
      if (CACHE_TTL_MS > 0) {
        shareCache.set(token, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
      } else {
        shareCache.delete(token);
      }
      return normalized;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const p = sharePermissionsPathByToken(token);
  try {
    const buf = await readFile(p);
    const text = Buffer.from(buf).toString('utf8');
    const doc = safeJsonParse(text);
    if (!doc || typeof doc !== 'object' || !doc.rootPath) return null;
    const normalized = {
      rootPath: normalizeWebdavPath(doc.rootPath),
      isDirectory: Boolean(doc.isDirectory),
      permission: doc.permission === 'read' ? 'read' : 'read',
      updated_at: doc.updated_at || nowIso(),
    };
    if (CACHE_TTL_MS > 0) {
      shareCache.set(token, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
    } else {
      shareCache.delete(token);
    }
    return normalized;
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
      return null;
    }
    throw error;
  }
}

async function checkSharePermission(token, path, requiredPermission) {
  if (requiredPermission !== 'read') return false;
  if (containsPathTraversal(path)) return false;
  const doc = await getSharePermissionDoc(token);
  if (!doc) return false;
  const normalizedPath = normalizeWebdavPath(path);
  const root = normalizeNoSlash(doc.rootPath);
  const rootWithSlash = normalizeWithSlash(doc.rootPath);
  if (doc.isDirectory) {
    return (
      normalizedPath === root ||
      normalizedPath === rootWithSlash ||
      normalizedPath.startsWith(rootWithSlash) ||
      (root !== '/' && normalizedPath.startsWith(root + '/'))
    );
  }
  return normalizedPath === root || normalizedPath === rootWithSlash;
}

async function ensureUserPermissionsFile(userId) {
  if (isPostgresqlBackend() || isSqliteBackend()) return;
  await ensureDirs();
  const p = userPermissionsPathByUserId(userId);
  if (!(await exists(p))) {
    const initial = { permissions: {}, file_permissions: {}, updated_at: nowIso() };
    await writeFile(p, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
}

async function readUserPermissionsDoc(userId, { bypassCache = false } = {}) {
  const uid = String(userId);
  if (CACHE_TTL_MS > 0) {
    const cached = cache.get(uid);
    if (!bypassCache && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const [pathRows, fileRows] = await Promise.all([
        pool.query(
          `SELECT folder_path, permission, updated_at
             FROM permissions_user_paths
            WHERE user_id = $1`,
          [Number(uid)]
        ),
        pool.query(
          `SELECT file_path, permission, updated_at
             FROM permissions_user_files
            WHERE user_id = $1`,
          [Number(uid)]
        ),
      ]);

      const normalized = { permissions: {}, file_permissions: {}, updated_at: nowIso() };
      let latestUpdatedAt = normalized.updated_at;
      for (const row of pathRows.rows) {
        normalized.permissions[normalizeWebdavPath(row.folder_path)] = row.permission;
        if (row.updated_at instanceof Date && row.updated_at.toISOString() > latestUpdatedAt) {
          latestUpdatedAt = row.updated_at.toISOString();
        }
      }
      for (const row of fileRows.rows) {
        normalized.file_permissions[normalizeWebdavPath(row.file_path)] = row.permission;
        if (row.updated_at instanceof Date && row.updated_at.toISOString() > latestUpdatedAt) {
          latestUpdatedAt = row.updated_at.toISOString();
        }
      }
      normalized.updated_at = latestUpdatedAt;

      if (CACHE_TTL_MS > 0) {
        cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
      } else {
        cache.delete(uid);
      }
      return normalized;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = getSqliteConnection();
      const [pathRows, fileRows] = await Promise.all([
        new Promise((resolve, reject) => {
          db.all(
            `SELECT folder_path, permission, updated_at
               FROM permissions_user_paths
              WHERE user_id = ?`,
            [Number(uid)],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        }),
        new Promise((resolve, reject) => {
          db.all(
            `SELECT file_path, permission, updated_at
               FROM permissions_user_files
              WHERE user_id = ?`,
            [Number(uid)],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        }),
      ]);

      const normalized = { permissions: {}, file_permissions: {}, updated_at: nowIso() };
      let latestUpdatedAt = normalized.updated_at;
      for (const row of pathRows.rows) {
        normalized.permissions[normalizeWebdavPath(row.folder_path)] = row.permission;
        if (row.updated_at instanceof Date && row.updated_at.toISOString() > latestUpdatedAt) {
          latestUpdatedAt = row.updated_at.toISOString();
        }
      }
      for (const row of fileRows.rows) {
        normalized.file_permissions[normalizeWebdavPath(row.file_path)] = row.permission;
        if (row.updated_at instanceof Date && row.updated_at.toISOString() > latestUpdatedAt) {
          latestUpdatedAt = row.updated_at.toISOString();
        }
      }
      normalized.updated_at = latestUpdatedAt;

      if (CACHE_TTL_MS > 0) {
        cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
      } else {
        cache.delete(uid);
      }
      return normalized;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  await ensureUserPermissionsFile(uid);
  const buf = await readFile(userPermissionsPathByUserId(uid));
  const text = Buffer.from(buf).toString('utf8');
  const doc = safeJsonParse(text);
  const normalized = doc && typeof doc === 'object' ? doc : { permissions: {}, file_permissions: {}, updated_at: nowIso() };
  normalized.permissions = normalized.permissions && typeof normalized.permissions === 'object' ? normalized.permissions : {};
  normalized.file_permissions = normalized.file_permissions && typeof normalized.file_permissions === 'object' ? normalized.file_permissions : {};
  if (CACHE_TTL_MS > 0) {
    cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
  } else {
    cache.delete(uid);
  }
  return normalized;
}

async function writeUserPermissionsDoc(userId, doc) {
  const uid = String(userId);
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = $1`, [Number(uid)]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = $1`, [Number(uid)]);

        for (const [folderPath, permission] of Object.entries(doc.permissions || {})) {
          await client.query(
            `INSERT INTO permissions_user_paths (user_id, folder_path, permission, updated_at)
             VALUES ($1, $2, $3, NOW())`,
            [Number(uid), normalizeWebdavPath(folderPath), permission]
          );
        }

        for (const [filePath, permission] of Object.entries(doc.file_permissions || {})) {
          await client.query(
            `INSERT INTO permissions_user_files (user_id, file_path, permission, updated_at)
             VALUES ($1, $2, $3, NOW())`,
            [Number(uid), normalizeWebdavPath(filePath), permission]
          );
        }
      });

      doc.updated_at = nowIso();
      if (CACHE_TTL_MS > 0) {
        cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: doc });
      } else {
        cache.delete(uid);
      }
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = ?`, [Number(uid)]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = ?`, [Number(uid)]);

        for (const [folderPath, permission] of Object.entries(doc.permissions || {})) {
          await client.query(
            `INSERT INTO permissions_user_paths (user_id, folder_path, permission, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [Number(uid), normalizeWebdavPath(folderPath), permission]
          );
        }

        for (const [filePath, permission] of Object.entries(doc.file_permissions || {})) {
          await client.query(
            `INSERT INTO permissions_user_files (user_id, file_path, permission, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [Number(uid), normalizeWebdavPath(filePath), permission]
          );
        }
      });

      doc.updated_at = nowIso();
      if (CACHE_TTL_MS > 0) {
        cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: doc });
      } else {
        cache.delete(uid);
      }
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  doc.updated_at = nowIso();
  await writeFile(userPermissionsPathByUserId(uid), JSON.stringify(doc, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  if (CACHE_TTL_MS > 0) {
    cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: doc });
  } else {
    cache.delete(uid);
  }
}

async function grant(userId, folderPath, permission, options = {}) {
  const target = options.target || 'folder';
  if (target === 'file') {
    return await grantFilePermission(userId, folderPath, permission);
  }
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    doc.permissions[folder] = permission;
    escalateFilePermissionsUnderPath(doc, folder, permission);
    await writeUserPermissionsDoc(uid, doc);
    invalidateExistenceIndexForAclMutation(folder);
    return { id: undefined, userId: Number(uid), folderPath: folderPath, permission };
  });
}

async function revoke(userId, folderPath, options = {}) {
  const scope = options.scope || 'includeDescendants';
  if (scope === 'pathOnly') {
    return await revokePathOnly(userId, folderPath);
  }
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    delete doc.permissions[folder];
    removeFilePermissionsUnderPrefix(doc, folder);
    await writeUserPermissionsDoc(uid, doc);
    invalidateExistenceIndexForAclMutation(folder);
    return { success: true };
  });
}

async function revokePathOnly(userId, path) {
  const uid = String(userId);
  const normalized = normalizeWebdavPath(path);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    let changed = false;
    if (doc.file_permissions && doc.file_permissions[normalized] !== undefined) {
      delete doc.file_permissions[normalized];
      changed = true;
    }
    const withSlash = normalizeWithSlash(path);
    const noSlash = normalizeNoSlash(path);
    if (doc.permissions && (doc.permissions[normalized] !== undefined || doc.permissions[withSlash] !== undefined || doc.permissions[noSlash] !== undefined)) {
      delete doc.permissions[normalized];
      delete doc.permissions[withSlash];
      delete doc.permissions[noSlash];
      changed = true;
    }
    if (changed) {
      await writeUserPermissionsDoc(uid, doc);
      invalidateExistenceIndexForAclMutation(normalized);
    }
    return { success: true };
  });
}

/**
 * Escalate file_permissions under the given folder path when file permission is lower than newPermission.
 * Used when path permission is upgraded; files with independent permissions lower than the new path get upgraded.
 */
function escalateFilePermissionsUnderPath(doc, folderPath, newPermission) {
  if (!doc.file_permissions || typeof doc.file_permissions !== 'object') return;
  const newRank = permissionRank(newPermission);
  if (newRank < 0) return;
  const prefixNoSlash = normalizeNoSlash(folderPath);
  const prefixWithSlash = normalizeWithSlash(folderPath);
  const prefixNoSlashLower = prefixNoSlash.toLowerCase();
  const prefixWithSlashLower = prefixWithSlash.toLowerCase();
  for (const key of Object.keys(doc.file_permissions)) {
    const keyNorm = normalizeWebdavPath(key);
    const keyNormLower = keyNorm.toLowerCase();
    const underPath =
      prefixNoSlash === '/'
        ? true
        : keyNormLower === prefixNoSlashLower || keyNormLower.startsWith(prefixWithSlashLower);
    if (!underPath) continue;
    const filePerm = doc.file_permissions[key];
    const fileRank = permissionRank(filePerm);
    const willUpdate = fileRank < newRank;
    if (willUpdate) {
      doc.file_permissions[key] = newPermission;
    }
  }
}

/**
 * Remove all file_permissions keys that are under the given folder prefix (path or path/).
 */
function removeFilePermissionsUnderPrefix(doc, folderPath) {
  if (!doc.file_permissions || typeof doc.file_permissions !== 'object') return;
  const prefixNoSlash = normalizeNoSlash(folderPath);
  const prefixWithSlash = normalizeWithSlash(folderPath);
  const prefixNoSlashLower = prefixNoSlash.toLowerCase();
  const prefixWithSlashLower = prefixWithSlash.toLowerCase();
  for (const key of Object.keys(doc.file_permissions)) {
    const keyNorm = normalizeWebdavPath(key);
    const keyNormLower = keyNorm.toLowerCase();
    if (keyNormLower === prefixNoSlashLower || keyNormLower === prefixWithSlashLower) continue;
    if (prefixNoSlash === '/') {
      // revoking root: remove all
      delete doc.file_permissions[key];
    } else if (keyNormLower.startsWith(prefixWithSlashLower) || keyNormLower === prefixNoSlashLower) {
      delete doc.file_permissions[key];
    }
  }
}

async function revokeAllUserPermissions(userId) {
  const uid = String(userId);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    const deletedCount = Object.keys(doc.permissions || {}).length;
    const fileDeletedCount = Object.keys(doc.file_permissions || {}).length;
    doc.permissions = {};
    doc.file_permissions = {};
    await writeUserPermissionsDoc(uid, doc);
    invalidateExistenceIndexForAclMutation('/');
    return { success: true, deletedCount, fileDeletedCount };
  });
}

async function deleteUserPermissionsFile(userId) {
  const uid = String(userId);
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = $1`, [Number(uid)]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = $1`, [Number(uid)]);
      });
      cache.delete(uid);
      invalidateExistenceIndexForAclMutation('/');
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM permissions_user_paths WHERE user_id = ?`, [Number(uid)]);
        await client.query(`DELETE FROM permissions_user_files WHERE user_id = ?`, [Number(uid)]);
      });
      cache.delete(uid);
      invalidateExistenceIndexForAclMutation('/');
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const p = userPermissionsPathByUserId(uid);
  try {
    if (await exists(p)) {
      const { deletePath } = require('../../../store/storage');
      await deletePath(p);
    }
    // Also remove from cache
    cache.delete(uid);
    invalidateExistenceIndexForAclMutation('/');
  } catch (error) {
    console.error(`Failed to delete permission file for user ${uid}:`, error);
    // best-effort: continue even if error occurs
  }
}

async function getUserPermissions(userId) {
  const uid = String(userId);
  const doc = await readUserPermissionsDoc(uid);
  return Object.entries(doc.permissions).map(([folder_path, permission]) => ({ folder_path, permission }));
}

function permissionRank(p) {
  return permissionRankFromModule(p);
}

/**
 * Get the direct permission for a folder path from a doc (slash + no-slash).
 * @param {object} doc - Permission doc
 * @param {string} folderPath - Folder path
 * @returns {string|null} 'read'|'write'|'admin' or null
 */
function getPathEffectivePermissionFromDoc(doc, folderPath) {
  if (!doc || !doc.permissions) return null;
  const withSlash = normalizeWithSlash(folderPath);
  const noSlash = normalizeNoSlash(folderPath);
  return doc.permissions[withSlash] || doc.permissions[noSlash] || null;
}

async function getPathEffectivePermission(userId, folderPath) {
  const doc = await readUserPermissionsDoc(userId);
  return getPathEffectivePermissionFromDoc(doc, folderPath);
}

/**
 * Normalize file path for file_permissions key (no trailing slash).
 */
function normalizeFilePath(filePath) {
  return normalizeWebdavPath(filePath);
}

/**
 * Get the key in file_permissions that matches the given path (exact or case-insensitive).
 * WebDAV paths can differ in case (e.g. 1.JPG vs 1.jpg); lookup must match stored key.
 */
function getFilePermissionKey(fp, normalizedPath) {
  if (!fp || typeof fp !== 'object') return undefined;
  if (fp[normalizedPath] !== undefined) return normalizedPath;
  const lower = normalizedPath.toLowerCase();
  for (const key of Object.keys(fp)) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

function strongerPermission(a, b) {
  return permissionRank(a) >= permissionRank(b) ? a : b;
}

function normalizeNoSlash(p) {
  const n = normalizeWebdavPath(p);
  if (n !== '/' && n.endsWith('/')) return n.slice(0, -1);
  return n;
}

function normalizeWithSlash(p) {
  const noSlash = normalizeNoSlash(p);
  return noSlash === '/' ? '/' : `${noSlash}/`;
}

function rewriteKeyByMapping(key, mapping) {
  const keyNorm = normalizeWebdavPath(key);
  const fromNoSlash = mapping.fromNoSlash;
  const fromWithSlash = mapping.fromWithSlash;

  if (fromNoSlash === '/') {
    if (keyNorm === '/') return mapping.toNoSlash;
    const suffix = keyNorm.startsWith('/') ? keyNorm.slice(1) : keyNorm;
    return mapping.toWithSlash + suffix;
  }

  if (keyNorm === fromNoSlash) return mapping.toNoSlash;
  if (keyNorm === fromWithSlash) return mapping.toWithSlash;
  if (keyNorm.startsWith(fromWithSlash)) {
    return mapping.toWithSlash + keyNorm.slice(fromWithSlash.length);
  }
  return null;
}

/**
 * Synchronous permission check using a preloaded doc (slash + no-slash compatible).
 * @param {object} doc - Permission doc from getPermissionDoc(userId)
 * @param {string} folderPath - Folder path to check
 * @param {string} requiredPermission - 'read', 'write', or 'admin'
 * @returns {boolean}
 */
function checkPermissionSync(doc, folderPath, requiredPermission) {
  if (!doc || !doc.permissions) return false;
  const withSlash = normalizeWithSlash(folderPath);
  const noSlash = normalizeNoSlash(folderPath);
  const actual = doc.permissions[withSlash] || doc.permissions[noSlash];
  if (!actual) return false;
  return meetsRank(actual, requiredPermission);
}

/**
 * Get the permission doc for a user (uses cache). Use with checkPermissionSync for request-scoped bulk checks.
 * @param {number|string} userId
 * @returns {Promise<object>}
 */
async function getPermissionDoc(userId) {
  return await readUserPermissionsDoc(userId);
}

/**
 * Check permissions for multiple paths in one doc read.
 * @param {number|string} userId
 * @param {string[]} paths
 * @param {string} requiredPermission
 * @returns {Promise<Map<string,boolean>>}
 */
async function checkPermissions(userId, paths, requiredPermission) {
  const doc = await getPermissionDoc(userId);
  const result = new Map();
  if (!Array.isArray(paths)) return result;
  for (const p of paths) {
    if (typeof p !== 'string') continue;
    result.set(p, checkPermissionSync(doc, p, requiredPermission));
  }
  return result;
}

async function checkPermission(userId, folderPath, requiredPermission) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  const doc = await readUserPermissionsDoc(uid);
  const actual = doc.permissions?.[folder];
  if (!actual) return false;
  return meetsRank(actual, requiredPermission);
}

async function getFilePermission(userId, filePath) {
  const uid = String(userId);
  const normalized = normalizeFilePath(filePath);
  const doc = await readUserPermissionsDoc(uid);
  const fp = doc.file_permissions || {};
  const key = getFilePermissionKey(fp, normalized);
  if (key === undefined) return null;
  return fp[key];
}

/**
 * Get effective permission for a path (file or folder).
 * File permission takes precedence; otherwise falls back to path permission (direct or parent).
 * @param {number|string} userId
 * @param {string} path - File or folder path
 * @returns {Promise<string|null>} 'read'|'write'|'admin' or null
 */
async function getEffectivePermission(userId, path) {
  const doc = await readUserPermissionsDoc(userId);
  const normalized = normalizeFilePath(path);
  const fp = doc.file_permissions || {};
  const key = getFilePermissionKey(fp, normalized);
  const filePerm = key !== undefined ? fp[key] : null;
  if (filePerm != null) return filePerm;
  const pathPerm = getPathEffectivePermissionFromDoc(doc, normalized);
  if (pathPerm != null) return pathPerm;
  const parentPath = getParentPath(normalized);
  return getPathEffectivePermissionFromDoc(doc, parentPath);
}

/**
 * Grant file-level permission.
 * When parent path has no permission: allows file-only permission.
 * When parent path has permission: file permission must be strictly higher than path (and path must not be admin).
 * @throws {Error} code 'PATH_IS_ADMIN' or 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH' for validation (400)
 */
async function grantFilePermission(userId, filePath, permission) {
  const uid = String(userId);
  const normalized = normalizeFilePath(filePath);
  if (!PERMISSIONS.isValid(permission)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidPermission, 400);
  }
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    if (!doc.file_permissions) doc.file_permissions = {};
    const parentPath = getParentPath(normalized);
    const pathEffective = getPathEffectivePermissionFromDoc(doc, parentPath);
    if (pathEffective === PERMISSIONS.ADMIN) {
      throw createError(SERVER_ERROR_CODES.permissions.permissionHigherThanParent, 400);
    }
    if (pathEffective != null && permissionRank(permission) <= permissionRank(pathEffective)) {
      throw createError(SERVER_ERROR_CODES.permissions.permissionHigherThanParent, 400);
    }
    doc.file_permissions[normalized] = permission;
    await writeUserPermissionsDoc(uid, doc);
    invalidateExistenceIndexForAclMutation(normalized);
    return { userId: Number(uid), filePath: normalized, permission };
  });
}

async function revokeFilePermission(userId, filePath) {
  const uid = String(userId);
  const normalized = normalizeFilePath(filePath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    if (doc.file_permissions && doc.file_permissions[normalized] !== undefined) {
      delete doc.file_permissions[normalized];
      await writeUserPermissionsDoc(uid, doc);
      invalidateExistenceIndexForAclMutation(normalized);
    }
    return { success: true };
  });
}

async function getUserFilePermissions(userId) {
  const uid = String(userId);
  const doc = await readUserPermissionsDoc(uid);
  const fp = doc.file_permissions || {};
  return Object.entries(fp).map(([filePath, permission]) => ({ filePath, permission }));
}

/**
 * Synchronous file permission check using a preloaded doc.
 * If file has independent permission, use it; otherwise fall back to parent path permission.
 * @param {object} doc - Permission doc from getPermissionDoc(userId)
 * @param {string} filePath - File path to check
 * @param {string} requiredPermission - 'read', 'write', or 'admin'
 * @returns {boolean}
 */
function checkFilePermissionSync(doc, filePath, requiredPermission) {
  if (!doc) return false;
  const normalized = normalizeFilePath(filePath);
  const fp = doc.file_permissions || {};
  const key = getFilePermissionKey(fp, normalized);
  const filePerm = key !== undefined ? fp[key] : null;
  if (filePerm !== undefined && filePerm !== null) {
    return meetsRank(filePerm, requiredPermission);
  }
  const parentPath = getParentPath(normalized);
  return checkPermissionSync(doc, parentPath, requiredPermission);
}

async function getFolderPermissions(folderPath, filePath) {
  await ensureDirs();
  const folder = normalizeWebdavPath(folderPath);
  const userIds = await listPermissionUserIds();
  const results = [];
  const normalizedFile = filePath ? normalizeFilePath(filePath) : null;

  for (const userId of userIds) {
    const doc = await readUserPermissionsDoc(userId);
    const perm = doc.permissions?.[folder] ?? null;
    const fp = doc.file_permissions && typeof doc.file_permissions === 'object' ? doc.file_permissions : {};
    const fpKey = normalizedFile != null ? getFilePermissionKey(fp, normalizedFile) : undefined;
    const hasPathPerm = perm != null;
    const hasFilePerm = fpKey !== undefined;
    if (!hasPathPerm && !hasFilePerm) continue;
    const user = await userStore.findById(userId);
    if (!user) continue;
    const item = {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      permission: perm,
    };
    if (normalizedFile != null) {
      item.file_permission = fpKey !== undefined ? fp[fpKey] : null;
    }
    results.push(item);
  }

  return results;
}

async function hasPermissionsInPath(folderPath) {
  await ensureDirs();
  const normalized = normalizeWebdavPath(folderPath);
  const normalizedNoSlash = normalized !== '/' && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const normalizedWithSlash = normalizedNoSlash === '/' ? '/' : `${normalizedNoSlash}/`;

  const userIds = await listPermissionUserIds();
  const results = [];

  for (const userId of userIds) {
    const doc = await readUserPermissionsDoc(userId);
    const perms = doc.permissions || {};

    for (const [p, permission] of Object.entries(perms)) {
      const permPath = normalizeWebdavPath(p);
      const permNoSlash = permPath !== '/' && permPath.endsWith('/') ? permPath.slice(0, -1) : permPath;

      const match =
        normalizedNoSlash === '/' ||
        permNoSlash === normalizedNoSlash ||
        permPath === normalizedWithSlash ||
        permNoSlash.startsWith(normalizedWithSlash);

      if (!match) continue;

      // Exclude parent paths when searching for child path (except root)
      if (normalizedNoSlash !== '/' && permNoSlash !== normalizedNoSlash && !permNoSlash.startsWith(normalizedWithSlash)) {
        continue;
      }

      const user = await userStore.findById(userId);
      if (!user) continue;

      results.push({
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        folder_path: permPath,
        permission,
      });
    }
  }

  return results;
}

async function rewritePermissionsForAllUsers(
  mappings = [],
  { excludePrefixes = [], duplicateExactMatches = false } = {}
) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { success: true, rewrittenUsers: 0, rewrittenKeys: 0 };
  }

  await ensureDirs();

  const normalizedMappings = mappings
    .map((m) => ({ fromPrefix: m?.fromPrefix, toPrefix: m?.toPrefix }))
    .filter((m) => typeof m.fromPrefix === 'string' && typeof m.toPrefix === 'string')
    .map((m) => ({
      fromNoSlash: normalizeNoSlash(m.fromPrefix),
      fromWithSlash: normalizeWithSlash(m.fromPrefix),
      toNoSlash: normalizeNoSlash(m.toPrefix),
      toWithSlash: normalizeWithSlash(m.toPrefix),
    }))
    .filter((m) => !(m.fromNoSlash === m.toNoSlash && m.fromWithSlash === m.toWithSlash));

  if (normalizedMappings.length === 0) {
    return { success: true, rewrittenUsers: 0, rewrittenKeys: 0 };
  }

  const normalizedExclude = Array.isArray(excludePrefixes)
    ? excludePrefixes
        .filter((p) => typeof p === 'string' && p.length > 0)
        .map((p) => ({ noSlash: normalizeNoSlash(p), withSlash: normalizeWithSlash(p) }))
    : [];

  function isExcluded(key) {
    if (normalizedExclude.length === 0) return false;
    const keyNorm = normalizeWebdavPath(key);
    for (const pref of normalizedExclude) {
      if (pref.noSlash === '/') return true;
      if (keyNorm === pref.noSlash || keyNorm === pref.withSlash) return true;
      if (keyNorm.startsWith(pref.withSlash)) return true;
    }
    return false;
  }

  return await withLock('perm:global', async () => {
    const userIds = await listPermissionUserIds();
    let rewrittenUsers = 0;
    let rewrittenKeys = 0;

    for (const userId of userIds) {

      const didRewrite = await withLock(`perm:${userId}`, async () => {
        const doc = await readUserPermissionsDoc(userId, { bypassCache: true });
        const perms = doc.permissions || {};
        const out = {};
        let changed = false;
        let keysChanged = 0;

        for (const [rawKey, perm] of Object.entries(perms)) {
          let nextKey = rawKey;
          let rewritten = false;
          let usedMapping = null;

          if (!isExcluded(rawKey)) {
            for (const mapping of normalizedMappings) {
              const candidate = rewriteKeyByMapping(rawKey, mapping);
              if (candidate) {
                nextKey = candidate;
                rewritten = true;
                usedMapping = mapping;
                break;
              }
            }
          }

          // If we only partially moved a directory tree, the source root directory may remain.
          // In that case we must keep the *exact* root ACL at the source for traversal to skipped subtrees,
          // while also granting the same ACL at the destination root.
          const shouldDuplicateExact =
            duplicateExactMatches &&
            rewritten &&
            usedMapping &&
            (normalizeWebdavPath(rawKey) === usedMapping.fromNoSlash ||
              normalizeWebdavPath(rawKey) === usedMapping.fromWithSlash);

          const writeKey = (k) => {
            if (out[k]) {
              const merged = strongerPermission(out[k], perm);
              if (merged !== out[k]) changed = true;
              out[k] = merged;
            } else {
              out[k] = perm;
            }
          };

          if (shouldDuplicateExact && nextKey !== rawKey) {
            changed = true;
            keysChanged++;
            writeKey(rawKey);
            writeKey(nextKey);
          } else {
            if (rewritten && nextKey !== rawKey) {
              changed = true;
              keysChanged++;
            }
            writeKey(nextKey);
          }
        }

        // Rewrite file_permissions keys under moved prefixes
        const fp = doc.file_permissions || {};
        if (typeof fp === 'object' && Object.keys(fp).length > 0) {
          const fpOut = {};
          for (const [rawKey, perm] of Object.entries(fp)) {
            let nextKey = rawKey;
            if (!isExcluded(rawKey)) {
              for (const mapping of normalizedMappings) {
                const candidate = rewriteKeyByMapping(rawKey, mapping);
                if (candidate) {
                  nextKey = candidate;
                  changed = true;
                  keysChanged++;
                  break;
                }
              }
            }
            if (fpOut[nextKey]) {
              fpOut[nextKey] = strongerPermission(fpOut[nextKey], perm);
            } else {
              fpOut[nextKey] = perm;
            }
          }
          doc.file_permissions = fpOut;
        }

        if (!changed) return { changed: false, keysChanged: 0 };

        doc.permissions = out;
        await writeUserPermissionsDoc(userId, doc);
        return { changed: true, keysChanged };
      });

      if (didRewrite.changed) {
        rewrittenUsers++;
        rewrittenKeys += didRewrite.keysChanged;
      }
    }

    if (rewrittenKeys > 0) {
      invalidateExistenceIndexForAclMutation('/');
    }
    return { success: true, rewrittenUsers, rewrittenKeys };
  });
}

async function revokePermissionsPrefixForAllUsers(prefixes = []) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    return { success: true, revokedUsers: 0, revokedKeys: 0 };
  }

  await ensureDirs();

  const normalizedPrefixes = prefixes
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((p) => ({ noSlash: normalizeNoSlash(p), withSlash: normalizeWithSlash(p) }));

  if (normalizedPrefixes.length === 0) {
    return { success: true, revokedUsers: 0, revokedKeys: 0 };
  }

  function matchesAnyPrefix(key) {
    const keyNorm = normalizeWebdavPath(key);
    for (const pref of normalizedPrefixes) {
      if (pref.noSlash === '/') return true;
      if (keyNorm === pref.noSlash || keyNorm === pref.withSlash) return true;
      if (keyNorm.startsWith(pref.withSlash)) return true;
    }
    return false;
  }

  return await withLock('perm:global', async () => {
    const userIds = await listPermissionUserIds();
    let revokedUsers = 0;
    let revokedKeys = 0;

    for (const userId of userIds) {

      const didRevoke = await withLock(`perm:${userId}`, async () => {
        const doc = await readUserPermissionsDoc(userId, { bypassCache: true });
        const perms = doc.permissions || {};
        const out = {};
        let removed = 0;

        for (const [rawKey, perm] of Object.entries(perms)) {
          if (matchesAnyPrefix(rawKey)) {
            removed++;
            continue;
          }
          out[rawKey] = perm;
        }

        let fileRemoved = 0;
        if (doc.file_permissions && typeof doc.file_permissions === 'object') {
          const fpOut = {};
          for (const [rawKey, perm] of Object.entries(doc.file_permissions)) {
            const keyNorm = normalizeWebdavPath(rawKey);
            const underPrefix = normalizedPrefixes.some((pref) => {
              if (pref.noSlash === '/') return true;
              return keyNorm === pref.noSlash || keyNorm === pref.withSlash || keyNorm.startsWith(pref.withSlash);
            });
            if (underPrefix) {
              fileRemoved++;
            } else {
              fpOut[rawKey] = perm;
            }
          }
          doc.file_permissions = fpOut;
        }

        if (removed === 0 && fileRemoved === 0) return { changed: false, removed: 0 };

        doc.permissions = out;
        await writeUserPermissionsDoc(userId, doc);
        return { changed: true, removed: removed + fileRemoved };
      });

      if (didRevoke.changed) {
        revokedUsers++;
        revokedKeys += didRevoke.removed;
      }
    }

    if (revokedKeys > 0) {
      invalidateExistenceIndexForAclMutation('/');
    }
    return { success: true, revokedUsers, revokedKeys };
  });
}

module.exports = {
  grantSharePermission,
  revokeSharePermission,
  getSharePermissionDoc,
  checkSharePermission,
  grant,
  revoke,
  revokeAllUserPermissions,
  deleteUserPermissionsFile,
  getUserPermissions,
  checkPermission,
  checkPermissionSync,
  getPermissionDoc,
  checkPermissions,
  getFolderPermissions,
  hasPermissionsInPath,
  rewritePermissionsForAllUsers,
  revokePermissionsPrefixForAllUsers,
  getFilePermission,
  getEffectivePermission,
  grantFilePermission,
  revokeFilePermission,
  getUserFilePermissions,
  checkFilePermissionSync,
  getPathEffectivePermission,
};

