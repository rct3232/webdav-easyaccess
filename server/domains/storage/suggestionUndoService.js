'use strict';

/**
 * suggestionUndoService — the `file`-domain undo executor for cleanup-
 * suggestion accept commands (docs/spec/server/services/storageService.md
 * §2.6). Registers at module load via actionJournalStore.registerUndoExecutor;
 * the actions router dispatches generically (POST /api/actions/:id/undo).
 *
 * Inverse per item = restore-from-trash: fingerprint guard (trashed row with
 * the captured deleted_at, live parent), collision rename with the
 * trash-restore suffix idiom, WebDAV move-back BEFORE the DB marking (the
 * content world first, with an idempotent trash-gone/display-present check for
 * retries), S3 mode does zero physical I/O, then `renameNodeTx` +
 * `untrashSubtreeTx` + the suggestion rows `accepted → pending` on the
 * caller-owned journal TX — one transaction on BOTH dialects. Guard failures
 * SKIP the item (mixed results allowed; an already-restored node still flips
 * its suggestions so retries converge); an unexpected throw aborts the journal
 * TX (store spec §2.4, routes spec §2.4).
 */

const { createFileNodesStore } = require('../../store/fileNodesStore');
const storageSuggestionsStore = require('../../store/storageSuggestionsStore');
const actionJournalStore = require('../../store/actionJournalStore');
const { STORAGE_SUGGESTION_STATE, JOURNAL_DOMAIN } = require('@webdav-easyaccess/shared/constants');
const { getComposition } = require('../../service/composition');
const { buildTrashPath } = require('../../service/webdavRemoteOps');

const SKIP_CHANGED = { applied: false, reason: 'changed' };

function sameInstant(left, right) {
  // Normalize both sides to epoch ms. `new Date(value).getTime()` preserves
  // milliseconds for driver Date objects; `Date.parse(Date)` stringifies them
  // at second precision and would reject every PG fingerprint.
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** Trash-restore suffix idiom: `base (2).ext`, `base (3).ext`, … */
function resolveRestoreName(name, takenNames) {
  if (!takenNames.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!takenNames.has(candidate)) return candidate;
  }
}

/**
 * Factory. DI seams (tests); production resolves the shared facades.
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - facade instance (default: created)
 * @param {Object} [opts.suggestionsStore] - storageSuggestionsStore facade
 * @param {() => Object} [opts.composition] - getComposition seam
 */
function createSuggestionUndoService({
  fileNodesStore,
  suggestionsStore,
  composition: compositionGetter,
} = {}) {
  const nodes = () => fileNodesStore || createFileNodesStore();
  const suggestions = () => suggestionsStore || storageSuggestionsStore;
  const compose = () => (compositionGetter || getComposition)();

  async function flipSuggestionsToPending(item, tx) {
    const ids = item && Array.isArray(item.suggestionIds) ? item.suggestionIds : [];
    if (ids.length === 0) return;
    await suggestions().flipStatesTx(tx, {
      ids,
      fromState: STORAGE_SUGGESTION_STATE.ACCEPTED,
      toState: STORAGE_SUGGESTION_STATE.PENDING,
    });
  }

  async function applyRestoreItem(item, tx) {
    if (!item || !Number.isInteger(Number(item.nodeId))) return SKIP_CHANGED;
    const nodeId = Number(item.nodeId);
    const store = nodes();

    const node = await store.getNodeIncludingTrashed(nodeId);
    if (!node || node.type !== 'file') return SKIP_CHANGED;

    // Already live: a previous attempt committed the node restore but not the
    // journal flip (or the user restored it through the trash UX). The
    // suggestion flip is idempotent and must still converge on retry.
    if (node.deletedAt == null) {
      await flipSuggestionsToPending(item, tx);
      return SKIP_CHANGED;
    }
    if (!sameInstant(node.deletedAt, item.deletedAt)) return SKIP_CHANGED;

    if (node.parentId != null) {
      const parent = await store.getNodeIncludingTrashed(Number(node.parentId));
      if (!parent || parent.deletedAt != null) return SKIP_CHANGED;
    }

    // Collision with a live sibling: restore under the suffix idiom.
    const siblings = await store.getChildren(node.parentId == null ? null : Number(node.parentId));
    const takenNames = new Set(siblings.map((row) => String(row.name)));
    const finalName = resolveRestoreName(String(node.name), takenNames);

    // Content world first (webdav only): move the trash entry back to the
    // final display path BEFORE any DB marking.
    const { fileStorageMode, blobStore, fileNodeService } = compose();
    if (fileStorageMode === 'webdav' && blobStore) {
      const trashPath = buildTrashPath(nodeId);
      const parentDisplayPath =
        node.parentId == null ? '' : await fileNodeService.getNodePath(Number(node.parentId));
      const displayPath = `${parentDisplayPath}/${finalName}`;
      let trashEntry = null;
      try {
        trashEntry = await blobStore.headBlob(trashPath);
      } catch (error) {
        void error;
        return SKIP_CHANGED;
      }
      if (trashEntry != null) {
        await blobStore.moveBlob(trashPath, displayPath);
      } else {
        // Idempotent retry: a prior attempt moved the content before its DB TX
        // rolled back. Treat the display path as already moved when present;
        // when neither path holds the content there is nothing safe to do.
        let displayEntry = null;
        try {
          displayEntry = await blobStore.headBlob(displayPath);
        } catch (error) {
          void error;
          return SKIP_CHANGED;
        }
        if (displayEntry == null) return SKIP_CHANGED;
      }
    }

    if (finalName !== node.name) {
      await store.renameNodeTx(tx, nodeId, finalName);
    }
    await store.untrashSubtreeTx(tx, [nodeId]);
    await flipSuggestionsToPending(item, tx);
    return { applied: true };
  }

  /**
   * The registered handler: command-unit rows apply every item independently
   * (per-item fingerprint guards; skips never abort).
   */
  async function handle({ row, tx }) {
    const payload = (row && row.payload) || {};
    if (!payload.inverse || payload.inverse.op !== 'restore-from-trash') {
      // unknown op (version skew) — nothing applied, nothing failed loudly
      return [];
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const outcomes = [];
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(await applyRestoreItem(item, tx));
    }
    return outcomes;
  }

  return { handle, applyRestoreItem };
}

/** Shared default instance + registration (module-load side effect). */
const sharedService = createSuggestionUndoService();
actionJournalStore.registerUndoExecutor(JOURNAL_DOMAIN.FILE, (args) => sharedService.handle(args));

module.exports = { createSuggestionUndoService, sharedService, resolveRestoreName };
