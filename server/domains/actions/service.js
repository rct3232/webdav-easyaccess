'use strict';

/**
 * actions domain service — the 30-day undo-journal feed and undo execution
 * (docs/spec/server/routes/actions.md). Reads and undo only: new journal rows
 * land exclusively through `actionJournalStore.commitChange` inside the writer
 * domains (v1 writers = collections).
 *
 * Undo reuses the journal writer's discipline (subject lock + ONE tx) via
 * `actionJournalStore.undoAction`; the collection-domain inverse executor is
 * registered HERE because inverse application is this router's job (§2.1).
 * It applies `payload.inverse` (or the per-item list) with tx-bound
 * CollectionsRepository operations — never collectionsStore mutators, which
 * would journal the undo itself (no undo-of-undo, §4.11).
 */
const storage = require('../../store/storage');
const actionJournalStore = require('../../store/actionJournalStore');
const collectionsStore = require('../../store/collectionsStore');
const createCollectionsRepository = require('../../store/repositories/CollectionsRepository');
const { createError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

// Journal domains enum (§5 schema CHECK; routes/actions.md §2.4).
const JOURNAL_DOMAINS = [
  'collection',
  'batch',
  'settings',
  'permissions',
  'tags',
  'file',
  'sharing',
];

// Fixed feed window + cap (routes.md §2.4 decisions: 30d listing horizon,
// cap 200, no cursor — personal scale).
const FEED_WINDOW_DAYS = 30;
const FEED_LIMIT = 200;

// One tx-capable CollectionsRepository per dialect, mirroring the
// collectionsStore facade's dialect dispatch (recentFiles precedent).
const collectionsReposByDialect = new Map();

function getTxCollectionsRepository() {
  const executor = storage.getExecutor();
  let repo = collectionsReposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createCollectionsRepository(executor);
    collectionsReposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

// -- errors ------------------------------------------------------------------
// House pattern: the service throws bare string codes (+ status/params where
// the route needs more than mapServiceError carries). The fingerprint refusal
// is thrown by the undo executor INSIDE the store's undo tx — it must carry
// status+errorCode so the tx wrapper's mapDatabaseError preserves it verbatim.

function serviceError(code, status, params) {
  const error = new Error(code);
  error.status = status;
  if (params != null) error.params = params;
  return error;
}

function fingerprintRefusal() {
  return createError(SERVER_ERROR_CODES.actions.fingerprintMismatch, 409);
}

// -- subject helpers ---------------------------------------------------------

/** `collection:<id>` → numeric id; anything else → null. */
function parseCollectionSubject(subject) {
  if (typeof subject !== 'string' || !subject.startsWith('collection:')) return null;
  const id = Number(subject.slice('collection:'.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Feed/undo visibility (routes.md §2.4): the requester's own rows, plus
 * `actor='system'` rows whose subject resolves to a collection the requester
 * owns (silent system acts are undoable by their victim-user).
 */
async function isVisibleTo(requesterId, row) {
  if (row.actor === 'system') {
    const collectionId = parseCollectionSubject(row.subject);
    if (collectionId === null) return false;
    const collection = await collectionsStore.getCollection(collectionId);
    return Boolean(collection && collection.ownerId === Number(requesterId));
  }
  return String(row.actor) === String(requesterId);
}

// -- feed --------------------------------------------------------------------

/**
 * GET /api/actions — scoped 30-day feed, newest first, cap 200 (no cursor).
 * @param {number} requesterId
 * @param {{ domain?: string }} [options]
 */
async function getActionsFeed(requesterId, { domain } = {}) {
  if (domain != null && !JOURNAL_DOMAINS.includes(domain)) {
    throw serviceError('invalidDomain', 400);
  }

  const ownRows = await actionJournalStore.listFeed({ actor: String(requesterId), domain });
  const systemRows = await actionJournalStore.listFeed({ actor: 'system', domain });

  // System rows resolve to an owner at read time: only those whose subject is
  // a collection owned by the requester are visible (spec trusts the commit-
  // time scoping; non-collection subjects cannot be scoped in v1 and stay out).
  const scopedSystemRows = [];
  for (const row of systemRows) {
    const collectionId = parseCollectionSubject(row.subject);
    if (collectionId === null) continue;
    // eslint-disable-next-line no-await-in-loop
    const collection = await collectionsStore.getCollection(collectionId);
    if (collection && collection.ownerId === Number(requesterId)) {
      scopedSystemRows.push(row);
    }
  }

  const cutoff = Date.now() - FEED_WINDOW_DAYS * 24 * 3600 * 1000;
  const feed = [...ownRows, ...scopedSystemRows]
    .filter((row) => Date.parse(row.createdAt) >= cutoff) // fixed 30d listing horizon
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
    .slice(0, FEED_LIMIT);

  // is_tip is the undo guard's rule rendered for display: highest chain_seq
  // among the subject's `applied` rows, computed SERVER-SIDE over the FULL
  // chain across every actor (routes/actions.md §2.4). Sharing makes this
  // load-bearing: a granted editor's journaled member ops land on the
  // owner's `collection:<id>` subject, so the feed's requester-visible
  // subset can legitimately omit the chain tip — deriving the flag from the
  // subset would disagree with the guard (store §2.4 step 2 checks the same
  // full chain). Per applied row: no later applied row on the subject.
  const tipByAppliedRow = new Map();
  for (const row of feed) {
    if (row.status !== 'applied') continue;
    // eslint-disable-next-line no-await-in-loop
    const laterCount = await actionJournalStore.countLaterChanges(
      row.domain,
      row.subject,
      row.chainSeq
    );
    tipByAppliedRow.set(row.id, laterCount === 0);
  }

  return {
    actions: feed.map((row) => ({
      action_id: row.id,
      domain: row.domain,
      subject: row.subject,
      subject_label: row.subjectLabel,
      actor: row.actor === 'system' ? 'system' : Number(row.actor),
      action: row.action,
      status: row.status,
      chain_seq: row.chainSeq,
      is_tip: row.status === 'applied' && tipByAppliedRow.get(row.id) === true,
      undo_available: row.status === 'applied',
      created_at: row.createdAt,
      undone_at: row.undoneAt,
      expires_at: row.expiresAt,
    })),
  };
}

// -- undo executor (collection domain) ---------------------------------------

function outcomeFromChanges(changes) {
  return { applied: changes > 0 };
}

/**
 * Apply ONE inverse descriptor with tx-bound collections operations.
 * Precondition checks are the fingerprint proxy for the v1 op set: an inverse
 * whose expected "from" state is missing reports `changed` (skipped for
 * command-unit items; refused via fingerprintRefusal for single inverses).
 */
async function applyInverseTx(tx, inverse, row) {
  if (!inverse || typeof inverse.op !== 'string') {
    return { applied: false, reason: 'changed' };
  }
  const repo = getTxCollectionsRepository();
  const numericActorOr = (value, fallback) => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
  };

  switch (inverse.op) {
    case 'delete-collection': {
      const existing = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!existing) return { applied: false, reason: 'changed' };
      const removed = await repo.deleteCollectionRow(tx, inverse.collectionId);
      return outcomeFromChanges(removed.changes);
    }
    case 'rename-collection': {
      const existing = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!existing || existing.name === inverse.previousName) {
        return { applied: false, reason: 'changed' };
      }
      const { changes } = await repo.renameCollection(
        tx,
        inverse.collectionId,
        inverse.previousName,
        false
      );
      return outcomeFromChanges(changes);
    }
    case 'set-pinned': {
      const existing = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!existing || existing.pinned === Boolean(inverse.pinned)) {
        return { applied: false, reason: 'changed' };
      }
      const { changes } = await repo.updatePin(
        tx,
        inverse.collectionId,
        Boolean(inverse.pinned),
        inverse.pinned ? 'user' : null
      );
      return outcomeFromChanges(changes);
    }
    case 'restore-collection': {
      // guarded update — changes 0 already means "not archived / missing"
      const { changes } = await repo.restoreRow(tx, inverse.collectionId);
      return outcomeFromChanges(changes);
    }
    case 'archive-collection': {
      const { changes } = await repo.archiveRow(tx, inverse.collectionId);
      return outcomeFromChanges(changes);
    }
    case 'remove-item': {
      const { changes } = await repo.deleteItem(tx, inverse.collectionId, inverse.nodeId);
      return outcomeFromChanges(changes);
    }
    case 'add-item': {
      const collection = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!collection) return { applied: false, reason: 'changed' };
      const { changes } = await repo.insertItem(
        tx,
        inverse.collectionId,
        inverse.nodeId,
        numericActorOr(inverse.addedBy, collection.ownerId),
        { published: true }
      );
      return outcomeFromChanges(changes);
    }
    case 'remove-exclusion': {
      const { changes } = await repo.deleteExclusion(tx, inverse.collectionId, inverse.nodeId);
      return outcomeFromChanges(changes);
    }
    case 'add-exclusion': {
      const existing = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!existing) return { applied: false, reason: 'changed' };
      const { changes } = await repo.insertExclusion(tx, inverse.collectionId, inverse.nodeId);
      return outcomeFromChanges(changes);
    }
    case 'set-items-published': {
      const { changes } = await repo.setItemPublished(
        tx,
        inverse.collectionId,
        inverse.nodeIds,
        Boolean(inverse.published)
      );
      return outcomeFromChanges(changes);
    }
    case 'revoke-access': {
      const { changes } = await repo.deleteGrant(tx, inverse.collectionId, inverse.granteeId);
      return outcomeFromChanges(changes);
    }
    case 'grant-access': {
      if (!inverse.role) return { applied: false, reason: 'changed' };
      const existing = await repo.getCollectionTx(tx, inverse.collectionId);
      if (!existing) return { applied: false, reason: 'changed' };
      // granted_by references users: keep the capturing actor when numeric,
      // fall back to the collection owner (FK-safe on system acts).
      const grantedBy = numericActorOr(inverse.grantedBy ?? row.actor, existing.ownerId);
      const { changes } = await repo.upsertGrant(
        tx,
        inverse.collectionId,
        inverse.granteeId,
        inverse.role,
        grantedBy
      );
      return outcomeFromChanges(changes);
    }
    default:
      // unknown op (version skew) — cannot be applied, never flips state
      return { applied: false, reason: 'changed' };
  }
}

/**
 * Undo executor for the `collection` domain (store §2.4 registerUndoExecutor).
 * Command-unit rows (payload.items) report per-item outcomes — skipped items
 * do NOT abort; a single-inverse command whose precondition fails REFUSES by
 * throwing, which aborts the whole undo tx so the row stays `applied`
 * (routes.md §2.4 fingerprint guard; store §2.6 handler-throw contract).
 */
async function applyCollectionInverse({ row, tx }) {
  const payload = row.payload || {};
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    const outcomes = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const item of payload.items) {
      // Command-unit entries carry their inverse descriptor NESTED under
      // `inverse` (the store facade's write format for add-items/remove-items
      // commands, collectionsStore §2.3); a flat `{op, …}` item is honored as
      // the historical executor-test shape. Passing the raw item here was the
      // RCA 2026-09-23 defect: every item of a real command row silently
      // skipped (`op` undefined ⇒ reason 'changed') while the row flipped to
      // `undone`.
      const descriptor = item && item.inverse ? item.inverse : item;
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(await applyInverseTx(tx, descriptor, row));
    }
    return outcomes;
  }

  // The row is needed by inverses that fall back to the capturing actor
  // (`grant-access` → row.actor); dropping it here broke undo-revoke with a
  // raw TypeError mapped to databaseQueryFailed (RCA 2026-10-02).
  const outcome = await applyInverseTx(tx, payload.inverse, row);
  if (!outcome.applied) {
    throw fingerprintRefusal();
  }
  return [outcome];
}

actionJournalStore.registerUndoExecutor('collection', applyCollectionInverse);

// -- undo --------------------------------------------------------------------

/**
 * POST /api/actions/:id/undo — visibility-checked undo delegating the lock+tx
 * mechanics to actionJournalStore.undoAction.
 * @param {number} requesterId
 * @param {number|string} actionId
 * @param {{ confirmCascade?: boolean }} [options]
 */
async function undoAction(requesterId, actionId, { confirmCascade = false } = {}) {
  const row = await actionJournalStore.getAction(actionId);
  if (!row || !(await isVisibleTo(requesterId, row))) {
    throw serviceError('notFound', 404);
  }

  const result = await actionJournalStore.undoAction(actionId, {
    cascade: Boolean(confirmCascade),
  });

  if (result.code) {
    switch (result.code) {
      case 'journal_not_found':
        throw serviceError('notFound', 404);
      case 'journal_already_undone':
        throw serviceError('alreadyUndone', 409);
      case 'journal_expired':
        throw serviceError('expired', 409);
      case 'journal_cascade_required':
        throw serviceError('cascadeConfirmRequired', 409, {
          laterChanges: result.laterCount,
        });
      default:
        throw serviceError('notFound', 404);
    }
  }

  // Success: re-read the flipped row for the response timestamps.
  const undone = await actionJournalStore.getAction(actionId);
  return {
    action_id: undone.id,
    status: undone.status,
    undone_at: undone.undoneAt,
    cascade_undone: (result.undoneIds || []).filter((id) => id !== Number(actionId)),
    items_undone: result.undone,
    items_skipped: result.skipped.length,
  };
}

module.exports = {
  JOURNAL_DOMAINS,
  FEED_LIMIT,
  FEED_WINDOW_DAYS,
  getActionsFeed,
  undoAction,
  applyCollectionInverse,
};
