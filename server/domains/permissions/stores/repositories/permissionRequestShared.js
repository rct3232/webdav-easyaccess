'use strict';

const { PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const { toIsoString } = require('../../../../utils/sharedHelpers');

function mapPermissionRequestRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    requester_id: Number(row.requester_id),
    requester_username: row.requester_username || '',
    owner_id: Number(row.owner_id),
    owner_username: row.owner_username || '',
    file_node_id: Number(row.file_node_id),
    requested_permission: row.requested_permission,
    status: row.status,
    message: row.message || '',
    created_at: toIsoString(row.created_at),
    resolved_at: toIsoString(row.resolved_at),
    resolved_by: row.resolved_by == null ? null : Number(row.resolved_by),
    targetType: row.target_type || null,
  };
}

module.exports = { mapPermissionRequestRow, PERMISSION_REQUEST_STATUS };
