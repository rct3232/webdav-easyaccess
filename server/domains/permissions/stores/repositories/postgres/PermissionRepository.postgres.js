'use strict';

const { mapDatabaseError } = require('../../../../../utils/errorHandler');
const {
  buildAncestorPermSelect,
  buildPathGrantsSql,
  buildSharedSql,
  buildRemovalSql,
  buildSubtreeRemovalSql,
} = require('../permissionShared');

/**
 * postgres implementation of PermissionRepository (`$n` placeholders).
 * @param {import('../../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresPermissionRepository(executor) {
  return {
    dialect: 'postgres',

    async upsertSharePermission(token, nodeId) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run(
            `INSERT INTO permissions_shares (token, file_node_id, permission, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (token)
             DO UPDATE
               SET file_node_id = EXCLUDED.file_node_id,
                   permission = EXCLUDED.permission,
                   updated_at = NOW()`,
            [String(token), Number(nodeId), 'read']
          );
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteSharePermission(token) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM permissions_shares WHERE token = $1', [String(token)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findSharePermissionForNode(token, targetNodeId) {
      try {
        const { rows } = await executor.query(
          buildAncestorPermSelect('permissions_shares', 'p.permission', '$2', '$1', true, 'token'),
          [Number(targetNodeId), String(token)]
        );
        return rows.length === 0 ? null : { permission: rows[0].permission, depth: Number(rows[0].depth) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listPermissionUserIds() {
      try {
        const { rows } = await executor.query(
          `SELECT DISTINCT user_id::text AS user_id
             FROM (
               SELECT user_id FROM permissions_user_paths
               UNION
               SELECT user_id FROM permissions_user_files
             ) AS permission_user_ids`
        );
        return rows.map((row) => row.user_id);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertPathPermission(userId, nodeId, permission) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run(
            `INSERT INTO permissions_user_paths (user_id, file_node_id, permission, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, file_node_id)
             DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()`,
            [Number(userId), Number(nodeId), permission]
          );
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deletePathPermission(userId, nodeId) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM permissions_user_paths WHERE user_id = $1 AND file_node_id = $2', [
            Number(userId),
            Number(nodeId),
          ]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteAllUserPermissions(userId) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM permissions_user_paths WHERE user_id = $1', [Number(userId)]);
          await tx.run('DELETE FROM permissions_user_files WHERE user_id = $1', [Number(userId)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listPathAndFilePermissions(userId) {
      try {
        const [pathRes, fileRes] = await Promise.all([
          executor.query(
            'SELECT file_node_id, permission FROM permissions_user_paths WHERE user_id = $1',
            [Number(userId)]
          ),
          executor.query(
            'SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = $1',
            [Number(userId)]
          ),
        ]);
        return [
          ...pathRes.rows.map((r) => ({
            file_node_id: Number(r.file_node_id),
            permission: r.permission,
            kind: 'directory',
          })),
          ...fileRes.rows.map((r) => ({
            file_node_id: Number(r.file_node_id),
            permission: r.permission,
            kind: 'file',
          })),
        ];
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findPathPermissionForNode(userId, nodeId) {
      try {
        const { rows } = await executor.query(
          buildAncestorPermSelect('permissions_user_paths', 'p.permission', '$2', '$1'),
          [Number(nodeId), Number(userId)]
        );
        return rows.length === 0 ? null : { permission: rows[0].permission, depth: Number(rows[0].depth) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findPathPermissionsForNode(userId, nodeId) {
      try {
        const { rows } = await executor.query(
          buildPathGrantsSql('permissions_user_paths', '$2', '$1'),
          [Number(nodeId), Number(userId)]
        );
        return rows.map((r) => ({
          file_node_id: Number(r.file_node_id),
          permission: r.permission,
          depth: Number(r.depth),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertFilePermission(userId, fileNodeId, permission) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run(
            `INSERT INTO permissions_user_files (user_id, file_node_id, permission, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, file_node_id)
             DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()`,
            [Number(userId), Number(fileNodeId), permission]
          );
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteFilePermission(userId, fileNodeId) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM permissions_user_files WHERE user_id = $1 AND file_node_id = $2', [
            Number(userId),
            Number(fileNodeId),
          ]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findFilePermission(userId, fileNodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT permission FROM permissions_user_files WHERE user_id = $1 AND file_node_id = $2 LIMIT 1',
          [Number(userId), Number(fileNodeId)]
        );
        return rows.length === 0 ? null : rows[0].permission;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listFilePermissions(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT file_node_id, permission FROM permissions_user_files WHERE user_id = $1',
          [Number(userId)]
        );
        return rows.map((r) => ({ file_node_id: Number(r.file_node_id), permission: r.permission }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listSharedWithUser(userId, homeRootNodeId) {
      const excludeOwn = homeRootNodeId != null;
      const params = excludeOwn ? [Number(userId), Number(homeRootNodeId)] : [Number(userId)];
      try {
        const [pathRes, fileRes] = await Promise.all([
          executor.query(buildSharedSql('permissions_user_paths', '$1', '$2', excludeOwn), params),
          executor.query(buildSharedSql('permissions_user_files', '$1', '$2', excludeOwn), params),
        ]);
        const seen = new Set();
        const result = [];
        for (const row of [
          ...pathRes.rows.map((r) => ({
            file_node_id: Number(r.file_node_id),
            name: r.name,
            permission: r.permission,
            type: r.type,
          })),
          ...fileRes.rows.map((r) => ({
            file_node_id: Number(r.file_node_id),
            name: r.name,
            permission: r.permission,
            type: r.type,
          })),
        ]) {
          if (seen.has(row.file_node_id)) continue;
          seen.add(row.file_node_id);
          result.push(row);
        }
        return { shared: result };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteOwnSubtreePermissions(userId, homeRootNodeId) {
      const uid = Number(userId);
      const root = Number(homeRootNodeId);
      if (!Number.isFinite(root)) return { removedPaths: 0, removedFiles: 0 };
      try {
        const pathRes = await executor.run(
          buildRemovalSql('permissions_user_paths', '$1', '$2'),
          [uid, root]
        );
        const fileRes = await executor.run(
          buildRemovalSql('permissions_user_files', '$1', '$2'),
          [uid, root]
        );
        return { removedPaths: pathRes.changes || 0, removedFiles: fileRes.changes || 0 };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteUserSubtreePermissions(userId, rootNodeId) {
      const uid = Number(userId);
      const root = Number(rootNodeId);
      if (!Number.isFinite(root)) return { removedPaths: 0, removedFiles: 0 };
      try {
        const pathRes = await executor.run(
          buildSubtreeRemovalSql('permissions_user_paths', '$1', '$2'),
          [uid, root]
        );
        const fileRes = await executor.run(
          buildSubtreeRemovalSql('permissions_user_files', '$1', '$2'),
          [uid, root]
        );
        return { removedPaths: pathRes.changes || 0, removedFiles: fileRes.changes || 0 };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
