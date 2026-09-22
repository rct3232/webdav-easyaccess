'use strict';

/**
 * ActionJournalRepository — domain interface over the `action_journal` table
 * (docs/spec/server/store/actionJournalStore.md). The journal has NO FKs:
 * rows intentionally outlive their subjects (invariant 4/10, §4.11).
 *
 * `commitChange`/undo mechanics live in the facade (`store/actionJournalStore.js`);
 * this repository provides the tx-bound row operations they compose with:
 * every method taking `tx` runs INSIDE a caller-owned transaction.
 *
 * Domain rows are shaped `{ id, domain, subject, subjectLabel, actor, action,
 * payload, chainSeq, status, createdAt, undoneAt, expiresAt }` — payload is a
 * parsed object on both dialects (JSONB pg / TEXT sqlite), timestamps ISO
 * strings (repository-contract rule 2).
 *
 * @typedef {Object} ActionJournalRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(tx, domain: string, subject: string) => Promise<number>} getMaxChainSeq
 *   MAX(chain_seq) over ALL rows of the subject (monotonic chain — undone rows
 *   still consume their slot).
 * @property {(tx, fields) => Promise<{ id: number, chainSeq: number }>} insertAction
 *   fields = { domain, subject, subjectLabel?, actor, action, payload, chainSeq,
 *   retentionDays }; status='applied', created_at=now, expires_at=now+retention.
 * @property {(actionId) => Promise<Object|null>} getAction
 * @property {(tx, actionId) => Promise<Object|null>} getActionForUpdate
 *   Row guard for the undo TX (FOR UPDATE on PG; serialized on sqlite).
 * @property {(tx, domain, subject, chainSeq) => Promise<number>} countLaterAppliedTx
 * @property {(tx, domain, subject, chainSeq) => Promise<Array>} listAppliedFromSeq
 *   Applied rows tip..chainSeq, newest first (cascade undo).
 * @property {(tx, actionIds: number[]) => Promise<{ changes: number }>} markUndone
 * @property {({ actor?, domain?, limit? }) => Promise<Array>} listFeed
 * @property {(domain, subject, { limit? }) => Promise<Array>} listBySubject
 * @property {(domain, subject) => Promise<{ changes: number }>} purgeSubject
 *   The ONLY sanctioned journal DELETE (invariant 10) — standalone statement.
 * @property {(tx, domain, subject) => Promise<{ changes: number }>} purgeSubjectTx
 *   Same delete for caller-owned TXs (permanent-delete flows).
 * @property {(cutoff?: Date|string) => Promise<{ changes: number }>} expireRows
 *   GC: applied rows past expires_at → payload=NULL, status='expired'.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {ActionJournalRepository}
 */
module.exports = function createActionJournalRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createActionJournalRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/ActionJournalRepository.sqlite')
      : require('./postgres/ActionJournalRepository.postgres');
  return impl(executor);
};
