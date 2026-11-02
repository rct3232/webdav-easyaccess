'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapActionRow } = require('../actionJournalShared');

/**
 * sqlite implementation of ActionJournalRepository (`?` placeholders).
 *
 * Methods taking `tx` run INSIDE a caller-owned transaction (the facade's
 * commitChange/undoAction TX); the remaining reads/writes execute directly.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteActionJournalRepository(executor) {
  return {
    dialect: 'sqlite',

    async getMaxChainSeq(tx, domain, subject) {
      const { rows } = await tx.query(
        'SELECT COALESCE(MAX(chain_seq), 0) AS max_seq FROM action_journal WHERE domain = ? AND subject = ?',
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
         VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', CURRENT_TIMESTAMP,
                 datetime('now', ?))`,
        [
          domain,
          subject,
          subjectLabel ?? null,
          String(actor),
          action,
          payload === null || payload === undefined ? null : JSON.stringify(payload),
          Number(chainSeq),
          `+${Number(retentionDays)} days`,
        ]
      );
      return { id: Number(result.lastId), chainSeq: Number(chainSeq) };
    },

    async getAction(actionId) {
      try {
        const { rows } = await executor.query('SELECT * FROM action_journal WHERE id = ? LIMIT 1', [
          Number(actionId),
        ]);
        return mapActionRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getActionForUpdate(tx, actionId) {
      // sqlite serializes whole transactions — a plain read is the guard.
      const { rows } = await tx.query('SELECT * FROM action_journal WHERE id = ? LIMIT 1', [
        Number(actionId),
      ]);
      return mapActionRow(rows[0]);
    },

    async countLaterAppliedTx(tx, domain, subject, chainSeq) {
      const { rows } = await tx.query(
        `SELECT COUNT(*) AS cnt
           FROM action_journal
          WHERE domain = ? AND subject = ? AND status = 'applied' AND chain_seq > ?`,
        [domain, subject, Number(chainSeq)]
      );
      return Number(rows[0].cnt);
    },

    async listAppliedFromSeq(tx, domain, subject, chainSeq) {
      const { rows } = await tx.query(
        `SELECT * FROM action_journal
          WHERE domain = ? AND subject = ? AND status = 'applied' AND chain_seq >= ?
          ORDER BY chain_seq DESC`,
        [domain, subject, Number(chainSeq)]
      );
      return rows.map(mapActionRow);
    },

    async markUndone(tx, actionIds) {
      if (!actionIds || actionIds.length === 0) return { changes: 0 };
      const placeholders = actionIds.map(() => '?').join(', ');
      const result = await tx.run(
        `UPDATE action_journal
            SET status = 'undone', undone_at = CURRENT_TIMESTAMP
          WHERE id IN (${placeholders}) AND status = 'applied'`,
        actionIds.map(Number)
      );
      return { changes: result.changes };
    },

    async listFeed({ actor, domain, limit } = {}) {
      try {
        const clauses = [
          "(status != 'expired' OR julianday(created_at) >= julianday('now', '-30 days'))",
        ];
        const params = [];
        if (actor !== undefined && actor !== null) {
          clauses.push('actor = ?');
          params.push(String(actor));
        }
        if (domain !== undefined && domain !== null) {
          clauses.push('domain = ?');
          params.push(domain);
        }
        const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 200;
        params.push(cap);
        const { rows } = await executor.query(
          `SELECT * FROM action_journal WHERE ${clauses.join(' AND ')}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
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
            WHERE domain = ? AND subject = ?
            ORDER BY chain_seq DESC LIMIT ?`,
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
          'DELETE FROM action_journal WHERE domain = ? AND subject = ?',
          [domain, subject]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async purgeSubjectTx(tx, domain, subject) {
      const result = await tx.run('DELETE FROM action_journal WHERE domain = ? AND subject = ?', [
        domain,
        subject,
      ]);
      return { changes: result.changes };
    },

    async expireRows(cutoff) {
      try {
        const condition =
          cutoff != null
            ? 'julianday(expires_at) < julianday(?)'
            : "julianday(expires_at) < datetime('now')";
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
