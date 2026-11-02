'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createOperationProgressStore } = require('../stores/operationProgress');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const storage = require('../../../store/storage');
const actionJournalStore = require('../../../store/actionJournalStore');
const createFileNodeRepository = require('../../../store/repositories/FileNodeRepository');
const { createAncestryHelper } = require('../../../service/_ancestryHelper');
const { createError } = require('../../../utils/errorHandler');

/** Resolve a parent id for fingerprint/inverse comparisons (null = no parent). */
function normalizeParent(value) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

/**
 * ONE command row per accepted move/copy batch (`store/actionJournalStore.md` §2.2 —
 * domain `batch`, subject `batch:<jobId>`, item-level inverse list in the payload).
 * Items whose capture data is missing (move without a readable previous parent, copy
 * without a readable created-node name) are not journaled — they cannot be undone.
 */
function buildBatchJournalItems(operation, succeeded) {
  const entries = Array.isArray(succeeded) ? succeeded : [];
  if (operation === 'move') {
    return entries
      .filter((e) => e && e.sourceNodeId != null && e.previousParentNodeId !== undefined)
      .map((e) => ({
        nodeId: Number(e.sourceNodeId),
        kind: 'move',
        fingerprint: { parentId: normalizeParent(e.destinationParentNodeId) },
        inverse: {
          op: 'move-back',
          nodeId: Number(e.sourceNodeId),
          parentId: normalizeParent(e.previousParentNodeId),
        },
      }));
  }
  if (operation === 'copy') {
    return entries
      .filter((e) => e && e.copiedNodeId != null && e.name != null)
      .map((e) => ({
        nodeId: Number(e.copiedNodeId),
        kind: 'copy',
        fingerprint: { parentId: normalizeParent(e.destinationParentNodeId), name: e.name },
        inverse: { op: 'trash-node', nodeId: Number(e.copiedNodeId) },
      }));
  }
  return [];
}

/** Public `results` succeeded entries — internal capture fields never serialize. */
function publicSucceededEntries(operation, succeeded) {
  const entries = Array.isArray(succeeded) ? succeeded : [];
  if (operation === 'delete') {
    return entries.map((nodeId) => ({ nodeId, status: 'succeeded' }));
  }
  return entries.map((entry) => ({
    sourceNodeId: entry.sourceNodeId,
    destinationParentNodeId: entry.destinationParentNodeId,
    status: 'succeeded',
  }));
}

/**
 * Async worker that processes a bulk job from the operation progress store.
 * Reads the job, dispatches to the appropriate batch method (honoring
 * `job.cancelled` at every item boundary), writes the command-unit journal row
 * for journaled move/copy results, and updates progress.
 */
async function _processBulkJob(jobId) {
  const opStore = createOperationProgressStore();
  const job = opStore.getJob(jobId);
  if (!job) return;

  const { getComposition } = require('../../../service/composition');
  const { batchOperationService: batchOp, aclService } = getComposition();

  try {
    // DEF-21: the worker executes as the REQUESTING principal, never a
    // synthesized identity — per-item ACL gates and the D6 ownership-transfer
    // cleanup must observe the same user the job was created for.
    const user = await aclService.getCachedUser(job.userId);
    if (!user) {
      opStore.updateJob(jobId, {
        status: 'failed',
        errorMessage: 'serverErrors.auth.userNotFound',
      });
      return;
    }

    opStore.updateJob(jobId, { status: 'running', progress: 0 });

    // Cancellation seam: the per-item loops re-read the job's `cancelled` flag
    // (set by POST /bulk-operation/:jobId/cancel) before every item. A vanished
    // job reads as cancelled — there is no one left to report to.
    const isCancelled = () => {
      const current = opStore.getJob(jobId);
      return !current || current.cancelled === true;
    };

    let result;
    switch (job.operation) {
      case 'delete': {
        result = await batchOp.batchDelete(job.payload.nodeIds, job.userId, user, { isCancelled });
        break;
      }
      case 'move': {
        result = await batchOp.batchMove(job.payload.moves, job.userId, user, { isCancelled });
        break;
      }
      case 'copy': {
        result = await batchOp.batchCopy(job.payload.copies, job.userId, user, { isCancelled });
        break;
      }
      default:
        opStore.updateJob(jobId, {
          status: 'failed',
          errorMessage: `Unknown operation: ${job.operation}`,
        });
        return;
    }

    const countKey =
      result.deletedCount != null
        ? 'deletedCount'
        : result.movedCount != null
          ? 'movedCount'
          : result.copiedCount != null
            ? 'copiedCount'
            : null;

    // Command-unit journal (batchOperationService.md §5.4): move/copy batches
    // with a succeeded prefix record ONE `batch:<jobId>` command row. Delete
    // batches ride the trash-restore surface instead. A journal failure is
    // absorbed — losing undo beats lying about the completion report.
    let undo = null;
    if (job.operation === 'move' || job.operation === 'copy') {
      const items = buildBatchJournalItems(job.operation, result.succeeded);
      if (items.length > 0) {
        try {
          const committed = await actionJournalStore.commitChange(
            'batch',
            `batch:${jobId}`,
            { actor: String(job.userId), action: job.operation, subjectLabel: null },
            { inverse: { op: 'undo-batch', operation: job.operation, jobId }, items },
            async () => null
          );
          undo = { actionId: committed.id };
        } catch (journalError) {
          console.error(
            `[batchOperationService] journal commit failed for batch job ${jobId}:`,
            journalError && journalError.message
          );
        }
      }
    }

    opStore.updateJob(jobId, {
      status: result.cancelled ? 'cancelled' : 'completed',
      progress: result[countKey] || 0,
      total: job.total,
      // Per-node results: succeeded entries first (client contract for the
      // bulk completion message + trash-icon animation), then failed/skipped.
      results: [
        ...publicSucceededEntries(job.operation, result.succeeded),
        ...(result.errors || []),
      ],
      undo,
    });
  } catch (error) {
    opStore.updateJob(jobId, { status: 'failed', errorMessage: error.message });
  }
}

/**
 * Schedule a bulk job for asynchronous processing.
 * @param {string} jobId — the job identifier returned by createJob
 */
function scheduleBulkWorker(jobId) {
  // WEA_SKIP_BULK_WORKER is T2 (test seam): read lazily at scheduling time.
  if (getSharedResolver().getConfigSync('WEA_SKIP_BULK_WORKER') === '1') {
    return;
  }
  setImmediate(() => {
    _processBulkJob(jobId).catch((err) => {
      console.error(`[batchOperationService] Unhandled error in bulk worker ${jobId}:`, err);
    });
  });
}

/**
 * Factory: nodeId-based batch operation service.
 * Delegates individual operations to fileService with async permission gates via aclService.
 *
 * @param {Object} deps
 * @param {Object} deps.fileNodeService — tree operations (getNode reads for the journal
 *   capture, getDescendantIds, etc.)
 * @param {Object} deps.fileService — individual file operations (deleteNode, moveNode, copyFile)
 * @param {Object} deps.aclService — async permission checks + isAdminUser gate
 */
function createBatchOperationService({ fileNodeService, fileService, aclService }) {
  /**
   * Batch delete: remove nodes and all descendants.
   * @param {number[]} nodeIds — array of nodeId values to delete
   * @param {string} userId — principal performing the operation
   * @param {Object} [user] — req.user for admin bypass in fileService
   * @param {{isCancelled?: () => boolean}} [options] — per-item cancellation gate
   * @returns {{ deletedCount: number, succeeded: number[], errors: Array, cancelled: boolean }}
   */
  async function batchDelete(nodeIds, userId, user, options = {}) {
    const isCancelled =
      options && typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

    if (!nodeIds || nodeIds.length === 0) {
      return { deletedCount: 0, succeeded: [], errors: [], cancelled: false };
    }

    const errors = [];
    const succeeded = [];
    let deletedCount = 0;
    let cancelled = false;

    for (let index = 0; index < nodeIds.length; index++) {
      if (isCancelled()) {
        cancelled = true;
        for (let rest = index; rest < nodeIds.length; rest++) {
          errors.push({ nodeId: nodeIds[rest], status: 'skipped', reason: 'cancelled' });
        }
        break;
      }

      const nodeId = nodeIds[index];
      try {
        if (!user || !aclService.isAdminUser(user)) {
          const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
          if (!canWrite) {
            errors.push({ nodeId, status: 'skipped', reason: 'permission_denied' });
            continue;
          }
        }

        await fileService.deleteNode(nodeId, userId, user);
        deletedCount++;
        // DEF-16 P9: report per-node succeeded results — the client's bulk
        // completion contract (`useBulkOperations` results filter) drives the
        // pinned trash-icon animation and tree refresh off these entries.
        succeeded.push(nodeId);
      } catch (err) {
        errors.push({ nodeId, status: 'failed', reason: err.message || 'unknown_error' });
      }
    }

    return { deletedCount, succeeded, errors, cancelled };
  }

  /**
   * Batch move: relocate nodes to new parents.
   * @param {{sourceNodeId: number, destinationParentNodeId: number}[]} moves
   * @param {string} userId
   * @param {Object} [user]
   * @param {{isCancelled?: () => boolean}} [options] — per-item cancellation gate
   * @returns {{ movedCount: number, succeeded: Array, errors: Array, cancelled: boolean }}
   */
  async function batchMove(moves, userId, user, options = {}) {
    const isCancelled =
      options && typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

    if (!moves || moves.length === 0) {
      return { movedCount: 0, succeeded: [], errors: [], cancelled: false };
    }

    const errors = [];
    const succeeded = [];
    let movedCount = 0;
    let cancelled = false;

    for (let index = 0; index < moves.length; index++) {
      if (isCancelled()) {
        cancelled = true;
        for (let rest = index; rest < moves.length; rest++) {
          errors.push({
            sourceNodeId: moves[rest].sourceNodeId,
            destinationParentNodeId: moves[rest].destinationParentNodeId,
            status: 'skipped',
            reason: 'cancelled',
          });
        }
        break;
      }

      const move = moves[index];
      const { sourceNodeId, destinationParentNodeId } = move;
      try {
        if (!user || !aclService.isAdminUser(user)) {
          const canWriteSource = await aclService.checkFilePermission(
            userId,
            sourceNodeId,
            PERMISSIONS.WRITE
          );
          const canWriteDest = await aclService.checkFolderPermission(
            userId,
            destinationParentNodeId,
            PERMISSIONS.WRITE
          );

          if (!canWriteSource || !canWriteDest) {
            errors.push({
              sourceNodeId,
              destinationParentNodeId,
              status: 'skipped',
              reason: 'permission_denied',
            });
            continue;
          }
        }

        // Journal capture (§5.4): the pre-move parent is read BEFORE the item
        // moves — it is the undo target. A lost read leaves the capture
        // undefined (the item is journaled out of the command row, never in).
        const sourceNode = await fileNodeService.getNode(sourceNodeId);
        const previousParentNodeId = sourceNode ? normalizeParent(sourceNode.parentId) : undefined;

        await fileService.moveNode(sourceNodeId, destinationParentNodeId, userId, user);
        movedCount++;
        succeeded.push({ sourceNodeId, destinationParentNodeId, previousParentNodeId });
      } catch (err) {
        errors.push({
          sourceNodeId,
          destinationParentNodeId,
          status: 'failed',
          reason: err.message || 'unknown_error',
        });
      }
    }

    return { movedCount, succeeded, errors, cancelled };
  }

  /**
   * Batch copy: duplicate nodes to new locations.
   * @param {{sourceNodeId: number, destinationParentNodeId: number}[]} copies
   * @param {string} userId
   * @param {Object} [user]
   * @param {{isCancelled?: () => boolean}} [options] — per-item cancellation gate
   * @returns {{ copiedCount: number, succeeded: Array, errors: Array, cancelled: boolean }}
   */
  async function batchCopy(copies, userId, user, options = {}) {
    const isCancelled =
      options && typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

    if (!copies || copies.length === 0) {
      return { copiedCount: 0, succeeded: [], errors: [], cancelled: false };
    }

    const errors = [];
    const succeeded = [];
    let copiedCount = 0;
    let cancelled = false;

    for (let index = 0; index < copies.length; index++) {
      if (isCancelled()) {
        cancelled = true;
        for (let rest = index; rest < copies.length; rest++) {
          errors.push({
            sourceNodeId: copies[rest].sourceNodeId,
            destinationParentNodeId: copies[rest].destinationParentNodeId,
            status: 'skipped',
            reason: 'cancelled',
          });
        }
        break;
      }

      const copy = copies[index];
      const { sourceNodeId, destinationParentNodeId, newName } = copy;
      try {
        if (!user || !aclService.isAdminUser(user)) {
          const canReadSource = await aclService.checkFilePermission(
            userId,
            sourceNodeId,
            PERMISSIONS.READ
          );
          const canWriteDest = await aclService.checkFolderPermission(
            userId,
            destinationParentNodeId,
            PERMISSIONS.WRITE
          );

          if (!canReadSource || !canWriteDest) {
            errors.push({
              sourceNodeId,
              destinationParentNodeId,
              status: 'skipped',
              reason: 'permission_denied',
            });
            continue;
          }
        }

        // Journal capture (§5.4): the created node's id rides the copyFile
        // return; its name is read back for the undo fingerprint (a renamed
        // copy is state-changed ⇒ skipped at undo).
        const copyResult = await fileService.copyFile(
          sourceNodeId,
          destinationParentNodeId,
          newName || null,
          userId,
          user
        );
        copiedCount++;

        const copiedNodeId =
          copyResult && copyResult.copiedNodeId != null ? Number(copyResult.copiedNodeId) : null;
        let name = null;
        if (copiedNodeId != null) {
          try {
            const createdNode = await fileNodeService.getNode(copiedNodeId);
            name = createdNode ? createdNode.name : null;
          } catch (_) {
            /* best-effort — a lost read journals the item out (§5.4 capture rule) */
          }
        }
        succeeded.push({ sourceNodeId, destinationParentNodeId, copiedNodeId, name });
      } catch (err) {
        errors.push({
          sourceNodeId,
          destinationParentNodeId,
          status: 'failed',
          reason: err.message || 'unknown_error',
        });
      }
    }

    return { copiedCount, succeeded, errors, cancelled };
  }

  return { batchDelete, batchMove, batchCopy };
}

/* ------------------------------------------------------------------ */
/*  Batch-domain undo executor (batchOperationService.md §5.5)         */
/* ------------------------------------------------------------------ */

/**
 * FileNodeRepository bound to the journal undo transaction client: the
 * closure-table writes commit atomically with the `status='undone'` flip on
 * BOTH dialects (sqlite joins the active BEGIN; PostgreSQL runs on the tx's
 * pool client). Service methods that open their own transaction
 * (`fileNodeService`) must never run inside the undo tx — the serialized
 * sqlite tx queue would self-deadlock — which is exactly why the executor
 * re-binds the repository instead.
 */
function createTxBoundFileNodeRepository(tx) {
  const dialect = storage.getExecutor().dialect;
  const txClient = {
    dialect,
    query: (sql, params = []) => tx.query(sql, params || []),
    run: async (sql, params = []) => {
      const res = await tx.run(sql, params || []);
      return {
        changes: res && res.changes != null ? Number(res.changes) : 0,
        lastId: res ? (res.lastId ?? res.lastID ?? null) : null,
      };
    },
  };
  return createFileNodeRepository(txClient);
}

/** Display path from the closure chain — mirrors `fileNodeService.getNodePath`. */
async function displayPathOfTxNode(repo, nodeId) {
  const chain = await repo.getAncestorChain(nodeId);
  const pathParts = [];
  for (const entry of chain) {
    // eslint-disable-next-line no-await-in-loop
    const node = await repo.getNodeIncludingTrashed(entry.ancestorId);
    if (node) pathParts.push(node.name);
  }
  return '/' + pathParts.join('/');
}

/**
 * Apply ONE item inverse of a batch command row, fingerprint-guarded.
 * Skip semantics are reserved for state-change (`reason: 'changed'`); any
 * application failure THROWs, aborting the whole undo tx so nothing
 * half-applies and the row stays `applied` (retryable) — store §2.6.
 */
async function applyBatchItemInverse({ repo, ancestry, item, row, composition }) {
  const inverse = item && item.inverse;
  if (!inverse || typeof inverse.op !== 'string' || item.nodeId == null) {
    return { applied: false, reason: 'changed' };
  }
  const fingerprint = item.fingerprint || {};

  // eslint-disable-next-line no-await-in-loop
  const node = await repo.getNode(item.nodeId);
  if (!node) return { applied: false, reason: 'changed' };
  if (normalizeParent(node.parentId) !== normalizeParent(fingerprint.parentId)) {
    return { applied: false, reason: 'changed' };
  }

  if (inverse.op === 'move-back') {
    const restoreParentId = normalizeParent(inverse.parentId);
    // eslint-disable-next-line no-await-in-loop
    const descendants = await repo.getDescendantIds(item.nodeId);
    if (restoreParentId !== null && descendants.map((id) => Number(id)).includes(restoreParentId)) {
      // the pre-move parent moved underneath the node since — state changed
      return { applied: false, reason: 'changed' };
    }

    const isWebdav = composition.fileStorageMode === 'webdav' && composition.blobStore;
    const batchedPath = isWebdav
      ? // eslint-disable-next-line no-await-in-loop
        await displayPathOfTxNode(repo, item.nodeId)
      : null;

    // eslint-disable-next-line no-await-in-loop
    await repo.moveNode(item.nodeId, restoreParentId);
    // eslint-disable-next-line no-await-in-loop
    await ancestry.rebuildAncestorsAfterMove(item.nodeId, restoreParentId);

    if (isWebdav) {
      // eslint-disable-next-line no-await-in-loop
      const restoredPath = await displayPathOfTxNode(repo, item.nodeId);
      try {
        // eslint-disable-next-line no-await-in-loop
        await composition.blobStore.moveBlob(batchedPath, restoredPath);
      } catch (error) {
        if (error && error.errorCode === SERVER_ERROR_CODES.webdav.sourceNotFound) {
          // Already an orphan — nothing to move; the DB restore stands and the
          // marker stays (fileService.moveNode policy, exception (a)).
          // eslint-disable-next-line no-await-in-loop
          await repo.updateSyncStatus(item.nodeId, 'orphaned_node');
        } else {
          // Abort the whole undo pass: the tx rollback restores the DB side,
          // the remote side never moved, the row stays `applied` for retry.
          throw error;
        }
      }
    }
    return { applied: true };
  }

  if (inverse.op === 'trash-node') {
    if (fingerprint.name != null && node.name !== fingerprint.name) {
      return { applied: false, reason: 'changed' };
    }
    const actor = row.actor;
    const actorUserId = Number.isFinite(Number(actor)) ? Number(actor) : actor;
    // eslint-disable-next-line no-await-in-loop
    const user = await composition.aclService.getCachedUser(actorUserId);
    if (!user) {
      throw createError(SERVER_ERROR_CODES.auth.userNotFound, 409);
    }
    // The forward delete channel owns trash semantics (soft mark + WebDAV
    // remote MOVE + destination-exists guard). Storage/permission failures
    // THROW — aborting the undo pass keeps the row retryable.
    // eslint-disable-next-line no-await-in-loop
    await composition.fileService.deleteNode(item.nodeId, actorUserId, user);
    return { applied: true };
  }

  // unknown inverse (version skew) — state changed, never applied
  return { applied: false, reason: 'changed' };
}

/**
 * Undo executor for the `batch` domain: applies `payload.items`
 * fingerprint-guarded, one outcome per item — mixed results allowed
 * (`store/actionJournalStore.md` §2.4).
 */
async function applyBatchUndoExecutor({ row, tx }) {
  const payload = row.payload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) return [];

  const { getComposition } = require('../../../service/composition');
  const composition = getComposition();
  const repo = createTxBoundFileNodeRepository(tx);
  const ancestry = createAncestryHelper(repo);

  const outcomes = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await applyBatchItemInverse({ repo, ancestry, item, row, composition }));
  }
  return outcomes;
}

actionJournalStore.registerUndoExecutor('batch', applyBatchUndoExecutor);

module.exports = { createBatchOperationService, scheduleBulkWorker };
