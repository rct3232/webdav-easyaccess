'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapModelRow, normalizeModelSpec } = require('../llmModelsShared');

/**
 * postgres implementation of LlmModelsRepository (`$n` placeholders).
 * Identity matching uses `IS NOT DISTINCT FROM` (a NULL model_revision
 * matches only NULL — llmModelsStore §1 identity rule).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresLlmModelsRepository(executor) {
  return {
    dialect: 'postgres',

    async upsertModel(spec) {
      const model = normalizeModelSpec(spec);
      try {
        return await executor.transaction(async (tx) => {
          const { rows } = await tx.query(
            `SELECT id FROM llm_models
             WHERE role = $1 AND provider = $2 AND engine = $3
               AND base_url_key = $4 AND model_name = $5
               AND model_revision IS NOT DISTINCT FROM $6`,
            [
              model.role,
              model.provider,
              model.engine,
              model.baseUrlKey,
              model.modelName,
              model.modelRevision,
            ]
          );
          if (rows.length > 0) {
            const id = Number(rows[0].id);
            await tx.run(
              `UPDATE llm_models
               SET precision = $1, max_input_chars = $2, chunk_budget = $3, batch_size = $4,
                   reasoning = $5, enabled = $6
               WHERE id = $7`,
              [
                model.precision,
                model.maxInputChars,
                model.chunkBudget,
                model.batchSize,
                model.reasoning,
                model.enabled,
                id,
              ]
            );
            return { id };
          }
          const inserted = await tx.run(
            `INSERT INTO llm_models
               (role, provider, engine, base_url_key, model_name, precision, model_revision,
                max_input_chars, chunk_budget, batch_size, reasoning, enabled)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
              model.role,
              model.provider,
              model.engine,
              model.baseUrlKey,
              model.modelName,
              model.precision,
              model.modelRevision,
              model.maxInputChars,
              model.chunkBudget,
              model.batchSize,
              model.reasoning,
              model.enabled,
            ]
          );
          return { id: Number(inserted.rows[0].id) };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getModel(id) {
      try {
        const { rows } = await executor.query('SELECT * FROM llm_models WHERE id = $1 LIMIT 1', [
          Number(id),
        ]);
        return rows[0] ? mapModelRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getActiveByRole(role) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM llm_models WHERE role = $1 AND enabled = TRUE
           ORDER BY id DESC LIMIT 1`,
          [String(role)]
        );
        return rows[0] ? mapModelRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listByRole(role) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM llm_models WHERE role = $1 ORDER BY id ASC',
          [String(role)]
        );
        return rows.map(mapModelRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async setReasoning(id, reasoning) {
      if (reasoning !== 'on' && reasoning !== 'off') {
        throw new TypeError(`invalid reasoning value '${reasoning}' (on|off)`);
      }
      try {
        const result = await executor.run('UPDATE llm_models SET reasoning = $1 WHERE id = $2', [
          reasoning,
          Number(id),
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
