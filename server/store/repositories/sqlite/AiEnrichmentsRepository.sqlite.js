'use strict';

/**
 * SQLite twin of AiEnrichmentsRepository (docs/spec/server/store/
 * aiEnrichmentsStore.md). `ai_enrichments.tags` stores FREE descriptive
 * words only (PLAN §19 — no vocabulary/tag_parents/tag_embeddings code
 * paths). Every mutation runs in a storage transaction on the executor
 * seam; no dialect branching above the repository.
 */

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapAiEnrichmentRow, normalizeTags } = require('../aiEnrichmentsShared');

const PRODUCER_MODEL_COLUMNS = Object.freeze([
  'features_model_id',
  'caption_model_id',
  'asr_model_id',
]);

/**
 * Resolves the model-lineage column used by listByModel/countByModel.
 * @param {string} modelColumn
 * @returns {string}
 */
function resolveModelColumn(modelColumn) {
  if (!PRODUCER_MODEL_COLUMNS.includes(modelColumn)) {
    throw new TypeError(`unknown producer lineage column: ${modelColumn}`);
  }
  return modelColumn;
}

module.exports = function createSqliteAiEnrichmentsRepository(executor) {
  function buildQuestionPlaceholders(count) {
    return Array(count).fill('?').join(', ');
  }

  function buildUpsertValues(patch) {
    return {
      featuresModelId: patch.featuresModelId ?? null,
      schemaVersion: patch.schemaVersion ?? 1,
      tags: normalizeTags(patch.tags),
      summary: patch.summary ?? null,
      caption: patch.caption ?? null,
      captionModelId: patch.captionModelId ?? null,
      transcript: patch.transcript ?? null,
      asrModelId: patch.asrModelId ?? null,
      probe: patch.probe === undefined ? null : JSON.stringify(patch.probe),
      truncated: patch.truncated ? 1 : 0,
      mediaKind: patch.mediaKind ?? null,
    };
  }

  async function get(nodeId) {
    try {
      const { rows } = await executor.query(
        `SELECT node_id, features_model_id, schema_version, tags, summary, caption,
                caption_model_id, transcript, asr_model_id, probe, truncated,
                media_kind, updated_at
         FROM ai_enrichments WHERE node_id = ?`,
        [Number(nodeId)]
      );
      return rows.length > 0 ? mapAiEnrichmentRow(rows[0]) : null;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function getByNodeIds(nodeIds) {
    const ids = (Array.isArray(nodeIds) ? nodeIds : []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];
    try {
      const { rows } = await executor.query(
        `SELECT node_id, features_model_id, schema_version, tags, summary, caption,
                caption_model_id, transcript, asr_model_id, probe, truncated,
                media_kind, updated_at
         FROM ai_enrichments WHERE node_id IN (${buildQuestionPlaceholders(ids.length)})
         ORDER BY node_id ASC`,
        ids
      );
      return rows.map(mapAiEnrichmentRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function upsert(nodeId, patch) {
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('upsert requires a patch object');
    }
    const values = buildUpsertValues(patch);
    const tagsJson = values.tags === null ? null : JSON.stringify(values.tags);
    const probeJson = values.probe === null ? null : values.probe;
    try {
      return await executor.transaction(async () => {
        const result = await executor.run(
          `INSERT INTO ai_enrichments (
             node_id, features_model_id, schema_version, tags, summary, caption,
             caption_model_id, transcript, asr_model_id, probe, truncated, media_kind, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(node_id) DO UPDATE SET
             features_model_id = COALESCE(excluded.features_model_id, ai_enrichments.features_model_id),
             schema_version = COALESCE(excluded.schema_version, ai_enrichments.schema_version),
             tags = COALESCE(excluded.tags, ai_enrichments.tags),
             summary = COALESCE(excluded.summary, ai_enrichments.summary),
             caption = COALESCE(excluded.caption, ai_enrichments.caption),
             caption_model_id = COALESCE(excluded.caption_model_id, ai_enrichments.caption_model_id),
             transcript = COALESCE(excluded.transcript, ai_enrichments.transcript),
             asr_model_id = COALESCE(excluded.asr_model_id, ai_enrichments.asr_model_id),
             probe = COALESCE(excluded.probe, ai_enrichments.probe),
             truncated = COALESCE(excluded.truncated, ai_enrichments.truncated),
             media_kind = COALESCE(excluded.media_kind, ai_enrichments.media_kind),
             updated_at = CURRENT_TIMESTAMP`,
          [
            Number(nodeId),
            values.featuresModelId,
            values.schemaVersion,
            tagsJson,
            values.summary,
            values.caption,
            values.captionModelId,
            values.transcript,
            values.asrModelId,
            probeJson,
            values.truncated,
            values.mediaKind,
          ]
        );
        return { changes: result.changes };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteNode(nodeId) {
    try {
      return await executor.transaction(async () => {
        const result = await executor.run('DELETE FROM ai_enrichments WHERE node_id = ?', [
          Number(nodeId),
        ]);
        return { changes: result.changes };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function listByModel(modelColumn, modelId, opts = {}) {
    const column = resolveModelColumn(modelColumn);
    const { afterNodeId, limit } = opts;
    const params = [Number(modelId)];
    let sql = `SELECT node_id, features_model_id, schema_version, tags, summary, caption,
                      caption_model_id, transcript, asr_model_id, probe, truncated,
                      media_kind, updated_at
               FROM ai_enrichments WHERE ${column} = ?`;
    if (afterNodeId !== undefined && afterNodeId !== null) {
      sql += ' AND node_id > ?';
      params.push(Number(afterNodeId));
    }
    sql += ' ORDER BY node_id ASC';
    if (limit !== undefined && limit !== null) {
      sql += ' LIMIT ?';
      params.push(Number(limit));
    }
    try {
      const { rows } = await executor.query(sql, params);
      return rows.map(mapAiEnrichmentRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function countByModel(modelColumn, modelId) {
    const column = resolveModelColumn(modelColumn);
    try {
      const { rows } = await executor.query(
        `SELECT COUNT(*) AS count FROM ai_enrichments WHERE ${column} = ?`,
        [Number(modelId)]
      );
      return Number(rows[0].count);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  return {
    dialect: 'sqlite',
    get,
    getByNodeIds,
    upsert,
    delete: deleteNode,
    listByModel,
    countByModel,
  };
};
