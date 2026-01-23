const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../utils/auth');
const { normalizePath } = require('../utils/pathUtils');
const { isMetaPath } = require('../store/metaPaths');

const User = require('../models/User');
const PermissionRequest = require('../models/PermissionRequest');

function extractOwnerUsername(folderPath) {
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  return parts[0] || null;
}

function normalizePermission(p) {
  return p === 'read' || p === 'write' ? p : null;
}

function normalizeStatus(s) {
  const allowed = new Set(['pending', 'approved', 'rejected', 'cancelled']);
  return allowed.has(s) ? s : null;
}

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { folderPath, permission, message } = req.body || {};

    if (!folderPath || !permission) {
      return res.status(400).json({ error: 'folderPath and permission are required' });
    }
    if (isMetaPath(folderPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const perm = normalizePermission(permission);
    if (!perm) {
      return res.status(400).json({ error: 'Invalid permission. Must be read or write' });
    }

    const requester = await User.findById(req.user.id);
    if (!requester) {
      return res.status(403).json({ error: 'User not found' });
    }

    const normalizedFolderPath = normalizePath(folderPath);
    const ownerUsername = extractOwnerUsername(normalizedFolderPath);
    if (!ownerUsername) {
      return res.status(400).json({ error: 'Invalid folder path for owner-only requests' });
    }

    const owner = await User.findByUsername(ownerUsername);
    if (!owner) {
      return res.status(400).json({ error: 'Owner not found for this path' });
    }

    if (Number(owner.id) === Number(requester.id)) {
      return res.status(400).json({ error: 'Cannot request permissions for your own path' });
    }

    const created = await PermissionRequest.create({
      requesterId: requester.id,
      requesterUsername: requester.username,
      ownerId: owner.id,
      ownerUsername: owner.username,
      folderPath: normalizedFolderPath,
      requestedPermission: perm,
      message: typeof message === 'string' ? message : '',
    });

    res.json(created);
  } catch (error) {
    console.error('Create permission request error:', error);
    res.status(500).json({ error: 'Failed to create permission request' });
  }
});

router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listInbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List inbox permission requests error:', error);
    res.status(500).json({ error: 'Failed to list permission requests' });
  }
});

router.get('/outbox', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(String(req.query.status)) : null;
    const list = await PermissionRequest.listOutbox(req.user.id, status ? { status } : undefined);
    res.json(list);
  } catch (error) {
    console.error('List outbox permission requests error:', error);
    res.status(500).json({ error: 'Failed to list permission requests' });
  }
});

router.get('/check-owner', authenticateToken, async (req, res) => {
  try {
    const { folderPath } = req.query;

    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    if (isMetaPath(folderPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const normalizedFolderPath = normalizePath(folderPath);
    const ownerUsername = extractOwnerUsername(normalizedFolderPath);

    if (!ownerUsername) {
      return res.json({ ownerExists: false, ownerUsername: null });
    }

    const owner = await User.findByUsername(ownerUsername);
    // owner가 null, undefined, 또는 falsy 값이면 false
    const ownerExists = Boolean(owner);

    res.json({ ownerExists, ownerUsername: ownerExists ? ownerUsername : null });
  } catch (error) {
    console.error('Check owner exists error:', error);
    res.status(500).json({ error: 'Failed to check owner existence' });
  }
});

router.post('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (pr.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending requests can be approved' });
    }

    // Note: Permission granting is handled by the client in review mode.
    // The client calls /api/permissions/grant before calling this approve endpoint.
    // We only update the request status here.

    const updated = await PermissionRequest.updateStatus(id, { status: 'approved', resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Approve permission request error:', error);
    res.status(500).json({ error: 'Failed to approve permission request' });
  }
});

router.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (pr.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (pr.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending requests can be rejected' });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: 'rejected', resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Reject permission request error:', error);
    res.status(500).json({ error: 'Failed to reject permission request' });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const pr = await PermissionRequest.findById(id);
    if (!pr) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (pr.requester_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (pr.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    }

    const updated = await PermissionRequest.updateStatus(id, { status: 'cancelled', resolvedBy: req.user.id });
    res.json(updated);
  } catch (error) {
    console.error('Cancel permission request error:', error);
    res.status(500).json({ error: 'Failed to cancel permission request' });
  }
});

module.exports = router;

