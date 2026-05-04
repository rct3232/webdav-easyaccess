const express = require('express');
const router = express.Router();

const {
  PERMISSIONS,
  HTTP_STATUS,
  PERMISSION_REQUEST_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../utils/auth');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../store/metaPaths');
const { asyncHandler, createError, validationError } = require('../utils/errorHandler');

const User = require('../models/User');
const PermissionRequest = require('../models/PermissionRequest');

function extractOwnerUsername(path) {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  return parts[0] || null;
}

function normalizePermission(p) {
  return p === PERMISSIONS.READ || p === PERMISSIONS.WRITE ? p : null;
}

function normalizeStatus(s) {
  return PERMISSION_REQUEST_STATUS.isValid(s) ? s : null;
}

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const { folderPath, filePath, permission, message } = req.body || {};

  const hasFolder = typeof folderPath === 'string' && folderPath.trim() !== '';
  const hasFile = typeof filePath === 'string' && filePath.trim() !== '';
  if ((!hasFolder && !hasFile) || !permission) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired);
  }
  const targetPath = hasFile ? filePath : folderPath;
  if (isMetaPath(targetPath)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.accessDenied, HTTP_STATUS.FORBIDDEN);
  }

  const perm = normalizePermission(permission);
  if (!perm) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }

  const requester = await User.findById(req.user.id);
  if (!requester) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.userNotFound, HTTP_STATUS.FORBIDDEN);
  }

  const normalizedPath = normalizePath(targetPath);
  const ownerUsername = extractOwnerUsername(normalizedPath);
  if (!ownerUsername) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPathOwner);
  }

  const owner = await User.findByUsername(ownerUsername);
  if (!owner) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.ownerNotFound);
  }

  if (Number(owner.id) === Number(requester.id)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.ownPath);
  }

  const createPayload = {
    requesterId: requester.id,
    requesterUsername: requester.username,
    ownerId: owner.id,
    ownerUsername: owner.username,
    requestedPermission: perm,
    message: typeof message === 'string' ? message : '',
  };
  if (hasFile) {
    createPayload.filePath = normalizedPath;
  } else {
    createPayload.folderPath = normalizedPath;
  }

  const created = await PermissionRequest.create(createPayload);

  res.json(created);
}));

router.get('/inbox', authenticateToken, asyncHandler(async (req, res) => {
  const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
  const list = await PermissionRequest.listInbox(req.user.id, status ? { status } : undefined);
  res.json(list);
}));

router.get('/outbox', authenticateToken, asyncHandler(async (req, res) => {
  const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
  const list = await PermissionRequest.listOutbox(req.user.id, status ? { status } : undefined);
  res.json(list);
}));

router.get('/check-owner', authenticateToken, asyncHandler(async (req, res) => {
  const { folderPath, filePath } = req.query;
  const pathToCheck = filePath || folderPath;

  if (!pathToCheck) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.pathRequired);
  }

  if (isMetaPath(pathToCheck)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.accessDenied, HTTP_STATUS.FORBIDDEN);
  }

  const normalizedPath = normalizePath(pathToCheck);
  const ownerUsername = extractOwnerUsername(normalizedPath);

  if (!ownerUsername) {
    return res.json({ ownerExists: false, ownerUsername: null });
  }

  const owner = await User.findByUsername(ownerUsername);
  const ownerExists = Boolean(owner);

  res.json({ ownerExists, ownerUsername: ownerExists ? ownerUsername : null });
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

  // Note: Permission granting is handled by the client in review mode.
  // The client calls /api/permissions/grant before calling this approve endpoint.
  // We only update the request status here.

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

module.exports = router;

