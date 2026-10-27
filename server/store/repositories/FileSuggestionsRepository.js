'use strict';

/**
 * FileSuggestionsRepository — domain interface over the `file_suggestions`
 * table (docs/spec/server/store/fileSuggestionsStore.md). Persisted cleanup/
 * duplicate suggestion rows (docs/features/collections-platform.md §4.17):
 * ids for dismissal, `expires_at` for the retention pass, and the
 * `pending → accepted | dismissed | expired` state machine (`accepted →
 * pending` on undo) enforced HERE — the table ships no CHECK constraints
 * (001 DDL is immutable), so the WHERE clauses are the state discipline.
 *
 * Rows are domain-shaped `{ id, userId, nodeId, kind, reason, state,
 * createdAt, expiresAt }`; `reason` is the parsed JSONB object with
 * snake_case keys (wire-passthrough, store spec §2.2), timestamps are ISO
 * strings. Every method taking `tx` runs against a CALLER-OWNED queryable —
 * the `commitChange`/`undoAction` transaction of actionJournalStore, or the
 * executor itself (facade-dispatch precedent of ActionJournalRepository).
 *
 * @typedef {Object} FileSuggestionsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(row: { userId, nodeId, kind, reason?, expiresAt?: string|null }) => Promise<{ id: number }>} insert
 *   INSERT as `state='pending'`; `created_at` DB-default NOW(); `expires_at`
 *   bound from the caller's ISO value (NULL = never expires). FK violations
 *   map through mapDatabaseError.
 * @property {(userId: number) => Promise<Array>} listPending
 *   `state='pending'` rows, ORDER BY id (expiry filter + kind-rank order are
 *   consumer concerns — store spec §2.3).
 * @property {(userId: number) => Promise<Array<{ nodeId: number, kind: string, state: string }>>} listKeys
 *   Full per-user history projection for the generator dedupe/reconcile.
 * @property {(userId: number, id: number) => Promise<{ changes: number }>} dismiss
 *   `pending → dismissed`, user-scoped; 0 = unknown/foreign/non-pending.
 * @property {(tx, userId: number, nodeIds: number[], state: string) => Promise<Array<{ id: number, nodeId: number, kind: string }>>} listIdsByNodesTx
 * @property {(tx, { ids: number[], fromState: string, toState: string }) => Promise<{ changes: number }>} flipStatesTx
 *   State flip restricted to the id set AND the expected `fromState`.
 * @property {({ now: number|Date|string, limit: number }) => Promise<{ changes: number, ids: number[] }>} expireStale
 *   Bounded retention pass: select pending ids with `expires_at < now`
 *   (NULL exempt), flip to `expired`.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {FileSuggestionsRepository}
 */
module.exports = function createFileSuggestionsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createFileSuggestionsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/FileSuggestionsRepository.sqlite')
      : require('./postgres/FileSuggestionsRepository.postgres');
  return impl(executor);
};
