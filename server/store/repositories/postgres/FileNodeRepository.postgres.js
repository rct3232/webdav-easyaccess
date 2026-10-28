'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapNodeRow, mapChildRow } = require('../fileNodeShared');
const { toIsoString } = require('../../../utils/sharedHelpers');

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
        // DEF-16 P4: live rows only — a trashed node is invisible to getNode.
        const { rows } = await executor.query(
          `SELECT fn.*, fc.size, fc.mime_type
           FROM file_nodes fn
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE fn.id = $1 AND fn.deleted_at IS NULL LIMIT 1`,
          [Number(id)]
        );
        return mapNodeRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getNodeIncludingTrashed(id) {
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
                  fn.created_at, fn.updated_at, fn.deleted_at,
                  fc.size, fc.mime_type, fc.content_hash
           FROM file_nodes fn
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE ${parentId == null ? 'fn.parent_id IS NULL' : 'fn.parent_id = $1'}
             AND fn.deleted_at IS NULL
           ORDER BY fn.name`,
          parentId != null ? [Number(parentId)] : []
        );
        return rows.map(mapChildRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getTrashChildren(parentId) {
      try {
        const { rows } = await executor.query(
          `SELECT fn.*, fc.size, fc.mime_type
           FROM file_nodes fn
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE ${parentId == null ? 'fn.parent_id IS NULL' : 'fn.parent_id = $1'}
             AND fn.deleted_at IS NOT NULL
           ORDER BY fn.name`,
          parentId != null ? [Number(parentId)] : []
        );
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getTopmostTrashedNodes(olderThanDays) {
      try {
        const cutoff = Number.isFinite(Number(olderThanDays))
          ? ` AND fn.deleted_at < NOW() - ($1 || ' days')::interval`
          : '';
        const params = Number.isFinite(Number(olderThanDays))
          ? [String(Math.max(0, Number(olderThanDays)))]
          : [];
        const { rows } = await executor.query(
          `SELECT fn.*, fc.size, fc.mime_type
           FROM file_nodes fn
           LEFT JOIN file_nodes p ON p.id = fn.parent_id
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE fn.deleted_at IS NOT NULL
             AND (fn.parent_id IS NULL OR p.deleted_at IS NULL)${cutoff}
           ORDER BY fn.deleted_at DESC, fn.name`,
          params
        );
        return rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async markSubtreeDeleted(nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(nodeIds.length);
        const res = await executor.run(
          `UPDATE file_nodes SET deleted_at = NOW() WHERE id IN (${placeholders})`,
          nodeIds.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async untrashSubtree(nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(nodeIds.length);
        const res = await executor.run(
          `UPDATE file_nodes SET deleted_at = NULL WHERE id IN (${placeholders})`,
          nodeIds.map(Number)
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    // Caller-owned TX variant (undo executor): identical statement on `tx` so
    // the restore joins the journal transaction instead of autocommitting on a
    // separate pooled connection.
    async untrashSubtreeTx(tx, nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      try {
        const placeholders = buildInPlaceholders(nodeIds.length);
        const res = await tx.run(
          `UPDATE file_nodes SET deleted_at = NULL WHERE id IN (${placeholders})`,
          nodeIds.map(Number)
        );
        return { changes: res.changes };
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

    // Caller-owned TX variant (undo executor) — same UPDATE, `tx.run`.
    async renameNodeTx(tx, id, newName) {
      try {
        const res = await tx.run(
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
          query =
            'SELECT id FROM file_nodes WHERE parent_id IS NULL AND name = $1 AND deleted_at IS NULL LIMIT 1';
          params = [String(name)];
        } else {
          query =
            'SELECT id FROM file_nodes WHERE parent_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1';
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
        // DEF-11: the previous active row becomes managed history (not orphaned).
        await executor.run(
          `UPDATE object_map SET status = 'history' WHERE file_node_id = $1 AND status = 'active'`,
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

    async evictVersionsBeyondCap(fileNodeId, cap) {
      const maxVersions = Number(cap);
      // cap 0 (or invalid) = unbounded → no-op; the active row is never touched.
      if (!Number.isFinite(maxVersions) || maxVersions <= 0) {
        return { changes: 0 };
      }
      try {
        const res = await executor.run(
          `UPDATE object_map SET status = 'orphaned'
           WHERE file_node_id = $1 AND status = 'history'
             AND (
               SELECT COUNT(*) FROM object_map older
               WHERE older.file_node_id = $1
                 AND older.status = 'history'
                 AND older.version_number < object_map.version_number
             ) < GREATEST(
               (
                 SELECT COUNT(*)::int FROM object_map total
                 WHERE total.file_node_id = $1
                   AND total.status IN ('active', 'history')
               ) - $2, 0
             )`,
          [Number(fileNodeId), maxVersions]
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

    async getObjectMapByNode(fileNodeId) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM object_map WHERE file_node_id = $1
           ORDER BY version_number DESC, id DESC`,
          [Number(fileNodeId)]
        );
        return rows;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getObjectMapBySubtree(ancestorId) {
      try {
        const { rows } = await executor.query(
          `SELECT om.* FROM object_map om
           JOIN node_ancestors a ON a.descendant_id = om.file_node_id
           WHERE a.ancestor_id = $1
           ORDER BY om.file_node_id, om.id`,
          [Number(ancestorId)]
        );
        return rows;
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

    async demoteActiveToHistory(s3Key) {
      try {
        const res = await executor.run(
          `UPDATE object_map SET status = 'history' WHERE s3_key = $1 AND status = 'active'`,
          [String(s3Key)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async reactivateObjectMapRow(id) {
      try {
        // Guard widened by DEF-11: a history row reactivates in place on
        // version restore; the orphaned arm covers legacy residue.
        const res = await executor.run(
          `UPDATE object_map SET status = 'active' WHERE id = $1 AND status IN ('history', 'orphaned')`,
          [Number(id)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getVersionsByNode(fileNodeId) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM object_map
           WHERE file_node_id = $1 AND status IN ('active', 'history')
           ORDER BY version_number DESC`,
          [Number(fileNodeId)]
        );
        return rows;
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

    async getKeptObjectMapKeys() {
      try {
        const { rows } = await executor.query(
          `SELECT s3_key FROM object_map WHERE status = 'active' AND s3_key IS NOT NULL
           UNION
           SELECT om.s3_key FROM object_map om WHERE om.status = 'history' AND om.s3_key IS NOT NULL
           UNION
           SELECT om.s3_key FROM object_map om WHERE om.status = 'orphaned' AND om.s3_key IS NOT NULL
           UNION
           SELECT om.s3_key FROM object_map om
            JOIN file_nodes fn ON fn.id = om.file_node_id
            WHERE om.status = 'pending' AND om.s3_key IS NOT NULL
              AND fn.sync_status = 'pending_upload'`
        );
        return rows.map((r) => String(r.s3_key));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getFileNodesPathRows() {
      try {
        const { rows } = await executor.query(
          `SELECT id, parent_id, name, type, deleted_at, sync_status FROM file_nodes`
        );
        return rows;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getOrphanedObjectsWithNodeState(olderThanDays) {
      const days = Math.max(0, Number(olderThanDays) || 0);
      try {
        const { rows } = await executor.query(
          `SELECT om.*, fn.sync_status AS node_sync_status,
                  CASE WHEN EXISTS(SELECT 1 FROM object_map a WHERE a.file_node_id = om.file_node_id AND a.status = 'active') THEN 1 ELSE 0 END AS has_active
           FROM object_map om
           LEFT JOIN file_nodes fn ON fn.id = om.file_node_id
           WHERE om.status = 'orphaned'
             AND om.created_at < NOW() - ($1 || ' days')::interval`,
          [String(days)]
        );
        return rows;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getStalePendingObjects(staleThanDays) {
      const days = Math.max(0, Number(staleThanDays) || 0);
      try {
        const { rows } = await executor.query(
          `SELECT om.* FROM object_map om
           JOIN file_nodes fn ON fn.id = om.file_node_id
           WHERE om.status = 'pending'
             AND fn.sync_status = 'pending_upload'
             AND om.created_at < NOW() - ($1 || ' days')::interval`,
          [String(days)]
        );
        return rows;
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

    // ---- content-hash completeness surface (T0.1/T0.8) ------------------

    async countCacheRowsWithNullContentHash() {
      try {
        const { rows } = await executor.query(
          'SELECT COUNT(*) AS cnt FROM filecache WHERE content_hash IS NULL'
        );
        return Number(rows[0].cnt);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listCacheRowsWithNullContentHash({ limit = 500, afterId = 0 } = {}) {
      try {
        const { rows } = await executor.query(
          `SELECT fc.file_node_id, fn.name, fn.type, fn.deleted_at
             FROM filecache fc
             JOIN file_nodes fn ON fn.id = fc.file_node_id
            WHERE fc.content_hash IS NULL AND fn.type = 'file' AND fn.id > $1
            ORDER BY fc.file_node_id ASC
            LIMIT $2`,
          [Number(afterId), Number(limit)]
        );
        return rows.map((row) => ({
          nodeId: Number(row.file_node_id),
          name: row.name,
          type: row.type,
          deletedAt: toIsoString(row.deleted_at),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listSubtreeCacheRows(ancestorId) {
      try {
        const { rows } = await executor.query(
          `SELECT n.id, n.parent_id, n.name, n.type, n.created_at,
                  fc.size, fc.mime_type, fc.content_hash
             FROM file_nodes n
             JOIN node_ancestors a ON a.descendant_id = n.id
             LEFT JOIN filecache fc ON fc.file_node_id = n.id
            WHERE a.ancestor_id = $1 AND n.deleted_at IS NULL
            ORDER BY n.id`,
          [Number(ancestorId)]
        );
        return rows.map((row) => ({
          nodeId: Number(row.id),
          parentId: row.parent_id != null ? Number(row.parent_id) : null,
          name: row.name,
          type: row.type,
          createdAt: toIsoString(row.created_at),
          size: row.size != null ? Number(row.size) : null,
          mimeType: row.mime_type ?? null,
          contentHash: row.content_hash ?? null,
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    // Dashboard trash-card aggregate (T0.10): trashed FILE rows of the subtree
    // (trash marking marks the whole subtree — children of trashed folders are
    // counted once each; directories carry no filecache size).
    async summarizeTrashedSubtree(ancestorId) {
      try {
        const { rows } = await executor.query(
          `SELECT COUNT(*) AS item_count,
                  COALESCE(SUM(fc.size), 0) AS total_bytes,
                  MIN(n.deleted_at) AS oldest_deleted_at
             FROM file_nodes n
             JOIN node_ancestors a ON a.descendant_id = n.id
             LEFT JOIN filecache fc ON fc.file_node_id = n.id
            WHERE a.ancestor_id = $1 AND n.deleted_at IS NOT NULL AND n.type = 'file'`,
          [Number(ancestorId)]
        );
        const row = rows[0] || {};
        return {
          itemCount: Number(row.item_count ?? 0),
          totalBytes: Number(row.total_bytes ?? 0),
          oldestDeletedAt: toIsoString(row.oldest_deleted_at ?? null),
        };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async setCacheContentHash(fileNodeId, contentHash) {
      try {
        // Guarded on content_hash IS NULL — the idempotency contract: an
        // already-hashed row is never touched again.
        const res = await executor.run(
          `UPDATE filecache SET content_hash = $1, updated_at = NOW()
            WHERE file_node_id = $2 AND content_hash IS NULL`,
          [String(contentHash), Number(fileNodeId)]
        );
        return { changes: res.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    // ---- search surface (T0.11) ----------------------------------------

    /**
     * Name-section search over the requester-visible live rows
     * (docs/spec/server/services/searchService.md §2.5). Visibility = the
     * fileService-listing closure/owner rule: the requester's own-root subtree
     * ∪ path-granted subtrees (node + closure descendants) ∪ point-granted
     * file nodes. Matching is `lower(name) LIKE lower('%q%')` — lower() on
     * BOTH sides is mandatory and the whole query string must be contained
     * (no token split). Order: name asc, then node_id asc.
     */
    async searchNodesByName(userId, query, { limit = 200 } = {}) {
      const trimmed = String(query ?? '').trim();
      if (!trimmed) return [];
      const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 200;
      try {
        const root = await this.getUserRootNode(userId);
        const rootId = root ? Number(root.id) : null;

        let paramIndex = 0;
        const next = () => `$${(paramIndex += 1)}`;
        const params = [];
        const arms = [];
        const likeParam = next();
        params.push(trimmed);
        if (rootId != null) {
          const rootEq = next();
          const rootAnc = next();
          params.push(rootId, rootId);
          arms.push(
            `(fn.id = ${rootEq} OR EXISTS (SELECT 1 FROM node_ancestors oa WHERE oa.ancestor_id = ${rootAnc} AND oa.descendant_id = fn.id))`
          );
        }
        const pathGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_paths p WHERE p.user_id = ${pathGrant} AND (p.file_node_id = fn.id OR EXISTS (SELECT 1 FROM node_ancestors pa WHERE pa.ancestor_id = p.file_node_id AND pa.descendant_id = fn.id)))`
        );
        const fileGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_files f WHERE f.user_id = ${fileGrant} AND f.file_node_id = fn.id)`
        );
        const limitParam = next();
        params.push(cap);

        const { rows } = await executor.query(
          `SELECT fn.id, fn.name
             FROM file_nodes fn
            WHERE fn.deleted_at IS NULL
              AND lower(fn.name) LIKE lower('%' || ${likeParam} || '%')
              AND (${arms.join(' OR ')})
            ORDER BY fn.name ASC, fn.id ASC
            LIMIT ${limitParam}`,
          params
        );
        return rows.map((row) => ({ id: Number(row.id), name: row.name }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    /**
     * All live node ids visible to the requester (searchService §2.5a scorer
     * seam — the ACL anchoring set). Same visibility rule as
     * sampleVisibleNodeIds/searchNodesByName; no sampling, no limit.
     */
    async listVisibleFileNodeIds(userId) {
      try {
        const root = await this.getUserRootNode(userId);
        const rootId = root ? Number(root.id) : null;

        let paramIndex = 0;
        const next = () => `$${(paramIndex += 1)}`;
        const params = [];
        const arms = [];
        if (rootId != null) {
          const rootEq = next();
          const rootAnc = next();
          params.push(rootId, rootId);
          arms.push(
            `(fn.id = ${rootEq} OR EXISTS (SELECT 1 FROM node_ancestors oa WHERE oa.ancestor_id = ${rootAnc} AND oa.descendant_id = fn.id))`
          );
        }
        const pathGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_paths p WHERE p.user_id = ${pathGrant} AND (p.file_node_id = fn.id OR EXISTS (SELECT 1 FROM node_ancestors pa WHERE pa.ancestor_id = p.file_node_id AND pa.descendant_id = fn.id)))`
        );
        const fileGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_files f WHERE f.user_id = ${fileGrant} AND f.file_node_id = fn.id)`
        );

        const { rows } = await executor.query(
          `SELECT fn.id
             FROM file_nodes fn
            WHERE fn.deleted_at IS NULL
              AND (${arms.join(' OR ')})
            ORDER BY fn.id`,
          params
        );
        return rows.map((row) => Number(row.id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    /**
     * Random sample of at most n requester-visible live node ids
     * (searchService §2.5 — per-query dynamic-baseline corpus sample, P1).
     * Same visibility rule as searchNodesByName.
     */
    async sampleVisibleNodeIds(userId, n) {
      const size = Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0;
      if (size === 0) return [];
      try {
        const root = await this.getUserRootNode(userId);
        const rootId = root ? Number(root.id) : null;

        let paramIndex = 0;
        const next = () => `$${(paramIndex += 1)}`;
        const params = [];
        const arms = [];
        if (rootId != null) {
          const rootEq = next();
          const rootAnc = next();
          params.push(rootId, rootId);
          arms.push(
            `(fn.id = ${rootEq} OR EXISTS (SELECT 1 FROM node_ancestors oa WHERE oa.ancestor_id = ${rootAnc} AND oa.descendant_id = fn.id))`
          );
        }
        const pathGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_paths p WHERE p.user_id = ${pathGrant} AND (p.file_node_id = fn.id OR EXISTS (SELECT 1 FROM node_ancestors pa WHERE pa.ancestor_id = p.file_node_id AND pa.descendant_id = fn.id)))`
        );
        const fileGrant = next();
        params.push(Number(userId));
        arms.push(
          `EXISTS (SELECT 1 FROM permissions_user_files f WHERE f.user_id = ${fileGrant} AND f.file_node_id = fn.id)`
        );
        const limitParam = next();
        params.push(size);

        const { rows } = await executor.query(
          `SELECT fn.id
             FROM file_nodes fn
            WHERE fn.deleted_at IS NULL
              AND (${arms.join(' OR ')})
            ORDER BY RANDOM()
            LIMIT ${limitParam}`,
          params
        );
        return rows.map((row) => Number(row.id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
