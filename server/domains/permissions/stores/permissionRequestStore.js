const { PERMISSIONS, PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const {
  getBackend,
  withTransaction,
  getPgPool,
  isSqliteBackend,
  withSqliteTransaction,
} = require('../../../store/storage');
const { mapDatabaseError } = require('../../../utils/errorHandler');
const { toIsoString } = require('../../../utils/sharedHelpers');

function normalizePermission(p) {
  if (p === PERMISSIONS.READ || p === PERMISSIONS.WRITE) return p;
  return null;
}

function normalizeStatus(s) {
  return PERMISSION_REQUEST_STATUS.isValid(s) ? s : null;
}

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

async function createRequest({
  requesterId,
  requesterUsername,
  ownerId,
  ownerUsername,
  fileNodeId,
  requestedPermission,
  message = '',
}) {
  const perm = normalizePermission(requestedPermission);
  if (!perm) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidPermission, 400);
  }

  if (!fileNodeId || !Number.isInteger(fileNodeId)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired, 400);
  }

  if (getBackend() === 'postgresql') {
    try {
      return await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM permission_requests
            WHERE requester_id = $1
              AND owner_id = $2
              AND requested_permission = $3
              AND file_node_id = $4
              AND status = $5
            ORDER BY created_at DESC
            LIMIT 1`,
          [
            Number(requesterId),
            Number(ownerId),
            perm,
            Number(fileNodeId),
            PERMISSION_REQUEST_STATUS.PENDING,
          ]
        );
        if (existing.rows.length > 0) {
          return mapPermissionRequestRow(existing.rows[0]);
        }

        const inserted = await client.query(
          `INSERT INTO permission_requests (
             requester_id,
             requester_username,
             owner_id,
             owner_username,
             file_node_id,
             requested_permission,
             status,
             message
           )
           VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
           RETURNING *`,
          [
            Number(requesterId),
            requesterUsername || '',
            Number(ownerId),
            ownerUsername || '',
            Number(fileNodeId),
            perm,
            typeof message === 'string' ? message : '',
          ]
        );
        return mapPermissionRequestRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM permission_requests
            WHERE requester_id = ?
              AND owner_id = ?
              AND requested_permission = ?
              AND file_node_id = ?
              AND status = ?
            ORDER BY created_at DESC
            LIMIT 1`,
          [
            Number(requesterId),
            Number(ownerId),
            perm,
            Number(fileNodeId),
            PERMISSION_REQUEST_STATUS.PENDING,
          ]
        );
        if (existing.rows.length > 0) {
          return mapPermissionRequestRow(existing.rows[0]);
        }

        const inserted = await client.query(
          `INSERT INTO permission_requests (
             requester_id,
             requester_username,
             owner_id,
             owner_username,
             file_node_id,
             requested_permission,
             status,
             message
           )
           VALUES (?,?,?,?,?,?, 'pending', ?)
           RETURNING *`,
          [
            Number(requesterId),
            requesterUsername || '',
            Number(ownerId),
            ownerUsername || '',
            Number(fileNodeId),
            perm,
            typeof message === 'string' ? message : '',
          ]
        );
        return mapPermissionRequestRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function getById(id) {
  if (getBackend() === 'postgresql') {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT pr.*, fn.type AS target_type
           FROM permission_requests pr
           JOIN file_nodes fn ON fn.id = pr.file_node_id
          WHERE pr.id = $1
          LIMIT 1`,
        [Number(id)]
      );
      return mapPermissionRequestRow(res.rows[0]) || null;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const res = await client.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.id = ?
            LIMIT 1`,
          [Number(id)]
        );
        return mapPermissionRequestRow(res.rows[0]) || null;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function listInbox(ownerId, { status } = {}) {
  const normalizedStatus = status ? normalizeStatus(status) : null;

  if (getBackend() === 'postgresql') {
    try {
      const pool = getPgPool();
      const params = [Number(ownerId)];
      let whereStatusSql = '';
      if (normalizedStatus) {
        params.push(normalizedStatus);
        whereStatusSql = ` AND pr.status = $2`;
      }
      const res = await pool.query(
        `SELECT pr.*, fn.type AS target_type
           FROM permission_requests pr
           JOIN file_nodes fn ON fn.id = pr.file_node_id
          WHERE pr.owner_id = $1${whereStatusSql}
          ORDER BY pr.created_at DESC`,
        params
      );
      return res.rows.map(mapPermissionRequestRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const params = [Number(ownerId)];
        let whereStatusSql = '';
        let paramPlaceholder = '?';
        if (normalizedStatus) {
          params.push(normalizedStatus);
          whereStatusSql = ' AND pr.status = ?';
          paramPlaceholder = '?';
        }
        const res = await client.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.owner_id = ${paramPlaceholder}${whereStatusSql}
            ORDER BY pr.created_at DESC`,
          params
        );
        return res.rows.map(mapPermissionRequestRow);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function listOutbox(requesterId, { status } = {}) {
  const normalizedStatus = status ? normalizeStatus(status) : null;

  if (getBackend() === 'postgresql') {
    try {
      const pool = getPgPool();
      const params = [Number(requesterId)];
      let whereStatusSql = '';
      if (normalizedStatus) {
        params.push(normalizedStatus);
        whereStatusSql = ` AND pr.status = $2`;
      }
      const res = await pool.query(
        `SELECT pr.*, fn.type AS target_type
           FROM permission_requests pr
           JOIN file_nodes fn ON fn.id = pr.file_node_id
          WHERE pr.requester_id = $1${whereStatusSql}
          ORDER BY pr.created_at DESC`,
        params
      );
      return res.rows.map(mapPermissionRequestRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const params = [Number(requesterId)];
        let whereStatusSql = '';
        if (normalizedStatus) {
          params.push(normalizedStatus);
          whereStatusSql = ' AND pr.status = ?';
        }
        const res = await client.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.requester_id = ?${whereStatusSql}
            ORDER BY pr.created_at DESC`,
          params
        );
        return res.rows.map(mapPermissionRequestRow);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function updateStatus(id, { status, resolvedBy } = {}) {
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidStatus, 400);
  }

  if (getBackend() === 'postgresql') {
    try {
      return await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id FROM permission_requests WHERE id = $1 LIMIT 1`,
          [Number(id)]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
        }

        const updated = await client.query(
          `UPDATE permission_requests
              SET status = $2,
                  resolved_at = CASE WHEN $2 = $3 THEN NULL ELSE NOW() END,
                  resolved_by = CASE WHEN $2 = $3 THEN NULL ELSE $4::BIGINT END
            WHERE id = $1
            RETURNING *`,
          [
            Number(id),
            nextStatus,
            PERMISSION_REQUEST_STATUS.PENDING,
            Number.isInteger(resolvedBy) ? resolvedBy : null,
          ]
        );
        return mapPermissionRequestRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id FROM permission_requests WHERE id = ? LIMIT 1`,
          [Number(id)]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
        }

        const updated = await client.query(
          `UPDATE permission_requests
              SET status = ?,
                  resolved_at = CASE WHEN ? = ? THEN NULL ELSE CURRENT_TIMESTAMP END,
                  resolved_by = CASE WHEN ? = ? THEN NULL ELSE ? END
            WHERE id = ?
            RETURNING *`,
          [
            nextStatus,
            nextStatus,
            PERMISSION_REQUEST_STATUS.PENDING,
            nextStatus,
            PERMISSION_REQUEST_STATUS.PENDING,
            Number.isInteger(resolvedBy) ? resolvedBy : null,
            Number(id),
          ]
        );
        return mapPermissionRequestRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function deleteByRequesterId(userId) {
  if (getBackend() === 'postgresql') {
    try {
      return await withTransaction(async (client) => {
        const deleted = await client.query(
          `DELETE FROM permission_requests WHERE requester_id = $1`,
          [Number(userId)]
        );
        return { deletedCount: Number(deleted.rowCount || 0) };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const rows = await client.query(
          `SELECT id FROM permission_requests WHERE requester_id = ?`,
          [Number(userId)]
        );
        await client.query(`DELETE FROM permission_requests WHERE requester_id = ?`, [
          Number(userId),
        ]);
        return { deletedCount: Number(rows.rows.length) };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

async function rejectByOwnerId(userId, resolvedBy = null) {
  if (getBackend() === 'postgresql') {
    try {
      return await withTransaction(async (client) => {
        const rejected = await client.query(
          `UPDATE permission_requests
              SET status = $2,
                  resolved_at = NOW(),
                  resolved_by = $3
            WHERE owner_id = $1
              AND status = $4`,
          [
            Number(userId),
            PERMISSION_REQUEST_STATUS.REJECTED,
            Number.isInteger(resolvedBy) ? resolvedBy : null,
            PERMISSION_REQUEST_STATUS.PENDING,
          ]
        );
        return { rejectedCount: Number(rejected.rowCount || 0) };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await withSqliteTransaction(async (client) => {
        const rows = await client.query(
          `SELECT id FROM permission_requests WHERE owner_id = ? AND status = ?`,
          [Number(userId), PERMISSION_REQUEST_STATUS.PENDING]
        );
        await client.query(
          `UPDATE permission_requests
              SET status = ?,
                  resolved_at = CURRENT_TIMESTAMP,
                  resolved_by = ?
            WHERE owner_id = ?
              AND status = ?`,
          [
            PERMISSION_REQUEST_STATUS.REJECTED,
            Number.isInteger(resolvedBy) ? resolvedBy : null,
            Number(userId),
            PERMISSION_REQUEST_STATUS.PENDING,
          ]
        );
        return { rejectedCount: Number(rows.rows.length) };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw createError(SERVER_ERROR_CODES.storage.postgresqlNotConfigured, 500, {
    reason: 'unsupported_backend',
  });
}

module.exports = {
  createRequest,
  getById,
  listInbox,
  listOutbox,
  updateStatus,
  deleteByRequesterId,
  rejectByOwnerId,
};
