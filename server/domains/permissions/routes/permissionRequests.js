const express = require('express');
const router = express.Router();

const {
  PERMISSIONS,
  HTTP_STATUS,
  PERMISSION_REQUEST_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const User = require('../../../models/User');
const PermissionRequest = require('../../../models/PermissionRequest');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const permissionStore = require('../stores/permissionStore');
const { getComposition } = require('../../../service/composition');
const { asyncHandler, createError, validationError } = require('../../../utils/errorHandler');

const fileNodesStore = createFileNodesStore();

function normalizePermission(p) {
  return p === PERMISSIONS.READ || p === PERMISSIONS.WRITE ? p : null;
}

async function enrichPermissionRequest(row) {
  if (!row) return row;
  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(row.file_node_id);
  if (!node) {
    return { ...row, display_path: null, target_name: null };
  }
  const displayPath = await fileNodeService.getNodePath(node.id);
  return {
    ...row,
    display_path: displayPath,
    target_name: node.name,
  };
}

function normalizeStatus(s) {
  return PERMISSION_REQUEST_STATUS.isValid(s) ? s : null;
}

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const { nodeId, fileNodeId, permission, message } = req.body || {};

  // Accept either nodeId (directory) or fileNodeId (file-level request)
  const targetNodeId = nodeId || fileNodeId;
  if (!targetNodeId && !Number.isFinite(nodeId)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired);
  }

  const perm = normalizePermission(permission);
  if (!perm) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }

  // Validate node exists
  const targetNode = await fileNodesStore.getNode(targetNodeId);
  if (!targetNode) {
    throw createError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound, HTTP_STATUS.NOT_FOUND);
  }

  const requester = await User.findById(req.user.id);
  if (!requester) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.userNotFound, HTTP_STATUS.FORBIDDEN);
  }

  // Resolve owner from node ancestry: find the first ancestor that's a user root
  const ownerInfo = await resolveNodeOwner(targetNodeId);
  if (!ownerInfo) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPathOwner);
  }

  if (Number(ownerInfo.id) === Number(requester.id)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.ownPath);
  }

  const createPayload = {
    requesterId: requester.id,
    requesterUsername: requester.username,
    ownerId: ownerInfo.id,
    ownerUsername: ownerInfo.username,
    requestedPermission: perm,
    message: typeof message === 'string' ? message : '',
  };

  // Store nodeId reference instead of path string
  createPayload.nodeId = targetNodeId;
  createPayload.fileNodeId = targetNodeId;

  const created = await PermissionRequest.create(createPayload);

  res.json(await enrichPermissionRequest(created));
}));

router.get('/inbox', authenticateToken, asyncHandler(async (req, res) => {
  const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
  const list = await PermissionRequest.listInbox(req.user.id, status ? { status } : undefined);
  res.json(await Promise.all(list.map(enrichPermissionRequest)));
}));

router.get('/outbox', authenticateToken, asyncHandler(async (req, res) => {
  const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
  const list = await PermissionRequest.listOutbox(req.user.id, status ? { status } : undefined);
  res.json(await Promise.all(list.map(enrichPermissionRequest)));
}));

router.get('/check-owner', authenticateToken, asyncHandler(async (req, res) => {
  const nodeId = req.query.nodeId || req.query.folderNodeId || req.query.fileNodeId;

  if (!nodeId && nodeId !== 0) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.pathRequired);
  }

  const node = await fileNodesStore.getNode(nodeId);
  if (!node) {
    return res.json({ ownerExists: false, ownerUsername: null });
  }

  const ownerInfo = await resolveNodeOwner(nodeId);
  const ownerExists = Boolean(ownerInfo);

  res.json({ ownerExists, ownerUsername: ownerExists ? ownerInfo.username : null });
}));

router.post('/:id/approve', authenticateToken, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidRequestId);
  }

  const pr = await PermissionRequest.findById(id);
  if (!pr) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (pr.owner_id !== req.user.id) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.accessDenied, HTTP_STATUS.FORBIDDEN);
  }
  if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove);
  }

  const targetNode = await fileNodesStore.getNode(pr.file_node_id);
  if (!targetNode) {
    throw createError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (targetNode.type === 'file') {
    await permissionStore.grantFilePermission(pr.requester_id, pr.file_node_id, pr.requested_permission);
  } else {
    await permissionStore.grant(pr.requester_id, pr.file_node_id, pr.requested_permission);
  }

  const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.APPROVED, resolvedBy: req.user.id });
  res.json(updated);
}));

router.post('/:id/reject', authenticateToken, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidRequestId);
  }

  const pr = await PermissionRequest.findById(id);
  if (!pr) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (pr.owner_id !== req.user.id) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.accessDenied, HTTP_STATUS.FORBIDDEN);
  }
  if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove);
  }

  const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.REJECTED, resolvedBy: req.user.id });
  res.json(updated);
}));

router.post('/:id/cancel', authenticateToken, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidRequestId);
  }

  const pr = await PermissionRequest.findById(id);
  if (!pr) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (pr.requester_id !== req.user.id) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.accessDenied, HTTP_STATUS.FORBIDDEN);
  }
  if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove);
  }

  const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.CANCELLED, resolvedBy: req.user.id });
  res.json(updated);
}));

/**
 * Resolve the owner of a node by walking up ancestors to find a user root directory.
 */
async function resolveNodeOwner(targetNodeId) {
  const ancestorChain = await fileNodesStore.getAncestorChain(targetNodeId);
  if (!ancestorChain || ancestorChain.length === 0) return null;

  // Walk from deepest (furthest ancestor, the root-level node) to closest
  for (const entry of ancestorChain) {
    const ancestorNode = await fileNodesStore.getNode(entry.ancestorId);
    if (!ancestorNode) continue;
    if (ancestorNode.parentId == null) {
      // This is a top-level directory — find user whose username matches the name
      const owner = await User.findByUsername(ancestorNode.name);
      return owner ? { id: owner.id, username: owner.username } : null;
    }
  }

  return null;
}

module.exports = router;
