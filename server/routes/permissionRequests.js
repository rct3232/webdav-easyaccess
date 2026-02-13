const express = require('express');
const router = express.Router();

const {
  PERMISSIONS,
  HTTP_STATUS,
  PERMISSION_REQUEST_STATUS,
} = require('@webdav-easyaccess/shared/constants');
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
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'One of folderPath or filePath, and permission are required' });
    }
    const targetPath = hasFile ? filePath : folderPath;
    if (isMetaPath(targetPath)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
    }

    const perm = normalizePermission(permission);
    if (!perm) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid permission. Must be read or write' });
    }

    const requester = await User.findById(req.user.id);
    if (!requester) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'User not found' });
    }

    const normalizedPath = normalizePath(targetPath);
    const ownerUsername = extractOwnerUsername(normalizedPath);
    if (!ownerUsername) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid path for owner-only requests' });
    }

    const owner = await User.findByUsername(ownerUsername);
    if (!owner) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Owner not found for this path' });
    }

    if (Number(owner.id) === Number(requester.id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Cannot request permissions for your own path' });
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
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to create permission request' });
  }
});

router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listInbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List inbox permission requests error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list permission requests' });
  }
});

router.get('/outbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listOutbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List outbox permission requests error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list permission requests' });
  }
});

router.get('/check-owner', authenticateToken, async (req, res) => {
  try {
    const { folderPath, filePath } = req.query;
    const pathToCheck = filePath || folderPath;

    if (!pathToCheck) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'folderPath or filePath is required' });
    }

    if (isMetaPath(pathToCheck)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
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
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to check owner existence' });
  }
});

router.post('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Request not found' });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Only pending requests can be approved' });
    }

    // Note: Permission granting is handled by the client in review mode.
    // The client calls /api/permissions/grant before calling this approve endpoint.
    // We only update the request status here.

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.APPROVED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Approve permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to approve permission request' });
  }
});

router.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Request not found' });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Only pending requests can be rejected' });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.REJECTED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Reject permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to reject permission request' });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Request not found' });
    }

    if (pr.requester_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
    }
    if (pr.status !== PERMISSION_REQUEST_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Only pending requests can be cancelled' });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: PERMISSION_REQUEST_STATUS.CANCELLED, resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Cancel permission request error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to cancel permission request' });
  }
});

module.exports = router;

