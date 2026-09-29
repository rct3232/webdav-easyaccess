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
const { createFileNodesStore } = require('../../store/fileNodesStore');
const aclService = require('../../domains/permissions/services/aclService');
const { isOwnerNode } = require('../../domains/permissions/policy/ownerNodeResolver');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const usageService = require('../../infrastructure/usageService');
const wire = require('./wire');

// Members-parity paging caps (collections service.js DEFAULT_ITEM_LIMIT/MAX_ITEM_LIMIT).
const DEFAULT_ITEM_LIMIT = 50;
const MAX_ITEM_LIMIT = 200;

function clampLimit(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ITEM_LIMIT;
  return Math.min(Math.floor(parsed), MAX_ITEM_LIMIT);
}

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

/**
 * P-5 liked-items listing (`GET /api/file-likes/items`, fileLikes.md §2.4.2).
 * The store read yields `node_id` asc (no liked-at stamp exists); each id is
 * classified against CURRENT node state (likes survive trash/permission loss),
 * mirroring collections `resolveMemberRows`: trashed/purged (`getNode` null) →
 * HIDDEN (the like row stays, member parity); readable → `normal` row with
 * name/type/mime; since-unreadable → `revoked` placeholder with all three
 * nulled (never disclose a name the viewer can no longer read). Cursor-paged in
 * memory over the classified rows exactly like members `getItems` (score is
 * always 0 → the keyset is the `node_id` itself).
 */
async function listLikedItems(userId, { cursor, limit } = {}) {
  const fileNodesStore = createFileNodesStore();
  const likedIds = await fileLikesStore.listLikedNodeIds(userId);

  const rows = [];
  for (const nodeId of likedIds) {
    const node = await fileNodesStore.getNode(nodeId);
    if (!node) continue; // trashed → hidden (row kept); purged rows cascade away
    const readable = await canReadNode(userId, nodeId);
    rows.push({
      nodeId,
      state: readable ? 'normal' : 'revoked',
      name: readable ? node.name : null,
      type: readable ? node.type : null,
      mimeType: readable ? (node.mimeType ?? null) : null,
      createdAt: readable ? (node.createdAt ?? null) : null,
      liked: true,
    });
  }

  const parsedCursor = wire.decodeCursor(cursor);
  const filtered = parsedCursor ? rows.filter((row) => row.nodeId > parsedCursor.nodeId) : rows;

  const parsedLimit = clampLimit(limit);
  const page = filtered.slice(0, parsedLimit);
  const lastRow = page[page.length - 1];
  const hasMore = filtered.length > parsedLimit;

  return {
    items: page,
    // next_cursor = the LAST RETURNED node_id (keyset; fileLikes.md §2.4.2) —
    // the next page filters `nodeId > cursor`, so this is gap-free and
    // duplicate-free. (The score slot stays 0: node_id is the whole key.)
    nextCursor: hasMore && lastRow ? wire.encodeCursor({ score: 0, nodeId: lastRow.nodeId }) : null,
  };
}

module.exports = { listLikedNodeIds, listLikedItems, setLiked };
