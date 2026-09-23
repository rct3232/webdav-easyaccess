'use strict';

/**
 * fileLikesService — business logic behind /api/file-likes
 * (docs/spec/server/routes/fileLikes.md). Thin domain layer over the
 * fileLikesStore facade: per-viewer readability gate (404 masquerade), the
 * idempotent set, and the §3.4 `like` usage signal at the commit point
 * (register (a)). Bare string codes are translated by the route ERROR_MAP;
 * no journal, no locks — a like is self-reversing trivial state (§4.11).
 */

const fileLikesStore = require('../../store/fileLikesStore');
const aclService = require('../../domains/permissions/services/aclService');
const { isOwnerNode } = require('../../domains/permissions/policy/ownerNodeResolver');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const usageService = require('../../infrastructure/usageService');

function serviceError(code) {
  const error = new Error(code);
  if (code === 'notFound') error.status = 404;
  return error;
}

async function canReadNode(userId, nodeId) {
  if (await isOwnerNode(userId, nodeId)) return true;
  return aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
}

async function listLikedNodeIds(userId) {
  return fileLikesStore.listLikedNodeIds(userId);
}

/**
 * Explicit set for one (viewer, node) pair. Unknown or unreadable targets
 * 404-masquerade (liking must not disclose node existence). A NEW like
 * (store actually inserted a row) records the `like` usage signal after the
 * commit point; recording errors are logged, never fail the toggle (§3.4).
 */
async function setLiked(userId, nodeId, liked) {
  if (!(await canReadNode(userId, nodeId))) throw serviceError('notFound');

  const { changes } = await fileLikesStore.setLiked(userId, nodeId, liked);

  if (liked && changes === 1) {
    try {
      await usageService.getUsageService().recordEvent({ userId, nodeId, action: 'like' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('fileLikesService: like usage recording failed:', error);
    }
  }
  return { nodeId, liked };
}

module.exports = { listLikedNodeIds, setLiked };
