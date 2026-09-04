'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapNodeRow, mapChildRow } = require('../fileNodeShared');

/**
 * postgres implementation of FileNodeRepository (`$n` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresFileNodeRepository(executor) {
  function buildInPlaceholders(count) {
    return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
  }

  return {
    dialect: 'postgres',

    async createNode(parentId, name, type) {
      try {
        const { rows } = await executor.query(
          `INSERT INTO file_nodes (parent_id, name, type, sync_status)
           VALUES ($1, $2, $3, 'pending_upload')
           RETURNING id, parent_id, name, type, sync_status`,
          [parentId != null ? Number(parentId) : null, String(name), String(type)]
        );
        const row = rows[0];
        return {
          id: Number(row.id),
          parentId: row.parent_id != null ? Number(row.parent_id) : null,
          name: row.name,
          type: row.type,
          syncStatus: row.sync_status,
        };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNode(id) {
      try {
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE id = $1 LIMIT 1', [
          Number(id),
        ]);
        return mapNodeRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getChildren(parentId) {
      try {
        const { rows } = await executor.query(
          `SELECT fn.id, fn.parent_id, fn.name, fn.type, fn.sync_status,
                  fn.created_at, fn.updated_at,
                  fc.size, fc.mime_type, fc.content_hash
           FROM file_nodes fn
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE ${parentId == null ? 'fn.parent_id IS NULL' : 'fn.parent_id = $1'}
           ORDER BY fn.name`,
          parentId != null ? [Number(parentId)] : []
        );
        return rows.map(mapChildRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async renameNode(id, newName) {
      try {
        const res = await executor.run(
          `UPDATE file_nodes SET name = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), String(newName)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async moveNode(id, newParentId) {
      try {
        const res = await executor.run(
          `UPDATE file_nodes SET parent_id = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), newParentId != null ? Number(newParentId) : null]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteNodeTree(nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(nodeIds.length);
        const res = await executor.run(
          `DELETE FROM file_nodes WHERE id IN (${placeholders})`,
          nodeIds.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateSyncStatus(id, status) {
      try {
        const res = await executor.run(
          `UPDATE file_nodes SET sync_status = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), String(status)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async resolvePathSegment(parentId, name) {
      try {
        let query;
        let params;
        if (parentId == null) {
          query = 'SELECT id FROM file_nodes WHERE parent_id IS NULL AND name = $1 LIMIT 1';
          params = [String(name)];
        } else {
          query = 'SELECT id FROM file_nodes WHERE parent_id = $1 AND name = $2 LIMIT 1';
          params = [Number(parentId), String(name)];
        }
        const { rows } = await executor.query(query, params);
        if (rows.length === 0) return null;
        return { id: Number(rows[0].id) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async insertAncestorRows(rows) {
      if (!rows || rows.length === 0) return { changes: 0 };
      try {
        const valueGroups = rows
          .map((_, i) => {
            const base = i * 3;
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          })
          .join(', ');
        const values = [];
        for (const r of rows) {
          values.push(Number(r.ancestorId), Number(r.descendantId), Number(r.depth));
        }
        const res = await executor.run(
          `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES ${valueGroups}`,
          values
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteAncestorByDescendant(descendantIds) {
      if (!descendantIds || descendantIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(descendantIds.length);
        const res = await executor.run(
          `DELETE FROM node_ancestors WHERE descendant_id IN (${placeholders})`,
          descendantIds.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteAncestorByAncestor(ancestorIds) {
      if (!ancestorIds || ancestorIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(ancestorIds.length);
        const res = await executor.run(
          `DELETE FROM node_ancestors WHERE ancestor_id IN (${placeholders})`,
          ancestorIds.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getDescendantIds(ancestorId) {
      try {
        const { rows } = await executor.query(
          'SELECT descendant_id FROM node_ancestors WHERE ancestor_id = $1',
          [Number(ancestorId)]
        );
        return rows.map((r) => Number(r.descendant_id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getDescendants(ancestorId) {
      try {
        const { rows } = await executor.query(
          `SELECT n.* FROM file_nodes n
           JOIN node_ancestors a ON a.descendant_id = n.id
           WHERE a.ancestor_id = $1`,
          [Number(ancestorId)]
        );
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getAncestorChain(descendantId) {
      try {
        const { rows } = await executor.query(
          'SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = $1 ORDER BY depth DESC',
          [Number(descendantId)]
        );
        return rows.map((r) => ({
          ancestorId: Number(r.ancestor_id),
          depth: Number(r.depth),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async isAncestor(ancestorId, descendantId) {
      try {
        const { rows } = await executor.query(
          'SELECT 1 FROM node_ancestors WHERE ancestor_id = $1 AND descendant_id = $2 LIMIT 1',
          [Number(ancestorId), Number(descendantId)]
        );
        return rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getUserRootNode(userId) {
      const userStore = require('../../userStore');
      const user = await userStore.findById(Number(userId));
      if (!user || !user.username) return null;
      try {
        const { rows } = await executor.query(
          'SELECT * FROM file_nodes WHERE parent_id IS NULL AND name = $1 LIMIT 1',
          [String(user.username)]
        );
        return mapNodeRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertObjectMap(fileNodeId, s3Key, status) {
      try {
        await executor.run(
          `UPDATE object_map SET status = 'orphaned' WHERE file_node_id = $1 AND status = 'active'`,
          [Number(fileNodeId)]
        );
        const verRes = await executor.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM object_map WHERE file_node_id = $1`,
          [Number(fileNodeId)]
        );
        const versionNumber = Number(verRes.rows[0].next_ver);
        const res = await executor.run(
          `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
           VALUES ($1, $2, 's3', $3, $4)`,
          [Number(fileNodeId), String(s3Key), versionNumber, String(status)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async setObjectMapBackendWebdav(fileNodeId) {
      try {
        const res = await executor.run(
          `UPDATE object_map SET storage_backend = 'webdav'
           WHERE file_node_id = $1 AND status = 'active'`,
          [Number(fileNodeId)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async insertObject(fileNodeId, s3Key, status) {
      try {
        const res = await executor.run(
          `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
           VALUES ($1, $2, 's3', 1, $3)`,
          [Number(fileNodeId), String(s3Key), String(status)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getActiveObject(fileNodeId) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM object_map WHERE file_node_id = $1 AND status = 'active' LIMIT 1`,
          [Number(fileNodeId)]
        );
        return rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getObjectMapByS3Key(s3Key) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM object_map WHERE s3_key = $1 AND status IN ('pending', 'active') LIMIT 1`,
          [String(s3Key)]
        );
        return rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async activateObject(s3Key) {
      try {
        const res = await executor.run(
          `UPDATE object_map SET status = 'active' WHERE s3_key = $1 AND status = 'pending'`,
          [String(s3Key)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async orphanObject(s3Key) {
      try {
        const res = await executor.run(
          `UPDATE object_map SET status = 'orphaned' WHERE s3_key = $1 AND status IN ('active', 'pending')`,
          [String(s3Key)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async countActiveObjectsByS3Key(s3Key) {
      try {
        const { rows } = await executor.query(
          `SELECT COUNT(*)::int AS count FROM object_map WHERE s3_key = $1 AND status = 'active'`,
          [String(s3Key)]
        );
        return Number(rows[0].count);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getOrphanedObjects(olderThanDays) {
      const days = Math.max(0, Number(olderThanDays) || 0);
      try {
        const { rows } = await executor.query(
          `SELECT * FROM object_map
           WHERE status = 'orphaned'
             AND created_at < NOW() - ($1 || ' days')::interval`,
          [String(days)]
        );
        return rows;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getAllActiveS3Keys() {
      try {
        const { rows } = await executor.query(
          `SELECT s3_key FROM object_map WHERE status = 'active' AND s3_key IS NOT NULL`
        );
        return rows.map((r) => String(r.s3_key));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteObjectMapRows(ids) {
      if (!ids || ids.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(ids.length);
        const res = await executor.run(
          `DELETE FROM object_map WHERE id IN (${placeholders})`,
          ids.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNodesBySyncStatus(status) {
      try {
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE sync_status = $1', [
          String(status),
        ]);
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNodesBySyncStatusNot(status) {
      try {
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE sync_status != $1', [
          String(status),
        ]);
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertCache(fileNodeId, size, mimeType, contentHash) {
      try {
        const res = await executor.run(
          `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (file_node_id) DO UPDATE SET
             size       = EXCLUDED.size,
             mime_type  = EXCLUDED.mime_type,
             content_hash = EXCLUDED.content_hash,
             updated_at = NOW()`,
          [Number(fileNodeId), Number(size), mimeType || null, contentHash || null]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getCache(fileNodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM filecache WHERE file_node_id = $1 LIMIT 1',
          [Number(fileNodeId)]
        );
        return rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteCache(fileNodeId) {
      try {
        const res = await executor.run('DELETE FROM filecache WHERE file_node_id = $1', [
          Number(fileNodeId),
        ]);
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
