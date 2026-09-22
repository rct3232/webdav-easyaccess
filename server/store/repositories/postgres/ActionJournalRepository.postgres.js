'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapActionRow } = require('../actionJournalShared');

/**
 * postgres implementation of ActionJournalRepository (`$n` placeholders).
 *
 * Methods taking `tx` run INSIDE a caller-owned transaction (the facade's
 * commitChange/undoAction TX); the remaining reads/writes execute directly.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresActionJournalRepository(executor) {
  return {
    dialect: 'postgres',

    async getMaxChainSeq(tx, domain, subject) {
      const { rows } = await tx.query(
        'SELECT COALESCE(MAX(chain_seq), 0) AS max_seq FROM action_journal WHERE domain = $1 AND subject = $2',
        [domain, subject]
      );
      return Number(rows[0].max_seq);
    },

    async insertAction(
      tx,
      { domain, subject, subjectLabel, actor, action, payload, chainSeq, retentionDays }
    ) {
      const result = await tx.run(
        `INSERT INTO action_journal
           (domain, subject, subject_label, actor, action, payload, chain_seq, status,
            created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'applied', NOW(),
                 NOW() + ($8 || ' days')::interval)
         RETURNING id`,
        [
          domain,
          subject,
          subjectLabel ?? null,
          String(actor),
          action,
          payload === null || payload === undefined ? null : payload,
          Number(chainSeq),
          String(Number(retentionDays)),
        ]
      );
      const id = result.rows && result.rows[0] ? Number(result.rows[0].id) : undefined;
      return { id, chainSeq: Number(chainSeq) };
    },

    async getAction(actionId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM action_journal WHERE id = $1 LIMIT 1',
          [Number(actionId)]
        );
        return mapActionRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getActionForUpdate(tx, actionId) {
      // Guard the row against concurrent undo for the whole TX.
      const { rows } = await tx.query(
        'SELECT * FROM action_journal WHERE id = $1 LIMIT 1 FOR UPDATE',
        [Number(actionId)]
      );
      return mapActionRow(rows[0]);
    },

    async countLaterAppliedTx(tx, domain, subject, chainSeq) {
      const { rows } = await tx.query(
        `SELECT COUNT(*) AS cnt
           FROM action_journal
          WHERE domain = $1 AND subject = $2 AND status = 'applied' AND chain_seq > $3`,
        [domain, subject, Number(chainSeq)]
      );
      return Number(rows[0].cnt);
    },

    async listAppliedFromSeq(tx, domain, subject, chainSeq) {
      const { rows } = await tx.query(
        `SELECT * FROM action_journal
          WHERE domain = $1 AND subject = $2 AND status = 'applied' AND chain_seq >= $3
          ORDER BY chain_seq DESC`,
        [domain, subject, Number(chainSeq)]
      );
      return rows.map(mapActionRow);
    },

    async markUndone(tx, actionIds) {
      if (!actionIds || actionIds.length === 0) return { changes: 0 };
      const params = actionIds.map(Number);
      const placeholders = params.map((_, index) => `$${index + 1}`).join(', ');
      const result = await tx.run(
        `UPDATE action_journal
            SET status = 'undone', undone_at = NOW()
          WHERE id IN (${placeholders}) AND status = 'applied'`,
        params
      );
      return { changes: result.changes };
    },

    async listFeed({ actor, domain, limit } = {}) {
      try {
        const clauses = ["(status != 'expired' OR created_at >= NOW() - INTERVAL '30 days')"];
        const params = [];
        const bind = (value) => `$${params.push(value)}`;
        if (actor !== undefined && actor !== null) {
          clauses.push(`actor = ${bind(String(actor))}`);
        }
        if (domain !== undefined && domain !== null) {
          clauses.push(`domain = ${bind(domain)}`);
        }
        const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 200;
        const { rows } = await executor.query(
          `SELECT * FROM action_journal WHERE ${clauses.join(' AND ')}
           ORDER BY created_at DESC, id DESC LIMIT ${bind(cap)}`,
          params
        );
        return rows.map(mapActionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listBySubject(domain, subject, { limit } = {}) {
      try {
        const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 200;
        const { rows } = await executor.query(
          `SELECT * FROM action_journal
            WHERE domain = $1 AND subject = $2
            ORDER BY chain_seq DESC LIMIT $3`,
          [domain, subject, cap]
        );
        return rows.map(mapActionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async purgeSubject(domain, subject) {
      try {
        const result = await executor.run(
          'DELETE FROM action_journal WHERE domain = $1 AND subject = $2',
          [domain, subject]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async purgeSubjectTx(tx, domain, subject) {
      const result = await tx.run('DELETE FROM action_journal WHERE domain = $1 AND subject = $2', [
        domain,
        subject,
      ]);
      return { changes: result.changes };
    },

    async expireRows(cutoff) {
      try {
        const condition = cutoff != null ? 'expires_at < $1::timestamptz' : 'expires_at < NOW()';
        const params = cutoff != null ? [new Date(cutoff).toISOString()] : [];
        const result = await executor.run(
          `UPDATE action_journal SET payload = NULL, status = 'expired'
            WHERE status = 'applied' AND ${condition}`,
          params
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
