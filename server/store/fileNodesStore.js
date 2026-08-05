'use strict';

const storage = require('./storage');
const { mapDatabaseError } = require('../utils/errorHandler');

/**
 * Factory: create a file-nodes store bound to one backend at creation time.
 */
function createFileNodesStore() {
  const isPg = storage.getBackend() === 'postgresql';

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function buildInPlaceholders(count) {
    return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
  }

  function buildQuestionPlaceholders(count) {
    return Array(count).fill('?').join(', ');
  }

  /* ------------------------------------------------------------------ */
  /*  Row mappers                                                       */
  /* ------------------------------------------------------------------ */

  // Map file_nodes columns to camelCase; convert bigint ids.
  function mapNodeRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      parentId: row.parent_id != null ? Number(row.parent_id) : null,
      name: row.name,
      type: row.type,
      syncStatus: row.sync_status,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  // Map children rows (file_nodes LEFT JOIN filecache).
  function mapChildRow(row) {
    if (!row) return null;
    const base = {
      id: Number(row.id),
      parentId: row.parent_id != null ? Number(row.parent_id) : null,
      name: row.name,
      type: row.type,
      syncStatus: row.sync_status,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
    if (row.size !== undefined && row.size !== null) {
      base.size = Number(row.size);
    }
    if (row.mime_type !== undefined) {
      base.mimeType = row.mime_type;
    }
    if (row.content_hash !== undefined) {
      base.contentHash = row.content_hash;
    }
    return base;
  }

  /* ------------------------------------------------------------------ */
  /*  file_nodes operations                                              */
  /* ------------------------------------------------------------------ */

  async function createNode(parentId, name, type) {
    let node;

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `INSERT INTO file_nodes (parent_id, name, type, sync_status)
           VALUES ($1, $2, $3, 'pending_upload')
           RETURNING id, parent_id, name, type, sync_status`,
          [parentId != null ? Number(parentId) : null, String(name), String(type)]
        );
        const row = res.rows[0];
        node = {
          id: Number(row.id),
          parentId: row.parent_id != null ? Number(row.parent_id) : null,
          name: row.name,
          type: row.type,
          syncStatus: row.sync_status,
        };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    } else {
      try {
        const run = await storage.sqliteRun(
          `INSERT INTO file_nodes (parent_id, name, type, sync_status)
           VALUES (?, ?, ?, 'pending_upload')`,
          [parentId != null ? Number(parentId) : null, String(name), String(type)]
        );
        const insertedId = run.lastID;
        const res = await storage.sqliteQuery(
          `SELECT id, parent_id, name, type, sync_status
           FROM file_nodes
           WHERE id = ?`,
          [insertedId]
        );
        const row = res.rows[0];
        node = {
          id: Number(row.id),
          parentId: row.parent_id != null ? Number(row.parent_id) : null,
          name: row.name,
          type: row.type,
          syncStatus: row.sync_status,
        };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    return node;
  }

  async function getNode(id) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          'SELECT * FROM file_nodes WHERE id = $1 LIMIT 1',
          [Number(id)]
        );
        return mapNodeRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        'SELECT * FROM file_nodes WHERE id = ? LIMIT 1',
        [Number(id)]
      );
      return mapNodeRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getChildren(parentId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT fn.id, fn.parent_id, fn.name, fn.type, fn.sync_status,
                  fn.created_at, fn.updated_at,
                  fc.size, fc.mime_type, fc.content_hash
           FROM file_nodes fn
           LEFT JOIN filecache fc ON fc.file_node_id = fn.id
           WHERE fn.parent_id = $1
           ORDER BY fn.name`,
          [parentId != null ? Number(parentId) : null]
        );
        return res.rows.map(mapChildRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT fn.id, fn.parent_id, fn.name, fn.type, fn.sync_status,
                fn.created_at, fn.updated_at,
                fc.size, fc.mime_type, fc.content_hash
         FROM file_nodes fn
         LEFT JOIN filecache fc ON fc.file_node_id = fn.id
         WHERE fn.parent_id = ?
         ORDER BY fn.name`,
        [parentId != null ? Number(parentId) : null]
      );
      return res.rows.map(mapChildRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function renameNode(id, newName) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `UPDATE file_nodes SET name = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), String(newName)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `UPDATE file_nodes SET name = ?, updated_at = datetime('now') WHERE id = ?`,
        [String(newName), Number(id)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function moveNode(id, newParentId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `UPDATE file_nodes SET parent_id = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), newParentId != null ? Number(newParentId) : null]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `UPDATE file_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [newParentId != null ? Number(newParentId) : null, Number(id)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteNodeTree(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) {
      return { changes: 0 };
    }

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const placeholders = buildInPlaceholders(nodeIds.length);
        const res = await pool.query(
          `DELETE FROM file_nodes WHERE id IN (${placeholders})`,
          nodeIds.map(Number)
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const placeholders = buildQuestionPlaceholders(nodeIds.length);
      const res = await storage.sqliteRun(
        `DELETE FROM file_nodes WHERE id IN (${placeholders})`,
        nodeIds.map(Number)
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function updateSyncStatus(id, status) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `UPDATE file_nodes SET sync_status = $2, updated_at = NOW() WHERE id = $1`,
          [Number(id), String(status)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `UPDATE file_nodes SET sync_status = ?, updated_at = datetime('now') WHERE id = ?`,
        [String(status), Number(id)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function resolvePathSegment(parentId, name) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        let query;
        let params;
        if (parentId == null) {
          query = 'SELECT id FROM file_nodes WHERE parent_id IS NULL AND name = $1 LIMIT 1';
          params = [String(name)];
        } else {
          query = 'SELECT id FROM file_nodes WHERE parent_id = $1 AND name = $2 LIMIT 1';
          params = [Number(parentId), String(name)];
        }
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return null;
        return { id: Number(res.rows[0].id) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      let query;
      const params = [String(name)];
      if (parentId == null) {
        query = 'SELECT id FROM file_nodes WHERE parent_id IS NULL AND name = ? LIMIT 1';
      } else {
        query = 'SELECT id FROM file_nodes WHERE parent_id = ? AND name = ? LIMIT 1';
        params.unshift(Number(parentId));
      }
      const res = await storage.sqliteQuery(query, params);
      if (res.rows.length === 0) return null;
      return { id: Number(res.rows[0].id) };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  node_ancestors operations                                          */
  /* ------------------------------------------------------------------ */

  async function insertAncestorRows(rows) {
    if (!rows || rows.length === 0) {
      return { changes: 0 };
    }

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const placeholders = buildInPlaceholders(3 * rows.length);
        const values = [];
        for (const r of rows) {
          values.push(Number(r.ancestorId), Number(r.descendantId), Number(r.depth));
        }
        const res = await pool.query(
          `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (${placeholders})`,
          values
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      let totalChanges = 0;
      for (const r of rows) {
        const res = await storage.sqliteRun(
          `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)`,
          [Number(r.ancestorId), Number(r.descendantId), Number(r.depth)]
        );
        totalChanges += res.changes;
      }
      return { changes: totalChanges };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteAncestorByDescendant(descendantIds) {
    if (!descendantIds || descendantIds.length === 0) {
      return { changes: 0 };
    }

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const placeholders = buildInPlaceholders(descendantIds.length);
        const res = await pool.query(
          `DELETE FROM node_ancestors WHERE descendant_id IN (${placeholders})`,
          descendantIds.map(Number)
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const placeholders = buildQuestionPlaceholders(descendantIds.length);
      const res = await storage.sqliteRun(
        `DELETE FROM node_ancestors WHERE descendant_id IN (${placeholders})`,
        descendantIds.map(Number)
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteAncestorByAncestor(ancestorIds) {
    if (!ancestorIds || ancestorIds.length === 0) {
      return { changes: 0 };
    }

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const placeholders = buildInPlaceholders(ancestorIds.length);
        const res = await pool.query(
          `DELETE FROM node_ancestors WHERE ancestor_id IN (${placeholders})`,
          ancestorIds.map(Number)
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const placeholders = buildQuestionPlaceholders(ancestorIds.length);
      const res = await storage.sqliteRun(
        `DELETE FROM node_ancestors WHERE ancestor_id IN (${placeholders})`,
        ancestorIds.map(Number)
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getDescendantIds(ancestorId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT descendant_id FROM node_ancestors WHERE ancestor_id = $1`,
          [Number(ancestorId)]
        );
        return res.rows.map((r) => Number(r.descendant_id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ?`,
        [Number(ancestorId)]
      );
      return res.rows.map((r) => Number(r.descendant_id));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getDescendants(ancestorId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT n.* FROM file_nodes n
           JOIN node_ancestors a ON a.descendant_id = n.id
           WHERE a.ancestor_id = $1`,
          [Number(ancestorId)]
        );
        return res.rows.map(mapNodeRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT n.* FROM file_nodes n
         JOIN node_ancestors a ON a.descendant_id = n.id
         WHERE a.ancestor_id = ?`,
        [Number(ancestorId)]
      );
      return res.rows.map(mapNodeRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getAncestorChain(descendantId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = $1 ORDER BY depth DESC`,
          [Number(descendantId)]
        );
        return res.rows.map((r) => ({
          ancestorId: Number(r.ancestor_id),
          depth: Number(r.depth),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth DESC`,
        [Number(descendantId)]
      );
      return res.rows.map((r) => ({
        ancestorId: Number(r.ancestor_id),
        depth: Number(r.depth),
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function isAncestor(ancestorId, descendantId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT 1 FROM node_ancestors WHERE ancestor_id = $1 AND descendant_id = $2 LIMIT 1`,
          [Number(ancestorId), Number(descendantId)]
        );
        return res.rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT 1 FROM node_ancestors WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1`,
        [Number(ancestorId), Number(descendantId)]
      );
      return res.rows.length > 0;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getUserRootNode(userId) {
    const userStore = require('../store/userStore');
    const user = await userStore.findById(Number(userId));
    if (!user || !user.username) return null;

    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          'SELECT * FROM file_nodes WHERE parent_id IS NULL AND name = $1 LIMIT 1',
          [String(user.username)]
        );
        return mapNodeRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        'SELECT * FROM file_nodes WHERE parent_id IS NULL AND name = ? LIMIT 1',
        [String(user.username)]
      );
      return mapNodeRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  object_map operations                                              */
  /* ------------------------------------------------------------------ */

  async function upsertObjectMap(fileNodeId, s3Key, status) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        await pool.query(
          `UPDATE object_map SET status = 'orphaned' WHERE file_node_id = $1 AND status = 'active'`,
          [Number(fileNodeId)]
        );
        const verRes = await pool.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM object_map WHERE file_node_id = $1`,
          [Number(fileNodeId)]
        );
        const versionNumber = Number(verRes.rows[0].next_ver);
        const res = await pool.query(
          `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
           VALUES ($1, $2, 's3', $3, $4)`,
          [Number(fileNodeId), String(s3Key), versionNumber, String(status)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      await storage.sqliteRun(
        `UPDATE object_map SET status = 'orphaned' WHERE file_node_id = ? AND status = 'active'`,
        [Number(fileNodeId)]
      );
      const verRes = await storage.sqliteQuery(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM object_map WHERE file_node_id = ?`,
        [Number(fileNodeId)]
      );
      const versionNumber = Number(verRes.rows[0].next_ver);
      const res = await storage.sqliteRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', ?, ?)`,
        [Number(fileNodeId), String(s3Key), versionNumber, String(status)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function insertObject(fileNodeId, s3Key, status) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
           VALUES ($1, $2, 's3', 1, $3)`,
          [Number(fileNodeId), String(s3Key), String(status)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [Number(fileNodeId), String(s3Key), String(status)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getActiveObject(fileNodeId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT * FROM object_map WHERE file_node_id = $1 AND status = 'active' LIMIT 1`,
          [Number(fileNodeId)]
        );
        return res.rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT * FROM object_map WHERE file_node_id = ? AND status = 'active' LIMIT 1`,
        [Number(fileNodeId)]
      );
      return res.rows[0] || null;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getObjectMapByS3Key(s3Key) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT * FROM object_map WHERE s3_key = $1 AND status IN ('pending', 'active') LIMIT 1`,
          [String(s3Key)]
        );
        return res.rows[0] || null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT * FROM object_map WHERE s3_key = ? AND status IN ('pending', 'active') LIMIT 1`,
        [String(s3Key)]
      );
      return res.rows[0] || null;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function activateObject(s3Key) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `UPDATE object_map SET status = 'active' WHERE s3_key = $1 AND status = 'pending'`,
          [String(s3Key)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `UPDATE object_map SET status = 'active' WHERE s3_key = ? AND status = 'pending'`,
        [String(s3Key)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function orphanObject(s3Key) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `UPDATE object_map SET status = 'orphaned' WHERE s3_key = $1 AND status IN ('active', 'pending')`,
          [String(s3Key)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        `UPDATE object_map SET status = 'orphaned' WHERE s3_key = ? AND status IN ('active', 'pending')`,
        [String(s3Key)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function countActiveObjectsByS3Key(s3Key) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT COUNT(*)::int AS count FROM object_map WHERE s3_key = $1 AND status = 'active'`,
          [String(s3Key)]
        );
        return Number(res.rows[0].count);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT COUNT(*) AS count FROM object_map WHERE s3_key = ? AND status = 'active'`,
        [String(s3Key)]
      );
      return Number(res.rows[0].count);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  filecache operations                                               */
  /* ------------------------------------------------------------------ */

  async function upsertCache(fileNodeId, size, mimeType, contentHash) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (file_node_id) DO UPDATE SET
             size       = EXCLUDED.size,
             mime_type  = EXCLUDED.mime_type,
             content_hash = EXCLUDED.content_hash,
             updated_at = NOW()`,
          [Number(fileNodeId), Number(size), mimeType || null, contentHash || null]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const existing = await storage.sqliteQuery(
        'SELECT 1 FROM filecache WHERE file_node_id = ? LIMIT 1',
        [Number(fileNodeId)]
      );
      if (existing.rows.length > 0) {
        const res = await storage.sqliteRun(
          `UPDATE filecache SET size = ?, mime_type = ?, content_hash = ?, updated_at = datetime('now')
           WHERE file_node_id = ?`,
          [Number(size), mimeType || null, contentHash || null, Number(fileNodeId)]
        );
        return { changes: res.changes };
      }

      const res = await storage.sqliteRun(
        `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [Number(fileNodeId), Number(size), mimeType || null, contentHash || null]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteCache(fileNodeId) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          'DELETE FROM filecache WHERE file_node_id = $1',
          [Number(fileNodeId)]
        );
        return { changes: res.rowCount };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteRun(
        'DELETE FROM filecache WHERE file_node_id = ?',
        [Number(fileNodeId)]
      );
      return { changes: res.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  return {
    createNode,
    getNode,
    getChildren,
    renameNode,
    moveNode,
    deleteNodeTree,
    updateSyncStatus,
    resolvePathSegment,
    insertAncestorRows,
    deleteAncestorByDescendant,
    deleteAncestorByAncestor,
    getDescendantIds,
    getDescendants,
    getAncestorChain,
    isAncestor,
    getUserRootNode,
    upsertObjectMap,
    insertObject,
    getActiveObject,
    getObjectMapByS3Key,
    activateObject,
    orphanObject,
    countActiveObjectsByS3Key,
    upsertCache,
    deleteCache,
  };
}

module.exports = { createFileNodesStore };
