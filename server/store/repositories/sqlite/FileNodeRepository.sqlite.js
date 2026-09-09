'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapNodeRow, mapChildRow } = require('../fileNodeShared');

/**
 * sqlite implementation of FileNodeRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteFileNodeRepository(executor) {
  function buildQuestionPlaceholders(count) {
    return Array(count).fill('?').join(', ');
  }

  return {
    dialect: 'sqlite',

    async createNode(parentId, name, type) {
      try {
        const run = await executor.run(
          `INSERT INTO file_nodes (parent_id, name, type, sync_status)
           VALUES (?, ?, ?, 'pending_upload')`,
          [parentId != null ? Number(parentId) : null, String(name), String(type)]
        );
        const { rows } = await executor.query(
          `SELECT id, parent_id, name, type, sync_status
           FROM file_nodes
           WHERE id = ?`,
          [run.lastId]
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
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE id = ? LIMIT 1', [
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
           WHERE ${parentId == null ? 'fn.parent_id IS NULL' : 'fn.parent_id = ?'}
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
          `UPDATE file_nodes SET name = ?, updated_at = datetime('now') WHERE id = ?`,
          [String(newName), Number(id)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async moveNode(id, newParentId) {
      try {
        const res = await executor.run(
          `UPDATE file_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [newParentId != null ? Number(newParentId) : null, Number(id)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteNodeTree(nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildQuestionPlaceholders(nodeIds.length);
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
          `UPDATE file_nodes SET sync_status = ?, updated_at = datetime('now') WHERE id = ?`,
          [String(status), Number(id)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async resolvePathSegment(parentId, name) {
      try {
        let query;
        const params = [String(name)];
        if (parentId == null) {
          query = 'SELECT id FROM file_nodes WHERE parent_id IS NULL AND name = ? LIMIT 1';
        } else {
          query = 'SELECT id FROM file_nodes WHERE parent_id = ? AND name = ? LIMIT 1';
          params.unshift(Number(parentId));
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
        let totalChanges = 0;
        for (const r of rows) {
          const res = await executor.run(
            `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)`,
            [Number(r.ancestorId), Number(r.descendantId), Number(r.depth)]
          );
          totalChanges += res.changes;
        }
        return { changes: totalChanges };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteAncestorByDescendant(descendantIds) {
      if (!descendantIds || descendantIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildQuestionPlaceholders(descendantIds.length);
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
        const placeholders = buildQuestionPlaceholders(ancestorIds.length);
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
          'SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ?',
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
           WHERE a.ancestor_id = ?`,
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
          'SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth DESC',
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
          'SELECT 1 FROM node_ancestors WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1',
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
          'SELECT * FROM file_nodes WHERE parent_id IS NULL AND name = ? LIMIT 1',
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
          `UPDATE object_map SET status = 'orphaned' WHERE file_node_id = ? AND status = 'active'`,
          [Number(fileNodeId)]
        );
        const verRes = await executor.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM object_map WHERE file_node_id = ?`,
          [Number(fileNodeId)]
        );
        const versionNumber = Number(verRes.rows[0].next_ver);
        const res = await executor.run(
          `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
           VALUES (?, ?, 's3', ?, ?)`,
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
           WHERE file_node_id = ? AND status = 'active'`,
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
           VALUES (?, ?, 's3', 1, ?)`,
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
          `SELECT * FROM object_map WHERE file_node_id = ? AND status = 'active' LIMIT 1`,
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
          `SELECT * FROM object_map WHERE s3_key = ? AND status IN ('pending', 'active') LIMIT 1`,
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
          `UPDATE object_map SET status = 'active' WHERE s3_key = ? AND status = 'pending'`,
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
          `UPDATE object_map SET status = 'orphaned' WHERE s3_key = ? AND status IN ('active', 'pending')`,
          [String(s3Key)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async reactivateObjectMapRow(id) {
      try {
        const res = await executor.run(
          `UPDATE object_map SET status = 'active' WHERE id = ? AND status = 'orphaned'`,
          [Number(id)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async countActiveObjectsByS3Key(s3Key) {
      try {
        const { rows } = await executor.query(
          `SELECT COUNT(*) AS count FROM object_map WHERE s3_key = ? AND status = 'active'`,
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
             AND created_at < datetime('now', ?)`,
          [`-${days} days`]
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
        let totalChanges = 0;
        for (const id of ids) {
          const res = await executor.run('DELETE FROM object_map WHERE id = ?', [Number(id)]);
          totalChanges += res.changes;
        }
        return { changes: totalChanges };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNodesBySyncStatus(status) {
      try {
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE sync_status = ?', [
          String(status),
        ]);
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNodesBySyncStatusNot(status) {
      try {
        const { rows } = await executor.query('SELECT * FROM file_nodes WHERE sync_status != ?', [
          String(status),
        ]);
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertCache(fileNodeId, size, mimeType, contentHash) {
      try {
        const existing = await executor.query(
          'SELECT 1 FROM filecache WHERE file_node_id = ? LIMIT 1',
          [Number(fileNodeId)]
        );
        if (existing.rows.length > 0) {
          const res = await executor.run(
            `UPDATE filecache SET size = ?, mime_type = ?, content_hash = ?, updated_at = datetime('now')
             WHERE file_node_id = ?`,
            [Number(size), mimeType || null, contentHash || null, Number(fileNodeId)]
          );
          return { changes: res.changes };
        }

        const res = await executor.run(
          `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
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
          'SELECT * FROM filecache WHERE file_node_id = ? LIMIT 1',
          [Number(fileNodeId)]
        );
        return rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteCache(fileNodeId) {
      try {
        const res = await executor.run('DELETE FROM filecache WHERE file_node_id = ?', [
          Number(fileNodeId),
        ]);
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
