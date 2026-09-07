'use strict';

const { mapDatabaseError } = require('../../../../../utils/errorHandler');
const { mapPermissionRequestRow, PERMISSION_REQUEST_STATUS } = require('../permissionRequestShared');

/**
 * sqlite implementation of PermissionRequestRepository (`?` placeholders).
 * @param {import('../../../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqlitePermissionRequestRepository(executor) {
  return {
    dialect: 'sqlite',

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
             VALUES (?,?,?,?,?,?, 'pending', ?)
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
        return await executor.transaction(async (tx) => {
          const res = await tx.query(
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
    },

    async listByOwner(ownerId, status) {
      try {
        return await executor.transaction(async (tx) => {
          const params = [Number(ownerId)];
          let whereStatusSql = '';
          if (status) {
            params.push(status);
            whereStatusSql = ' AND pr.status = ?';
          }
          const res = await tx.query(
            `SELECT pr.*, fn.type AS target_type
               FROM permission_requests pr
               JOIN file_nodes fn ON fn.id = pr.file_node_id
              WHERE pr.owner_id = ?${whereStatusSql}
              ORDER BY pr.created_at DESC`,
            params
          );
          return res.rows.map(mapPermissionRequestRow);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listByRequester(requesterId, status) {
      try {
        return await executor.transaction(async (tx) => {
          const params = [Number(requesterId)];
          let whereStatusSql = '';
          if (status) {
            params.push(status);
            whereStatusSql = ' AND pr.status = ?';
          }
          const res = await tx.query(
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
    },

    async updateStatusRow(id, nextStatus, resolvedBy) {
      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query('SELECT id FROM permission_requests WHERE id = ? LIMIT 1', [
            Number(id),
          ]);
          if (existing.rows.length === 0) {
            const { createError } = require('../../../../../utils/errorHandler');
            const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
            throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
          }

          const updated = await tx.run(
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
    },

    async deleteByRequesterId(userId) {
      try {
        return await executor.transaction(async (tx) => {
          const rows = await tx.query('SELECT id FROM permission_requests WHERE requester_id = ?', [
            Number(userId),
          ]);
          await tx.run('DELETE FROM permission_requests WHERE requester_id = ?', [Number(userId)]);
          return { deletedCount: Number(rows.rows.length) };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async rejectPendingByOwnerId(userId, resolvedBy) {
      try {
        return await executor.transaction(async (tx) => {
          const rows = await tx.query(
            'SELECT id FROM permission_requests WHERE owner_id = ? AND status = ?',
            [Number(userId), PERMISSION_REQUEST_STATUS.PENDING]
          );
          await tx.run(
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
    },
  };
};
