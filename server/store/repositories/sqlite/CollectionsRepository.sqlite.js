'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { toIsoString } = require('../../../utils/sharedHelpers');
const {
  mapCollectionRow,
  mapItemRow,
  mapGrantRow,
  mapSuggestionRow,
} = require('../collectionsShared');

/**
 * sqlite implementation of CollectionsRepository (`?` placeholders).
 *
 * Methods taking `tx` run INSIDE a caller-owned transaction (the facade's
 * commitChange TX for journaled mutators, the permanent-delete TX, or the
 * facade's own single-statement transaction wrappers); read methods execute
 * directly on the executor.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteCollectionsRepository(executor) {
  const collectionSorts = {
    // `c.id DESC` is the deterministic tie-breaker (RCA 2026-09-23): second-
    // granular sqlite timestamps tie on rapid creates, and a plan-dependent
    // row order is not a contract — newest-first is the §3.1 gravity.
    activity: 'c.activity_score DESC, c.last_member_change_at DESC, c.created_at DESC, c.id DESC',
    name: 'c.name',
    created: 'c.created_at DESC, c.id DESC',
    updated: 'c.updated_at DESC, c.id DESC',
  };

  function placeholders(count) {
    return Array.from({ length: count }, () => '?').join(', ');
  }

  return {
    dialect: 'sqlite',

    // -- reads ---------------------------------------------------------------

    async getCollection(collectionId) {
      try {
        const { rows } = await executor.query('SELECT * FROM collections WHERE id = ? LIMIT 1', [
          Number(collectionId),
        ]);
        return mapCollectionRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listForUser(userId, { sort, status } = {}) {
      try {
        const order = collectionSorts[sort] || collectionSorts.activity;
        // Store contract: `status` defaults to 'active' (archived rows join the
        // result only via `listArchived`/`status:'all'` — RCA 2026-09-23).
        const effectiveStatus = status ?? 'active';
        const statusFilter = effectiveStatus !== 'all' ? 'AND c.status = ?' : '';
        const params = [Number(userId), Number(userId), Number(userId)];
        if (effectiveStatus !== 'all') params.push(effectiveStatus);
        const { rows } = await executor.query(
          `SELECT c.* FROM collections c
           LEFT JOIN collection_visibility v ON v.collection_id = c.id AND v.user_id = ?
           WHERE (c.owner_id = ?
                    OR EXISTS (SELECT 1 FROM collection_grants g
                                WHERE g.collection_id = c.id AND g.grantee_id = ?))
             AND COALESCE(v.hidden, 0) = 0
             ${statusFilter}
           ORDER BY ${order}`,
          params
        );
        return rows.map(mapCollectionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listArchived(ownerId) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM collections
           WHERE owner_id = ? AND status = 'archived'
           ORDER BY archived_at DESC`,
          [Number(ownerId)]
        );
        return rows.map(mapCollectionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async existsActiveName(ownerId, name) {
      try {
        const { rows } = await executor.query(
          `SELECT 1 AS hit FROM collections
           WHERE owner_id = ? AND name = ? AND status = 'active' LIMIT 1`,
          [Number(ownerId), String(name)]
        );
        return rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listStoredItems(collectionId, { since } = {}) {
      try {
        const sinceClause = since != null ? 'AND julianday(created_at) > julianday(?)' : '';
        const params = [Number(collectionId)];
        if (since != null) params.push(new Date(since).toISOString());
        const { rows } = await executor.query(
          `SELECT * FROM collection_items WHERE collection_id = ? ${sinceClause}
           ORDER BY created_at`,
          params
        );
        return rows.map(mapItemRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getStoredItem(collectionId, nodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM collection_items WHERE collection_id = ? AND node_id = ? LIMIT 1',
          [Number(collectionId), Number(nodeId)]
        );
        return mapItemRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listExclusions(collectionId) {
      try {
        const { rows } = await executor.query(
          'SELECT node_id FROM collection_exclusions WHERE collection_id = ? ORDER BY node_id',
          [Number(collectionId)]
        );
        return rows.map((row) => Number(row.node_id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async isExcluded(collectionId, nodeId) {
      try {
        const { rows } = await executor.query(
          `SELECT 1 AS hit FROM collection_exclusions
           WHERE collection_id = ? AND node_id = ? LIMIT 1`,
          [Number(collectionId), Number(nodeId)]
        );
        return rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listForNodes(userId, nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return [];
      try {
        const { rows } = await executor.query(
          `SELECT ci.node_id, ci.collection_id
           FROM collection_items ci
           JOIN collections c ON c.id = ci.collection_id
           LEFT JOIN collection_visibility v ON v.collection_id = c.id AND v.user_id = ?
           WHERE (c.owner_id = ?
                    OR EXISTS (SELECT 1 FROM collection_grants g
                                WHERE g.collection_id = c.id AND g.grantee_id = ?))
             AND COALESCE(v.hidden, 0) = 0
             AND c.status = 'active'
             AND ci.node_id IN (${placeholders(nodeIds.length)})`,
          [Number(userId), Number(userId), Number(userId), ...nodeIds.map(Number)]
        );
        return rows.map((row) => ({
          nodeId: Number(row.node_id),
          collectionId: Number(row.collection_id),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listGrants(collectionId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM collection_grants WHERE collection_id = ? ORDER BY created_at',
          [Number(collectionId)]
        );
        return rows.map(mapGrantRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getGrant(collectionId, granteeId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM collection_grants WHERE collection_id = ? AND grantee_id = ? LIMIT 1',
          [Number(collectionId), Number(granteeId)]
        );
        return mapGrantRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async setVisible(tx, userId, collectionId, hidden) {
      const result = await tx.run(
        `INSERT INTO collection_visibility (user_id, collection_id, hidden)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, collection_id)
         DO UPDATE SET hidden = ?`,
        [Number(userId), Number(collectionId), Boolean(hidden), Boolean(hidden)]
      );
      return { changes: result.changes };
    },

    async isHiddenFor(userId, collectionId) {
      try {
        const { rows } = await executor.query(
          'SELECT hidden FROM collection_visibility WHERE user_id = ? AND collection_id = ? LIMIT 1',
          [Number(userId), Number(collectionId)]
        );
        return rows.length > 0 && Number(rows[0].hidden) === 1;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getDigestCursor(userId, collectionId) {
      try {
        const { rows } = await executor.query(
          `SELECT last_visited_at FROM collection_digest_cursors
           WHERE user_id = ? AND collection_id = ? LIMIT 1`,
          [Number(userId), Number(collectionId)]
        );
        return rows.length > 0 ? String(rows[0].last_visited_at) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listDigestCursorMap(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT collection_id, last_visited_at FROM collection_digest_cursors WHERE user_id = ?',
          [Number(userId)]
        );
        const map = {};
        rows.forEach((row) => {
          map[Number(row.collection_id)] = toIsoString(row.last_visited_at);
        });
        return map;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async recomputeActivityScores(collectionIds) {
      try {
        const scoped =
          Array.isArray(collectionIds) && collectionIds.length > 0
            ? `WHERE id IN (${placeholders(collectionIds.length)})`
            : '';
        const result = await executor.run(
          `UPDATE collections
           SET activity_score = COALESCE((
                 SELECT SUM(na.score)
                   FROM collection_items ci
                   LEFT JOIN node_activity na
                     ON na.node_id = ci.node_id AND na.user_id = collections.owner_id
                  WHERE ci.collection_id = collections.id
               ), 0)
           ${scoped}`,
          Array.isArray(collectionIds) ? collectionIds.map(Number) : []
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getCentroids(collectionIds, modelId) {
      if (!collectionIds || collectionIds.length === 0) return [];
      try {
        const { rows } = await executor.query(
          `SELECT * FROM collection_centroids
           WHERE collection_id IN (${placeholders(collectionIds.length)}) AND model_id = ?
           ORDER BY collection_id`,
          [...collectionIds.map(Number), Number(modelId)]
        );
        return rows.map((row) => ({
          collectionId: Number(row.collection_id),
          modelId: Number(row.model_id),
          centroid: row.centroid,
          memberCount: Number(row.member_count),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async isTombstoned(ownerId, defFingerprint) {
      try {
        const { rows } = await executor.query(
          `SELECT 1 AS hit FROM collection_tombstones
           WHERE owner_id = ? AND def_fingerprint = ? LIMIT 1`,
          [Number(ownerId), String(defFingerprint)]
        );
        return rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listTombstones(ownerId) {
      try {
        const { rows } = await executor.query(
          'SELECT def_fingerprint, deleted_at FROM collection_tombstones WHERE owner_id = ? ORDER BY deleted_at DESC',
          [Number(ownerId)]
        );
        return rows.map((row) => ({
          defFingerprint: row.def_fingerprint,
          deletedAt: row.deleted_at,
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async purgeExpiredTombstones(cutoff) {
      try {
        const result = await executor.run(
          'DELETE FROM collection_tombstones WHERE julianday(deleted_at) < julianday(?)',
          [new Date(cutoff).toISOString()]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listMergeSuggestions(collectionIds) {
      try {
        const scoped =
          Array.isArray(collectionIds) && collectionIds.length > 0
            ? `AND (a_id IN (${placeholders(collectionIds.length)}) OR b_id IN (${placeholders(collectionIds.length)}))`
            : '';
        const params =
          Array.isArray(collectionIds) && collectionIds.length > 0
            ? [...collectionIds.map(Number), ...collectionIds.map(Number)]
            : [];
        const { rows } = await executor.query(
          `SELECT * FROM collection_merge_suggestions
           WHERE state = 'pending' ${scoped}
           ORDER BY created_at DESC, id DESC`,
          params
        );
        return rows.map(mapSuggestionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    // -- tx-bound writes -----------------------------------------------------

    async getCollectionTx(tx, collectionId) {
      const { rows } = await tx.query('SELECT * FROM collections WHERE id = ? LIMIT 1', [
        Number(collectionId),
      ]);
      return mapCollectionRow(rows[0]);
    },

    async insertCollection(tx, { ownerId, name, origin, publishMode, definition }) {
      const result = await tx.run(
        `INSERT INTO collections (owner_id, name, origin, publish_mode, definition)
         VALUES (?, ?, ?, ?, ?)`,
        [
          Number(ownerId),
          String(name),
          String(origin),
          publishMode ?? 'ask',
          definition === null || definition === undefined ? null : JSON.stringify(definition),
        ]
      );
      return { id: Number(result.lastId) };
    },

    async renameCollection(tx, collectionId, name, lockName) {
      const result = await tx.run(
        `UPDATE collections
         SET name = ?, name_locked = CASE WHEN ? THEN 1 ELSE name_locked END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(name), Boolean(lockName), Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async updatePin(tx, collectionId, pinned, pinnedBy) {
      const result = await tx.run(
        `UPDATE collections
         SET pinned = ?, pinned_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [Boolean(pinned), pinned ? 'user' : (pinnedBy ?? null), Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async setAutoPin(tx, collectionId) {
      const result = await tx.run(
        `UPDATE collections
         SET pinned = 1, pinned_by = 'auto', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND origin = 'system' AND pinned = 0`,
        [Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async updatePublishMode(tx, collectionId, publishMode) {
      const result = await tx.run(
        `UPDATE collections
         SET publish_mode = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(publishMode), Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async archiveRow(tx, collectionId) {
      const result = await tx.run(
        `UPDATE collections
         SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'active'`,
        [Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async restoreRow(tx, collectionId) {
      const result = await tx.run(
        `UPDATE collections
         SET status = 'active', archived_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'archived'`,
        [Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async insertItem(tx, collectionId, nodeId, addedBy, { published } = {}) {
      const result = await tx.run(
        `INSERT INTO collection_items (collection_id, node_id, added_by, published)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (collection_id, node_id) DO NOTHING`,
        [Number(collectionId), Number(nodeId), Number(addedBy), published ?? true]
      );
      return { changes: result.changes };
    },

    async deleteItem(tx, collectionId, nodeId) {
      const result = await tx.run(
        'DELETE FROM collection_items WHERE collection_id = ? AND node_id = ?',
        [Number(collectionId), Number(nodeId)]
      );
      return { changes: result.changes };
    },

    async setItemPublished(tx, collectionId, nodeIds, published) {
      if (!nodeIds || nodeIds.length === 0) return { changes: 0 };
      const result = await tx.run(
        `UPDATE collection_items SET published = ? WHERE collection_id = ? AND node_id IN (${placeholders(nodeIds.length)})`,
        [Boolean(published), Number(collectionId), ...nodeIds.map(Number)]
      );
      return { changes: result.changes };
    },

    async insertExclusion(tx, collectionId, nodeId) {
      const result = await tx.run(
        `INSERT INTO collection_exclusions (collection_id, node_id)
         VALUES (?, ?)
         ON CONFLICT (collection_id, node_id) DO NOTHING`,
        [Number(collectionId), Number(nodeId)]
      );
      return { changes: result.changes };
    },

    async deleteExclusion(tx, collectionId, nodeId) {
      const result = await tx.run(
        'DELETE FROM collection_exclusions WHERE collection_id = ? AND node_id = ?',
        [Number(collectionId), Number(nodeId)]
      );
      return { changes: result.changes };
    },

    async upsertGrant(tx, collectionId, granteeId, role, grantedBy) {
      const result = await tx.run(
        `INSERT INTO collection_grants (collection_id, grantee_id, role, granted_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (collection_id, grantee_id)
         DO UPDATE SET role = ?, granted_by = ?`,
        [
          Number(collectionId),
          Number(granteeId),
          String(role),
          Number(grantedBy),
          String(role),
          Number(grantedBy),
        ]
      );
      return { changes: result.changes };
    },

    async deleteGrant(tx, collectionId, granteeId) {
      const result = await tx.run(
        'DELETE FROM collection_grants WHERE collection_id = ? AND grantee_id = ?',
        [Number(collectionId), Number(granteeId)]
      );
      return { changes: result.changes };
    },

    async touchMemberChange(tx, collectionId) {
      const result = await tx.run(
        'UPDATE collections SET last_member_change_at = CURRENT_TIMESTAMP WHERE id = ?',
        [Number(collectionId)]
      );
      return { changes: result.changes };
    },

    async upsertDigestCursor(tx, userId, collectionId, lastVisitedAt) {
      const iso = new Date(lastVisitedAt).toISOString();
      const result = await tx.run(
        `INSERT INTO collection_digest_cursors (user_id, collection_id, last_visited_at)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, collection_id)
         DO UPDATE SET last_visited_at = ?`,
        [Number(userId), Number(collectionId), iso, iso]
      );
      return { changes: result.changes };
    },

    async upsertCentroid(tx, collectionId, modelId, centroid, memberCount) {
      const result = await tx.run(
        `INSERT INTO collection_centroids (collection_id, model_id, centroid, member_count, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (collection_id, model_id)
         DO UPDATE SET centroid = ?, member_count = ?, updated_at = CURRENT_TIMESTAMP`,
        [
          Number(collectionId),
          Number(modelId),
          String(centroid),
          Number(memberCount),
          String(centroid),
          Number(memberCount),
        ]
      );
      return { changes: result.changes };
    },

    async deleteCentroids(tx, collectionId) {
      const result = await tx.run('DELETE FROM collection_centroids WHERE collection_id = ?', [
        Number(collectionId),
      ]);
      return { changes: result.changes };
    },

    async insertTombstone(tx, ownerId, defFingerprint) {
      const result = await tx.run(
        `INSERT INTO collection_tombstones (owner_id, def_fingerprint)
         VALUES (?, ?)
         ON CONFLICT (owner_id, def_fingerprint) DO NOTHING`,
        [Number(ownerId), String(defFingerprint)]
      );
      return { changes: result.changes };
    },

    async deleteCollectionRow(tx, collectionId) {
      const result = await tx.run('DELETE FROM collections WHERE id = ?', [Number(collectionId)]);
      return { changes: result.changes };
    },

    async upsertMergeSuggestion(tx, aId, bId, score) {
      const low = Math.min(Number(aId), Number(bId));
      const high = Math.max(Number(aId), Number(bId));
      await tx.run(
        `INSERT INTO collection_merge_suggestions (a_id, b_id, score)
         VALUES (?, ?, ?)
         ON CONFLICT (a_id, b_id) DO NOTHING`,
        [low, high, Number(score)]
      );
      const { rows } = await tx.query(
        'SELECT * FROM collection_merge_suggestions WHERE a_id = ? AND b_id = ? LIMIT 1',
        [low, high]
      );
      return mapSuggestionRow(rows[0]);
    },

    async setSuggestionState(tx, suggestionId, state) {
      const stamps = {
        dismissed: 'dismissed_at = CURRENT_TIMESTAMP',
        rejected: 'rejected_at = CURRENT_TIMESTAMP',
        merged: null,
      };
      if (!(state in stamps)) return { changes: 0 };
      const setClause = stamps[state] === null ? 'state = ?' : `state = ?, ${stamps[state]}`;
      const result = await tx.run(
        `UPDATE collection_merge_suggestions SET ${setClause} WHERE id = ? AND state = 'pending'`,
        [state, Number(suggestionId)]
      );
      return { changes: result.changes };
    },
  };
};
