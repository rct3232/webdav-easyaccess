'use strict';

const { mapDatabaseError, createError } = require('../../../../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  mapPermissionRequestRow,
  PERMISSION_REQUEST_STATUS,
} = require('../permissionRequestShared');

function throwRequestNotFound() {
  throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
}

/**
 * postgres implementation of PermissionRequestRepository (`$n` placeholders).
 * @param {import('../../../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresPermissionRequestRepository(executor) {
  return {
    dialect: 'postgres',

    async insertPendingRequest(data) {
      const {
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId,
        requestedPermission,
        message = '',
      } = data;
      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query(
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
              requestedPermission,
              Number(fileNodeId),
              PERMISSION_REQUEST_STATUS.PENDING,
            ]
          );
          if (existing.rows.length > 0) return mapPermissionRequestRow(existing.rows[0]);

          const inserted = await tx.run(
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
              requestedPermission,
              typeof message === 'string' ? message : '',
            ]
          );
          return mapPermissionRequestRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getById(id) {
      try {
        const { rows } = await executor.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.id = $1
            LIMIT 1`,
          [Number(id)]
        );
        return mapPermissionRequestRow(rows[0]) || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listByOwner(ownerId, status) {
      try {
        const params = [Number(ownerId)];
        let whereStatusSql = '';
        if (status) {
          params.push(status);
          whereStatusSql = ` AND pr.status = $2`;
        }
        const { rows } = await executor.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.owner_id = $1${whereStatusSql}
            ORDER BY pr.created_at DESC`,
          params
        );
        return rows.map(mapPermissionRequestRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listByRequester(requesterId, status) {
      try {
        const params = [Number(requesterId)];
        let whereStatusSql = '';
        if (status) {
          params.push(status);
          whereStatusSql = ` AND pr.status = $2`;
        }
        const { rows } = await executor.query(
          `SELECT pr.*, fn.type AS target_type
             FROM permission_requests pr
             JOIN file_nodes fn ON fn.id = pr.file_node_id
            WHERE pr.requester_id = $1${whereStatusSql}
            ORDER BY pr.created_at DESC`,
          params
        );
        return rows.map(mapPermissionRequestRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateStatusRow(id, nextStatus, resolvedBy) {
      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query(
            'SELECT id FROM permission_requests WHERE id = $1 LIMIT 1',
            [Number(id)]
          );
          if (existing.rows.length === 0) throwRequestNotFound();

          const updated = await tx.run(
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
    },

    async deleteByRequesterId(userId) {
      try {
        return await executor.transaction(async (tx) => {
          const deleted = await tx.run('DELETE FROM permission_requests WHERE requester_id = $1', [
            Number(userId),
          ]);
          return { deletedCount: Number(deleted.changes || 0) };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async rejectPendingByOwnerId(userId, resolvedBy) {
      try {
        return await executor.transaction(async (tx) => {
          const rejected = await tx.run(
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
          return { rejectedCount: Number(rejected.changes || 0) };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
