'use strict';

/**
 * PermissionRequestRepository — domain interface over `permission_requests`
 * (docs/spec/server/store/repository-contract.md). Method set mirrors the
 * former `permissionRequestStore` module exports (facade parity).
 *
 * Validation (permission/status normalization, 400s) stays in the facade
 * layer — repositories own storage concerns only.
 *
 * @typedef {Object} PermissionRequestRepository
 * @property {(data) => Promise<Object>} insertPendingRequest — returns existing
 *   pending dedupe row when one matches.
 * @property {(id) => Promise<Object|null>} getById
 * @property {(ownerId, status|null) => Promise<Array<Object>>} listByOwner
 * @property {(requesterId, status|null) => Promise<Array<Object>>} listByRequester
 * @property {(id, nextStatus, resolvedBy) => Promise<Object>} updateStatusRow
 *   404 when the id does not exist (mapped by the facade contract).
 * @property {(userId) => Promise<{ deletedCount: number }>} deleteByRequesterId
 * @property {(userId, resolvedBy) => Promise<{ rejectedCount: number }>} rejectPendingByOwnerId
 *
 * @param {import('../../../../infrastructure/db/executor').DbExecutor} executor
 * @returns {PermissionRequestRepository}
 */
module.exports = function createPermissionRequestRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createPermissionRequestRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/PermissionRequestRepository.sqlite')
      : require('./postgres/PermissionRequestRepository.postgres');
  return impl(executor);
};
