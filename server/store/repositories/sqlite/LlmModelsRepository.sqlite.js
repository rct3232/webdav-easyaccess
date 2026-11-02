'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapModelRow, normalizeModelSpec } = require('../llmModelsShared');

/**
 * sqlite implementation of LlmModelsRepository (`?` placeholders). Identity
 * matching uses sqlite's null-safe `IS` operator (a NULL model_revision
 * matches only NULL — llmModelsStore §1 identity rule).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteLlmModelsRepository(executor) {
  return {
    dialect: 'sqlite',

    async upsertModel(spec) {
      const model = normalizeModelSpec(spec);
      try {
        return await executor.transaction(async (tx) => {
          const { rows } = await tx.query(
            `SELECT id FROM llm_models
             WHERE role = ? AND provider = ? AND engine = ?
               AND base_url_key = ? AND model_name = ? AND model_revision IS ?`,
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
               SET precision = ?, max_input_chars = ?, chunk_budget = ?, batch_size = ?,
                   reasoning = ?, enabled = ?
               WHERE id = ?`,
              [
                model.precision,
                model.maxInputChars,
                model.chunkBudget,
                model.batchSize,
                model.reasoning,
                model.enabled ? 1 : 0,
                id,
              ]
            );
            return { id };
          }
          const inserted = await tx.run(
            `INSERT INTO llm_models
               (role, provider, engine, base_url_key, model_name, precision, model_revision,
                max_input_chars, chunk_budget, batch_size, reasoning, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              model.enabled ? 1 : 0,
            ]
          );
          return { id: Number(inserted.lastId) };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async activateModel(role, id) {
      try {
        return await executor.transaction(async (tx) => {
          await tx.run('UPDATE llm_models SET enabled = 0 WHERE role = ? AND id <> ?', [
            String(role),
            Number(id),
          ]);
          const result = await tx.run(
            'UPDATE llm_models SET enabled = 1 WHERE role = ? AND id = ?',
            [String(role), Number(id)]
          );
          return { changes: result.changes };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async disableRole(role) {
      try {
        const result = await executor.run('UPDATE llm_models SET enabled = 0 WHERE role = ?', [
          String(role),
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getModel(id) {
      try {
        const { rows } = await executor.query('SELECT * FROM llm_models WHERE id = ? LIMIT 1', [
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
          `SELECT * FROM llm_models WHERE role = ? AND enabled = 1
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
          'SELECT * FROM llm_models WHERE role = ? ORDER BY id ASC',
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
        const result = await executor.run('UPDATE llm_models SET reasoning = ? WHERE id = ?', [
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
