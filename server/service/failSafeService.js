'use strict';

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../utils/errorHandler');

const REPAIR_ACTIONS = ['retry-delete', 'force-active'];

/**
 * Factory: create a fail-safe recovery service for nodes stuck in
 * sync_status='orphaned_node'.
 *
 * @param {Object} opts
 * @param {Object} opts.fileNodeService - fileNodeService (getNode, getNodePath,
 *   deleteNode, updateSyncStatus).
 * @param {Object} opts.fileNodesStore - fileNodesStore with getNodesBySyncStatus.
 */
function createFailSafeService({ fileNodeService, fileNodesStore }) {
  /**
   * Scan for nodes stuck in sync_status='orphaned_node'.
   * @returns {Promise<Array<{ nodeId: number, name: string, type: string, path: string, createdAt: *, updatedAt: * }>>}
   */
  async function scanOrphanedNodes() {
    const nodes = await fileNodesStore.getNodesBySyncStatus('orphaned_node');
    const result = [];
    for (const node of nodes) {
      let path = null;
      try {
        path = await fileNodeService.getNodePath(node.id);
      } catch (error) {
        path = null;
      }
      result.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        path,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
    }
    return result;
  }

  /**
   * Manually resolve one orphaned node.
   * @param {number} nodeId - file_nodes.id.
   * @param {Object} opts
   * @param {'retry-delete'|'force-active'} opts.action
   * @returns {Promise<{ nodeId: number, action: string, status: string, path: string|null, detail: string }>}
   */
  async function repairNode(nodeId, { action }) {
    if (!REPAIR_ACTIONS.includes(action)) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncInvalidAction, 400, {
        action: String(action),
      });
    }

    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncNodeNotFound, 404, {
        nodeId: Number(nodeId),
      });
    }

    let path = null;
    try {
      path = await fileNodeService.getNodePath(nodeId);
    } catch (error) {
      path = null;
    }

    if (action === 'retry-delete') {
      await fileNodeService.deleteNode(nodeId);
      return {
        nodeId: node.id,
        action,
        status: 'resolved',
        path,
        detail: 'node deleted',
      };
    }

    await fileNodeService.updateSyncStatus(nodeId, 'active');
    return {
      nodeId: node.id,
      action,
      status: 'resolved',
      path,
      detail: 'sync_status set to active',
    };
  }

  /**
   * Startup hook: scan orphaned nodes and report them for manual review.
   * Never performs destructive actions automatically.
   * @returns {Promise<{ scanned: number, resolved: number, manualReview: Array<{ nodeId: number, path: string|null }> }>}
   */
  async function runStartupRecovery() {
    const nodes = await scanOrphanedNodes();
    return {
      scanned: nodes.length,
      resolved: 0,
      manualReview: nodes.map((n) => ({ nodeId: n.nodeId, path: n.path })),
    };
  }

  return { scanOrphanedNodes, repairNode, runStartupRecovery };
}

module.exports = { createFailSafeService };
