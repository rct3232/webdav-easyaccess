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

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { folderPath, filePath, permission, message } = req.body || {};

    const hasFolder = typeof folderPath === 'string' && folderPath.trim() !== '';
    const hasFile = typeof filePath === 'string' && filePath.trim() !== '';
    if ((!hasFolder && !hasFile) || !permission) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired });
    }
    const targetPath = hasFile ? filePath : folderPath;
    if (isMetaPath(targetPath)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.accessDenied });
    }

    const perm = normalizePermission(permission);
    if (!perm) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.invalidPermission });
    }

    const requester = await User.findById(req.user.id);
    if (!requester) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.userNotFound });
    }

    const normalizedPath = normalizePath(targetPath);
    const ownerUsername = extractOwnerUsername(normalizedPath);
    if (!ownerUsername) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.invalidPathOwner });
    }

    const owner = await User.findByUsername(ownerUsername);
    if (!owner) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.ownerNotFound });
    }

    if (Number(owner.id) === Number(requester.id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.ownPath });
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
  } catch (error) {
    console.error('Create permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.createFail });
  }
});

router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listInbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List inbox permission requests error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.listInboxFail });
  }
});

router.get('/outbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listOutbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List outbox permission requests error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.listOutboxFail });
  }
});

router.get('/check-owner', authenticateToken, async (req, res) => {
  try {
    const { folderPath, filePath } = req.query;
    const pathToCheck = filePath || folderPath;

    if (!pathToCheck) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.pathRequired });
    }

    if (isMetaPath(pathToCheck)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.accessDenied });
    }

    const normalizedPath = normalizePath(pathToCheck);
    const ownerUsername = extractOwnerUsername(normalizedPath);

    if (!ownerUsername) {
      return res.json({ ownerExists: false, ownerUsername: null });
    }

    const owner = await User.findByUsername(ownerUsername);
    const ownerExists = Boolean(owner);

    res.json({ ownerExists, ownerUsername: ownerExists ? ownerUsername : null });
  } catch (error) {
    console.error('Check owner exists error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.checkOwnerFail });
  }
});

router.post('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.invalidRequestId });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.requestNotFound });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.accessDenied });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove });
    }

    // Note: Permission granting is handled by the client in review mode.
    // The client calls /api/permissions/grant before calling this approve endpoint.
    // We only update the request status here.

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.APPROVED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Approve permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.approveFail });
  }
});

router.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.invalidRequestId });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.requestNotFound });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.accessDenied });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.REJECTED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Reject permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.approveFail });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.invalidRequestId });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.requestNotFound });
    }

    if (pr.requester_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.accessDenied });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.onlyPendingApprove });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.CANCELLED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Cancel permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionRequests.approveFail });
  }
});

module.exports = router;

