const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');

// Grant permission
router.post('/grant', authenticateToken, async (req, res) => {
  try {
    const { userId, folderPath, permission } = req.body;
    
    if (!userId || !folderPath || !permission) {
      return res.status(400).json({ error: 'User ID, folder path, and permission are required' });
    }

    if (!['read', 'write', 'admin'].includes(permission)) {
      return res.status(400).json({ error: 'Invalid permission. Must be read, write, or admin' });
    }

    // Only allow users to grant permissions if they have admin access
    // Simplified: allow if user is granting to themselves or has admin on the folder
    const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
    if (!hasAdmin && parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }

    await Permission.grant(userId, folderPath, permission);
    res.json({ message: 'Permission granted successfully' });
  } catch (error) {
    console.error('Grant permission error:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

// Revoke permission
router.delete('/revoke', authenticateToken, async (req, res) => {
  try {
    const { userId, folderPath } = req.query;
    
    if (!userId || !folderPath) {
      return res.status(400).json({ error: 'User ID and folder path are required' });
    }

    // Check admin permission
    const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
    if (!hasAdmin && parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }

    await Permission.revoke(userId, folderPath);
    res.json({ message: 'Permission revoked successfully' });
  } catch (error) {
    console.error('Revoke permission error:', error);
    res.status(500).json({ error: 'Failed to revoke permission' });
  }
});

// Get user permissions
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Users can only view their own permissions unless they're checking for admin purposes
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const permissions = await Permission.getUserPermissions(userId);
    res.json(permissions);
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(500).json({ error: 'Failed to get user permissions' });
  }
});

// Get folder permissions
router.get('/folder', authenticateToken, async (req, res) => {
  try {
    const folderPath = req.query.path || '/';
    
    // Check if user has admin permission on this folder
    const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
    if (!hasAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }

    const permissions = await Permission.getFolderPermissions(folderPath);
    res.json(permissions);
  } catch (error) {
    console.error('Get folder permissions error:', error);
    res.status(500).json({ error: 'Failed to get folder permissions' });
  }
});

module.exports = router;

