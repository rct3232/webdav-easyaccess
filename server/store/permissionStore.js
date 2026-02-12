const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  META_ROOT,
  PERMISSIONS_DIR,
  PERMISSIONS_USERS_DIR,
  userPermissionsPathByUserId,
  normalizeWebdavPath,
} = require('./metaPaths');
const { getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { ensureDir, exists, readFile, writeFile } = require('./storage');
const { withLock } = require('./locks');
const userStore = require('./userStore');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const cache = new Map(); // userId -> { expiresAt:number, data: object }
const CACHE_TTL_MS =
  process.env.NODE_ENV === 'test'
    ? 0
    : parseInt(process.env.PERMISSION_CACHE_TTL_MS || '5000', 10) || 5000;

async function ensureDirs() {
  await ensureDir(META_ROOT);
  await ensureDir(PERMISSIONS_DIR);
  await ensureDir(PERMISSIONS_USERS_DIR);
}

async function ensureUserPermissionsFile(userId) {
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

async function grant(userId, folderPath, permission) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    doc.permissions[folder] = permission;
    await writeUserPermissionsDoc(uid, doc);
    return { id: undefined, userId: Number(uid), folderPath: folderPath, permission };
  });
}

async function revoke(userId, folderPath) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    delete doc.permissions[folder];
    removeFilePermissionsUnderPrefix(doc, folder);
    await writeUserPermissionsDoc(uid, doc);
    return { success: true };
  });
}

/**
 * Remove all file_permissions keys that are under the given folder prefix (path or path/).
 */
function removeFilePermissionsUnderPrefix(doc, folderPath) {
  if (!doc.file_permissions || typeof doc.file_permissions !== 'object') return;
  const prefixNoSlash = normalizeNoSlash(folderPath);
  const prefixWithSlash = normalizeWithSlash(folderPath);
  for (const key of Object.keys(doc.file_permissions)) {
    const keyNorm = normalizeWebdavPath(key);
    if (keyNorm === prefixNoSlash || keyNorm === prefixWithSlash) continue;
    if (prefixNoSlash === '/') {
      // revoking root: remove all
      delete doc.file_permissions[key];
    } else if (keyNorm.startsWith(prefixWithSlash) || keyNorm === prefixNoSlash) {
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
    return { success: true, deletedCount, fileDeletedCount };
  });
}

async function deleteUserPermissionsFile(userId) {
  const uid = String(userId);
  const p = userPermissionsPathByUserId(uid);
  try {
    if (await exists(p)) {
      const { deletePath } = require('./storage');
      await deletePath(p);
    }
    // 캐시에서도 제거
    cache.delete(uid);
  } catch (error) {
    console.error(`Failed to delete permission file for user ${uid}:`, error);
    // best-effort: 에러가 나도 계속 진행
  }
}

async function getUserPermissions(userId) {
  const uid = String(userId);
  const doc = await readUserPermissionsDoc(uid);
  return Object.entries(doc.permissions).map(([folder_path, permission]) => ({ folder_path, permission }));
}

function permissionRank(p) {
  const idx = PERMISSIONS.ALL.indexOf(p);
  return idx < 0 ? -1 : idx;
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
  return permissionRank(actual) >= permissionRank(requiredPermission);
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
  return permissionRank(actual) >= permissionRank(requiredPermission);
}

async function getFilePermission(userId, filePath) {
  const uid = String(userId);
  const normalized = normalizeFilePath(filePath);
  const doc = await readUserPermissionsDoc(uid);
  const fp = doc.file_permissions || {};
  const perm = fp[normalized];
  if (!perm) return null;
  return perm;
}

/**
 * Grant file-level permission. Throws if permission is not strictly higher than parent path effective permission.
 * @throws {Error} code 'PATH_IS_ADMIN' or 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH' for validation (400)
 */
async function grantFilePermission(userId, filePath, permission) {
  const uid = String(userId);
  const normalized = normalizeFilePath(filePath);
  if (!PERMISSIONS.isValid(permission)) {
    const err = new Error('Invalid permission');
    err.code = 'INVALID_PERMISSION';
    throw err;
  }
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    if (!doc.file_permissions) doc.file_permissions = {};
    const parentPath = getParentPath(normalized);
    const pathEffective = getPathEffectivePermissionFromDoc(doc, parentPath);
    if (pathEffective === PERMISSIONS.ADMIN) {
      const err = new Error('Cannot grant file permission: parent path has admin');
      err.code = 'PATH_IS_ADMIN';
      throw err;
    }
    if (!pathEffective) {
      const err = new Error('Cannot grant file permission: no permission on parent path');
      err.code = 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH';
      throw err;
    }
    if (permissionRank(permission) <= permissionRank(pathEffective)) {
      const err = new Error('File permission must be higher than parent path permission');
      err.code = 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH';
      throw err;
    }
    doc.file_permissions[normalized] = permission;
    await writeUserPermissionsDoc(uid, doc);
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
  const filePerm = fp[normalized];
  if (filePerm !== undefined && filePerm !== null) {
    return permissionRank(filePerm) >= permissionRank(requiredPermission);
  }
  const parentPath = getParentPath(normalized);
  return checkPermissionSync(doc, parentPath, requiredPermission);
}

async function getFolderPermissions(folderPath) {
  await ensureDirs();
  const folder = normalizeWebdavPath(folderPath);
  const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
  const results = [];

  for (const ent of entries) {
    if (!ent.basename || !ent.basename.endsWith('.json')) continue;
    const userId = ent.basename.replace(/\.json$/, '');
    const doc = await readUserPermissionsDoc(userId);
    const perm = doc.permissions?.[folder];
    if (!perm) continue;
    const user = await userStore.findById(userId);
    if (!user) continue;
    results.push({
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      permission: perm,
    });
  }

  return results;
}

async function hasPermissionsInPath(folderPath) {
  await ensureDirs();
  const normalized = normalizeWebdavPath(folderPath);
  const normalizedNoSlash = normalized !== '/' && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const normalizedWithSlash = normalizedNoSlash === '/' ? '/' : `${normalizedNoSlash}/`;

  const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
  const results = [];

  for (const ent of entries) {
    if (!ent.basename || !ent.basename.endsWith('.json')) continue;
    const userId = ent.basename.replace(/\.json$/, '');
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
    const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
    let rewrittenUsers = 0;
    let rewrittenKeys = 0;

    for (const ent of entries) {
      if (!ent.basename || !ent.basename.endsWith('.json')) continue;
      const userId = ent.basename.replace(/\.json$/, '');

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
    const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
    let revokedUsers = 0;
    let revokedKeys = 0;

    for (const ent of entries) {
      if (!ent.basename || !ent.basename.endsWith('.json')) continue;
      const userId = ent.basename.replace(/\.json$/, '');

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

    return { success: true, revokedUsers, revokedKeys };
  });
}

module.exports = {
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
  grantFilePermission,
  revokeFilePermission,
  getUserFilePermissions,
  checkFilePermissionSync,
  getPathEffectivePermission,
};

