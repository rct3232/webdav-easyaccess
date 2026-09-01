'use strict';
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const User = require('../../../models/User');
const permissionStore = require('../../../store/permissionStore');

async function cleanupOrphanedData() {
  const results = {
    errors: [],
    gc: null,
    orphanedNodes: [],
  };

  // 1. Run one GC cycle for orphaned blobs (S3 mode; no-op in WebDAV mode)
  {
    try {
      const { getComposition } = require('../../../service/composition');
      const { gcService } = getComposition();
      results.gc = await gcService.runGcCycle();
    } catch (error) {
      results.errors.push(`Failed to run garbage collection: ${error.message}`);
    }
  }

  // 2. Report nodes stuck in sync_status='orphaned_node' for manual review
  {
    try {
      const { getComposition } = require('../../../service/composition');
      const { failSafeService } = getComposition();
      results.orphanedNodes = await failSafeService.scanOrphanedNodes();
    } catch (error) {
      results.errors.push(`Failed to scan orphaned nodes: ${error.message}`);
    }
  }

  return results;
}

/**
 * Ensure every user has admin on their home directory node.
 * With the closure table, granting admin on the home node covers all
 * descendants, so a single grant per user replaces the previous
 * path-walk grant/upgrade loop (which was a silent no-op: permissionStore
 * requires nodeIds and rejected path strings).
 * @returns {{ updatedUsers: number, upgradedPaths: number, grantedPaths: number, errors: string[] }}
 */
async function ensureHomeOwnerAdminForAllUsers() {
  const result = {
    updatedUsers: 0,
    upgradedPaths: 0,
    grantedPaths: 0,
    removedSelfGrants: 0,
    errors: [],
  };

  let users = [];
  try {
    users = await User.findAll();
  } catch (err) {
    result.errors.push(`Failed to load users: ${err.message}`);
    return result;
  }

  const { createFileNodesStore } = require('../../../store/fileNodesStore');
  const { createFileNodeService } = require('../../../service/fileNodeService');
  const fileNodesStore = createFileNodesStore();
  const fileNodeService = createFileNodeService({ fileNodesStore });

  // WebDAV blob-storage mode: the physical home directory must also exist on
  // the WebDAV server for uploads to succeed. No-op in S3 mode.
  const { getComposition } = require('../../../service/composition');
  const { blobStorageService } = getComposition();

  const nonAdminUsers = users.filter((u) => !u.is_admin);
  const userSet = new Set();

  for (const user of nonAdminUsers) {
    if (!user.id || !user.username) continue;

    try {
      // Resolve the user's home node (create when missing).
      let homeNode = await fileNodeService.resolvePath(`/${user.username}`);
      if (!homeNode) {
        homeNode = await fileNodeService.createDirectory(null, user.username);
      }
      if (!homeNode) {
        result.errors.push(`Create home node for ${user.username}`);
        continue;
      }
      if (homeNode) {
        await blobStorageService.createDirectoryWebdav(Number(homeNode.id));
      }

      const hasAdmin = await permissionStore.checkPermission(
        user.id,
        homeNode.id,
        PERMISSIONS.ADMIN
      );
      if (!hasAdmin) {
        await permissionStore.grant(user.id, homeNode.id, PERMISSIONS.ADMIN);
        result.grantedPaths += 1;
        userSet.add(user.id);
      }

      // Remove redundant self-grants the user holds on their own subtree
      // (depth > 0). The home-root ADMIN grant (depth 0) is preserved.
      const removed = await permissionStore.removeOwnSubtreePermissions(user.id, homeNode.id);
      result.removedSelfGrants += removed.removedPaths + removed.removedFiles;
    } catch (err) {
      result.errors.push(`User ${user.username}: ${err.message}`);
    }
  }

  result.updatedUsers = userSet.size;
  return result;
}

module.exports = { cleanupOrphanedData, ensureHomeOwnerAdminForAllUsers };
