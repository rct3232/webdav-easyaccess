'use strict';

/**
 * PermissionRepository — domain interface over the permission tables
 * (`permissions_shares`, `permissions_user_paths`, `permissions_user_files`)
 * (docs/spec/server/store/repository-contract.md).
 *
 * Pure storage operations only: the facade (`permissionStore`) owns the user
 * permission cache, the ACL existence-index invalidation, permission-rank
 * policy (meetsRank) and user lookups.
 *
 * @typedef {Object} PermissionRepository
 * @property {(token, nodeId) => Promise<void>} upsertSharePermission
 * @property {(token) => Promise<void>} deleteSharePermission
 * @property {(token, targetNodeId) => Promise<{ permission, depth }|null>} findSharePermissionForNode
 * @property {() => Promise<Array<string>>} listPermissionUserIds
 * @property {(userId, nodeId, permission) => Promise<void>} upsertPathPermission
 * @property {(userId, nodeId) => Promise<void>} deletePathPermission
 * @property {(userId) => Promise<void>} deleteAllUserPermissions
 * @property {(userId) => Promise<Array<{ file_node_id, permission, kind }>>} listPathAndFilePermissions
 * @property {(userId, nodeId) => Promise<{ permission, depth }|null>} findPathPermissionForNode
 * @property {(userId, nodeId) => Promise<Array<{ file_node_id, permission, depth }>>} findPathPermissionsForNode
 *   Plural variant without LIMIT (hasPermissionsInPath contract).
 * @property {(userId, fileNodeId, permission) => Promise<void>} upsertFilePermission
 * @property {(userId, fileNodeId) => Promise<void>} deleteFilePermission
 * @property {(userId, fileNodeId) => Promise<string|null>} findFilePermission
 * @property {(userId) => Promise<Array<{ file_node_id, permission }>>} listFilePermissions
 * @property {(userId, homeRootNodeId) => Promise<{ shared: Array }>} listSharedWithUser
 *   Deduped across both tables; rows carry name/type from file_nodes.
 * @property {(userId, homeRootNodeId) => Promise<{ removedPaths, removedFiles }>} deleteOwnSubtreePermissions
 *   Preserves the home-root (depth 0) grant.
 * @property {(userId, rootNodeId) => Promise<{ removedPaths, removedFiles }>} deleteUserSubtreePermissions
 *   Includes the root itself.
 *
 * @param {import('../../../../infrastructure/db/executor').DbExecutor} executor
 * @returns {PermissionRepository}
 */
module.exports = function createPermissionRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createPermissionRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/PermissionRepository.sqlite')
      : require('./postgres/PermissionRepository.postgres');
  return impl(executor);
};
