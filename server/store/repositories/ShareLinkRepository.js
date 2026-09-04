'use strict';

/**
 * ShareLinkRepository — domain interface over the `share_links` table
 * (docs/spec/server/store/repository-contract.md). Absorbs the (previously
 * vestigial) share-link half of the former metadata adapters.
 *
 * Rows are mapped to the canonical link object:
 * `{ token, nodeId, fileNodeId, createdBy, createdAt, expiresAt, downloadCount }`.
 *
 * @typedef {Object} ShareLinkRepository
 * @property {({ token, fileNodeId, createdBy, expiresInDays? }) => Promise<Object>} createShareLink
 *   Idempotent: an existing token returns the existing link.
 * @property {(token: string) => Promise<Object|null>} getShareLink
 * @property {(userId) => Promise<Array<Object>>} getUserShareLinks
 *   Newest first.
 * @property {(token: string, updates: { expiresAt?, downloadCount? }) => Promise<Object>} updateShareLink
 *   Partial update; 404 `share.shareLinkNotFound` when the token is missing.
 * @property {(token: string) => Promise<void>} deleteShareLink
 * @property {(token: string) => Promise<Object>} incrementDownloadCount
 *   Atomic increment; 404 when the token is missing.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {ShareLinkRepository}
 */
function mapShareLinkRow(row) {
  const { toIsoString } = require('../../utils/sharedHelpers');
  if (!row) return null;
  return {
    token: row.token,
    nodeId: Number(row.file_node_id),
    fileNodeId: Number(row.file_node_id),
    createdBy: Number(row.created_by),
    createdAt: toIsoString(row.created_at),
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : null,
    downloadCount: Number(row.download_count || 0),
  };
}

function buildExpiresAt(expiresInDays) {
  if (expiresInDays !== null && expiresInDays !== undefined) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);
    return expiryDate.toISOString();
  }
  return null;
}

module.exports = function createShareLinkRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createShareLinkRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/ShareLinkRepository.sqlite')
      : require('./postgres/ShareLinkRepository.postgres');
  return impl(executor, { mapShareLinkRow, buildExpiresAt });
};
