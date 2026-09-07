const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { meetsRank } = require('../policy/permissionRank');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const storage = require('../../../store/storage');
const createPermissionRepository = require('./repositories/PermissionRepository');
const { invalidateExistenceIndexForAclMutation } = require('./permissionExistenceIndex');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const userStore = require('../../../store/userStore');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createPermissionRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

const cache = new Map();

/* ------------------------------------------------------------------ */
/*  Share Permissions                                                 */
/* ------------------------------------------------------------------ */

async function grantSharePermission(token, nodeId) {
  const node = Number(nodeId);
  if (!Number.isFinite(node)) {
    throw createError(SERVER_ERROR_CODES.files.invalidPath, 400);
  }
  await getRepository().upsertSharePermission(token, node);
  return { token, nodeId: node };
}

async function revokeSharePermission(token) {
  await getRepository().deleteSharePermission(token);
  return { success: true };
}

async function checkSharePermission(token, targetNodeId, requiredPermission = 'read') {
  const found = await getRepository().findSharePermissionForNode(token, targetNodeId);
  if (!found) return false;
  return meetsRank(found.permission, requiredPermission);
}

/* ------------------------------------------------------------------ */
/*  User Directory Permissions                                        */
/* ------------------------------------------------------------------ */

async function listPermissionUserIds() {
  return getRepository().listPermissionUserIds();
}

async function grant(userId, nodeId, permission) {
  const uid = Number(userId);
  const node = Number(nodeId);
  await getRepository().upsertPathPermission(uid, node, permission);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation(node);
  return { userId: uid, nodeId: node, permission };
}

async function revoke(userId, nodeId) {
  const uid = Number(userId);
  const node = Number(nodeId);
  await getRepository().deletePathPermission(uid, node);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation(node);
  return { success: true };
}

async function revokeAllUserPermissions(userId) {
  const uid = Number(userId);
  await getRepository().deleteAllUserPermissions(uid);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation('/');
  return { success: true };
}

async function deleteUserPermissionsFile(userId) {
  const uid = Number(userId);
  await getRepository().deleteAllUserPermissions(uid);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation('/');
}

async function getUserPermissions(userId) {
  const uid = Number(userId);
  const uidStr = String(uid);

  // PERMISSION_CACHE_TTL_MS is DB-only (lazy): read the effective value per call.
  // The test-mode 0 short-circuit is preserved so unit tests never cache.
  const cacheTtlMs =
    process.env.NODE_ENV === 'test'
      ? 0
      : parseInt(await getSharedResolver().getConfig('PERMISSION_CACHE_TTL_MS'), 10) || 5000;

  if (cacheTtlMs > 0) {
    const cached = cache.get(uidStr);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const rows = await getRepository().listPathAndFilePermissions(uid);
  const result = rows.map((r) => ({
    file_node_id: r.file_node_id,
    permission: r.permission,
    type: r.kind,
  }));

  if (cacheTtlMs > 0) {
    cache.set(uidStr, { expiresAt: Date.now() + cacheTtlMs, data: result });
  } else {
    cache.delete(uidStr);
  }
  return result;
}

async function checkPermission(userId, nodeId, requiredPermission) {
  const found = await getRepository().findPathPermissionForNode(userId, nodeId);
  if (!found) return false;
  return meetsRank(found.permission, requiredPermission);
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

  await getRepository().upsertFilePermission(uid, fnode, permission);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation(fnode);
  return { userId: uid, fileNodeId: fnode, permission };
}

async function revokeFilePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);
  await getRepository().deleteFilePermission(uid, fnode);
  cache.delete(String(uid));
  invalidateExistenceIndexForAclMutation(fnode);
  return { success: true };
}

async function getFilePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);
  const permission = await getRepository().findFilePermission(uid, fnode);
  if (permission === null) return null;
  return { userId: uid, fileNodeId: fnode, permission };
}

async function getUserFilePermissions(userId) {
  return getRepository().listFilePermissions(userId);
}

/* ------------------------------------------------------------------ */
/*  Shared-with-me Listing                                             */
/* ------------------------------------------------------------------ */

/**
 * List grants where the user is the grantee, excluding any node inside the
 * user's own home subtree (home root + descendants) via the closure table.
 * Each row includes the real node `name` and `type` from file_nodes.
 * @param {number} userId
 * @param {number|null} homeRootNodeId - user's home root node; when null no
 *   own-subtree exclusion is applied.
 */
async function getSharedPermissions(userId, homeRootNodeId) {
  const { shared } = await getRepository().listSharedWithUser(userId, homeRootNodeId);
  return shared;
}

/**
 * Delete the user's permission rows on proper descendants (depth > 0) of their
 * home root. Preserves the home-root ADMIN grant (depth 0).
 * @returns {Promise<{ removedPaths: number, removedFiles: number }>}
 */
async function removeOwnSubtreePermissions(userId, homeRootNodeId) {
  const result = await getRepository().deleteOwnSubtreePermissions(userId, homeRootNodeId);
  cache.delete(String(Number(userId)));
  return result;
}

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
  const result = await getRepository().deleteUserSubtreePermissions(userId, rootNodeId);
  cache.delete(String(Number(userId)));
  return result;
}

async function getEffectivePermission(userId, fileNodeId) {
  const uid = Number(userId);
  const fnode = Number(fileNodeId);

  // File-specific permission takes precedence
  const filePerm = await getFilePermission(uid, fnode);
  if (filePerm && filePerm.permission) return filePerm.permission;

  // Fall back to ancestor directory traversal
  const found = await getRepository().findPathPermissionForNode(uid, fnode);
  return found ? found.permission : null;
}

async function getPathEffectivePermission(userId, nodeId) {
  const found = await getRepository().findPathPermissionForNode(userId, nodeId);
  return found ? found.permission : null;
}

/* ------------------------------------------------------------------ */
/*  Folder / Path-level Permission Queries                             */
/* ------------------------------------------------------------------ */

async function getFolderPermissions(nodeId, fileNodeId) {
  const userIds = await listPermissionUserIds();
  const results = [];

  for (const uid of userIds) {
    const found = await getRepository().findPathPermissionForNode(uid, nodeId);
    const perm = found ? found.permission : null;

    let filePerm = null;
    if (fileNodeId != null) {
      filePerm = await getRepository().findFilePermission(uid, fileNodeId);
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
  const userIds = await listPermissionUserIds();
  const results = [];

  for (const uid of userIds) {
    // Lists every grant row in the path (no LIMIT): one result per grant row.
    const rows = await getRepository().findPathPermissionsForNode(uid, nodeId);

    for (const row of rows) {
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
