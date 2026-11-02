'use strict';

/**
 * actionJournalStore facade — the generic undo journal (docs/spec/server/
 * store/actionJournalStore.md). Common infrastructure, NOT ai-prefixed.
 *
 * `commitChange` is THE only journaled write path: the domain change and its
 * `action_journal` row land in ONE executor transaction under a lockManager
 * subject lock (§4.11). This module contains no SQL — it delegates to
 * ActionJournalRepository built over `storage.getExecutor()`.
 */
const storage = require('./storage');
const lockManager = require('../infrastructure/lockManager');
const createActionJournalRepository = require('./repositories/ActionJournalRepository');

// Rows are retained 30 days; the payload is NULLed at expiry while the audit
// columns survive (§4.11 retention). Module constant per spec §2.2.
const JOURNAL_RETENTION_DAYS = 30;

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override) — recentFiles precedent.
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createActionJournalRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

// The registered undo executors, keyed by domain: handler({ row, tx }) =>
// ItemOutcome[] where ItemOutcome = { applied: boolean, reason?: string }.
const undoExecutors = new Map();

/**
 * THE journaled write path. `subject` is the opaque subject string — OR a
 * resolver `(mutationResult) => string` for create-flows whose subject id only
 * exists after the mutation (resolver subjects lock on `journal:<domain>:new`;
 * the chain still starts at 1 per fresh subject).
 *
 * @param {string} domain
 * @param {string|Function} subject
 * @param {{ actor: string, action: string, subjectLabel?: string }} meta
 * @param {Object|Function} inverse domain-defined inverse descriptor (or
 *   `(mutationResult) => descriptor`)
 * @param {(tx: { query: Function, run: Function }) => Promise<*>} mutation
 * @returns {Promise<{ id: number, chainSeq: number }>}
 */
async function commitChange(domain, subject, meta, inverse, mutation) {
  const lockName = `journal:${domain}:${typeof subject === 'function' ? 'new' : subject}`;
  const lock = await lockManager.acquireLock(lockName);
  try {
    return await storage.getExecutor().transaction(async (tx) => {
      const result = await mutation(tx);
      const resolvedSubject = typeof subject === 'function' ? subject(result) : subject;
      const repo = getRepository();
      const maxSeq = await repo.getMaxChainSeq(tx, domain, resolvedSubject);
      const chainSeq = maxSeq + 1;
      const payload = typeof inverse === 'function' ? inverse(result) : inverse;
      const inserted = await repo.insertAction(tx, {
        domain,
        subject: resolvedSubject,
        subjectLabel: meta.subjectLabel,
        actor: meta.actor,
        action: meta.action,
        payload,
        chainSeq,
        retentionDays: JOURNAL_RETENTION_DAYS,
      });
      // `result` carries the mutation's own value (rows / { changes }) so the
      // caller can surface both the collection data and the undo pointer.
      return { id: inserted.id, chainSeq, result };
    });
  } finally {
    await lock.release();
  }
}

function registerUndoExecutor(domain, handler) {
  undoExecutors.set(domain, handler);
}

/**
 * @param {number} actionId
 * @param {{ cascade?: boolean }} [options]
 * @returns {Promise<{ undone: number, skipped: Array<{ reason: string }>,
 *   undoneIds: number[] }
 *   | { code: 'journal_cascade_required', laterCount: number }>}
 */
async function undoAction(actionId, { cascade = false } = {}) {
  const repo = getRepository();
  // Lock-key probe: the guard read happens again inside the TX.
  const probe = await repo.getAction(actionId);
  if (!probe) return { code: 'journal_not_found' };
  const lock = await lockManager.acquireLock(`journal:${probe.domain}:${probe.subject}`);
  try {
    return await storage.getExecutor().transaction(async (tx) => {
      const row = await repo.getActionForUpdate(tx, actionId);
      if (!row) return { code: 'journal_not_found' };
      if (row.status === 'undone') return { code: 'journal_already_undone' };
      if (row.status === 'expired') return { code: 'journal_expired' };

      const laterCount = await repo.countLaterAppliedTx(tx, row.domain, row.subject, row.chainSeq);
      if (laterCount > 0 && !cascade) {
        return { code: 'journal_cascade_required', laterCount };
      }

      const rows = cascade
        ? await repo.listAppliedFromSeq(tx, row.domain, row.subject, row.chainSeq)
        : [row];

      const handler = undoExecutors.get(row.domain);
      if (!handler) {
        throw new Error(`No undo executor registered for domain: ${row.domain}`);
      }

      let undone = 0;
      const skipped = [];
      for (const target of rows) {
        const outcomes = (await handler({ row: target, tx })) || [];
        for (const outcome of outcomes) {
          if (outcome && outcome.applied) {
            undone += 1;
          } else {
            skipped.push({ reason: (outcome && outcome.reason) || 'changed' });
          }
        }
      }

      // Status flip is the record of the undo pass — it happens for every
      // processed row even when all its items were fingerprint-skipped
      // (§2.4 step 4; no undo-of-undo). undoneIds feeds the undo response's
      // cascade_undone (routes/actions.md §2.4) without a second read.
      await repo.markUndone(
        tx,
        rows.map((target) => target.id)
      );
      return { undone, skipped, undoneIds: rows.map((target) => target.id) };
    });
  } finally {
    await lock.release();
  }
}

async function getAction(actionId) {
  return getRepository().getAction(actionId);
}

async function countLaterChanges(domain, subject, chainSeq) {
  const executor = storage.getExecutor();
  return getRepository().countLaterAppliedTx(executor, domain, subject, chainSeq);
}

async function listFeed(options = {}) {
  return getRepository().listFeed(options);
}

async function listBySubject(domain, subject, options = {}) {
  return getRepository().listBySubject(domain, subject, options);
}

async function purgeSubject(domain, subject) {
  return getRepository().purgeSubject(domain, subject);
}

/** Same sanctioned delete for caller-owned TXs (permanent-delete flows). */
async function purgeSubjectTx(tx, domain, subject) {
  return getRepository().purgeSubjectTx(tx, domain, subject);
}

async function expireJournalRows(now) {
  return getRepository().expireRows(now ?? undefined);
}

module.exports = {
  commitChange,
  undoAction,
  getAction,
  countLaterChanges,
  listFeed,
  listBySubject,
  purgeSubject,
  purgeSubjectTx,
  expireJournalRows,
  registerUndoExecutor,
  JOURNAL_RETENTION_DAYS,
};
