'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { createOperationProgressStore } = require('../stores/operationProgress');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

/**
 * Async worker that processes a bulk job from the operation progress store.
 * Reads the job, dispatches to the appropriate batch method, and updates progress.
 */
async function _processBulkJob(jobId) {
  const opStore = createOperationProgressStore();
  const job = opStore.getJob(jobId);
  if (!job) return;

  const { getComposition } = require('../../../service/composition');
  const { batchOperationService: batchOp } = getComposition();

  try {
    opStore.updateJob(jobId, { status: 'running', progress: 0 });

    let result;
    switch (job.operation) {
      case 'delete': {
        result = await batchOp.batchDelete(job.payload.nodeIds, job.userId);
        break;
      }
      case 'move': {
        result = await batchOp.batchMove(job.payload.moves, job.userId, { is_admin: true });
        break;
      }
      case 'copy': {
        result = await batchOp.batchCopy(job.payload.copies, job.userId, { is_admin: true });
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

    opStore.updateJob(jobId, {
      status: 'completed',
      progress: result[countKey] || 0,
      total: job.total,
      results: result.errors || [],
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
 * @param {Object} deps.fileNodeService — tree operations (getDescendantIds, etc.)
 * @param {Object} deps.fileService — individual file operations (deleteNode, moveNode, copyFile)
 * @param {Object} deps.aclService — async permission checks + isAdminUser gate
 */
function createBatchOperationService({ fileNodeService, fileService, aclService }) {
  // eslint-disable-next-line no-unused-vars
  const _fn = fileNodeService;

  /**
   * Batch delete: remove nodes and all descendants.
   * @param {number[]} nodeIds — array of nodeId values to delete
   * @param {string} userId — principal performing the operation
   * @param {Object} [user] — req.user for admin bypass in fileService
   * @returns {{ deletedCount: number, errors: Array }}
   */
  async function batchDelete(nodeIds, userId, user) {
    if (!nodeIds || nodeIds.length === 0) {
      return { deletedCount: 0, errors: [] };
    }

    const errors = [];
    let deletedCount = 0;

    for (const nodeId of nodeIds) {
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
      } catch (err) {
        errors.push({ nodeId, status: 'failed', reason: err.message || 'unknown_error' });
      }
    }

    return { deletedCount, errors };
  }

  /**
   * Batch move: relocate nodes to new parents.
   * @param {{sourceNodeId: number, destinationParentNodeId: number}[]} moves
   * @param {string} userId
   * @param {Object} [user]
   * @returns {{ movedCount: number, errors: Array }}
   */
  async function batchMove(moves, userId, user) {
    if (!moves || moves.length === 0) {
      return { movedCount: 0, errors: [] };
    }

    const errors = [];
    let movedCount = 0;

    for (const move of moves) {
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

        await fileService.moveNode(sourceNodeId, destinationParentNodeId, userId, user);
        movedCount++;
      } catch (err) {
        errors.push({
          sourceNodeId,
          destinationParentNodeId,
          status: 'failed',
          reason: err.message || 'unknown_error',
        });
      }
    }

    return { movedCount, errors };
  }

  /**
   * Batch copy: duplicate nodes to new locations.
   * @param {{sourceNodeId: number, destinationParentNodeId: number}[]} copies
   * @param {string} userId
   * @param {Object} [user]
   * @returns {{ copiedCount: number, errors: Array }}
   */
  async function batchCopy(copies, userId, user) {
    if (!copies || copies.length === 0) {
      return { copiedCount: 0, errors: [] };
    }

    const errors = [];
    let copiedCount = 0;

    for (const copy of copies) {
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

        await fileService.copyFile(
          sourceNodeId,
          destinationParentNodeId,
          newName || null,
          userId,
          user
        );
        copiedCount++;
      } catch (err) {
        errors.push({
          sourceNodeId,
          destinationParentNodeId,
          status: 'failed',
          reason: err.message || 'unknown_error',
        });
      }
    }

    return { copiedCount, errors };
  }

  return { batchDelete, batchMove, batchCopy };
}

module.exports = { createBatchOperationService, scheduleBulkWorker };
