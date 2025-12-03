const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { createDirectory, listDirectory } = require('../utils/webdav');
const path = require('path');

// Helper function to check permissions
async function checkFolderPermission(userId, folderPath, requiredPermission = 'read') {
  const hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  
  if (!hasPermission && folderPath !== '/') {
    return await Permission.checkPermission(userId, '/', requiredPermission);
  }
  
  return hasPermission;
}

// Create folder
router.post('/create', authenticateToken, async (req, res) => {
  try {
    let { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // Check access for non-admin users
    const user = await User.findById(req.user.id);
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!folderPath.startsWith(userFolder)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Check permission
    const parentPath = path.dirname(folderPath) || '/';
    const hasPermission = await checkFolderPermission(req.user.id, parentPath, 'write');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await createDirectory(folderPath);
    res.json({ message: 'Folder created successfully', path: folderPath });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: error.message || 'Failed to create folder' });
  }
});

// List folder contents
router.get('/list', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    
    // Adjust path for non-admin users
    const user = await User.findById(req.user.id);
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        folderPath = userFolder;
      } else if (!folderPath.startsWith(userFolder)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    // Check permission
    const hasPermission = await checkFolderPermission(req.user.id, folderPath, 'read');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const items = await listDirectory(folderPath);
    res.json(items);
  } catch (error) {
    console.error('List folder error:', error);
    res.status(500).json({ error: error.message || 'Failed to list folder' });
  }
});

module.exports = router;

