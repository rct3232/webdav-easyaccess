const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const {
  listDirectory,
  getFileContents,
  putFileContents,
  deleteFile,
  moveFile,
  copyFile,
  isImageFile,
  isVideoFile,
} = require('../utils/webdav');
const { getThumbnailUrl } = require('../utils/thumbnail');
const path = require('path');

// Memory storage for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to check permissions
async function checkFilePermission(userId, filePath, requiredPermission = 'read') {
  // Get the folder path (parent directory)
  const folderPath = path.dirname(filePath) || '/';
  
  // Check if user has permission for this folder
  const hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  
  // If no specific permission, check root
  if (!hasPermission && folderPath !== '/') {
    return await Permission.checkPermission(userId, '/', requiredPermission);
  }
  
  return hasPermission;
}

// List files in directory
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const folderPath = req.query.path || '/';
    
    // Check permission
    const hasPermission = await checkFilePermission(req.user.id, folderPath, 'read');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const items = await listDirectory(folderPath);
    const { ensureThumbnail } = require('../utils/thumbnail');
    
    // Add thumbnail URLs for images and videos (generate if needed)
    const itemsWithThumbnails = await Promise.all(
      items.map(async (item) => {
        const fullPath = path.join(folderPath, item.basename).replace(/\\/g, '/');
        let thumbnailUrl = null;
        
        if (isImageFile(item.basename) || isVideoFile(item.basename)) {
          try {
            thumbnailUrl = await ensureThumbnail(fullPath);
          } catch (error) {
            console.error('Thumbnail generation error:', error);
            // Continue without thumbnail
          }
        }
        
        return {
          ...item,
          path: fullPath,
          thumbnailUrl,
        };
      })
    );

    res.json(itemsWithThumbnails);
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ error: error.message || 'Failed to list files' });
  }
});

// Download file
router.get('/download', authenticateToken, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // Check permission
    const hasPermission = await checkFilePermission(req.user.id, filePath, 'read');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const buffer = await getFileContents(filePath);
    const filename = path.basename(filePath);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: error.message || 'Failed to download file' });
  }
});

// Upload file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folderPath = req.body.path || '/';
    const filePath = path.join(folderPath, req.file.originalname).replace(/\\/g, '/');

    // Check permission
    const hasPermission = await checkFilePermission(req.user.id, filePath, 'write');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await putFileContents(filePath, req.file.buffer);

    res.json({ message: 'File uploaded successfully', path: filePath });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

// Delete file
router.delete('/delete', authenticateToken, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // Check permission
    const hasPermission = await checkFilePermission(req.user.id, filePath, 'write');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await deleteFile(filePath);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
});

// Rename file
router.put('/rename', authenticateToken, async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Old path and new name are required' });
    }

    // Check permission
    const hasPermission = await checkFilePermission(req.user.id, oldPath, 'write');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName).replace(/\\/g, '/');

    await moveFile(oldPath, newPath);
    res.json({ message: 'File renamed successfully', path: newPath });
  } catch (error) {
    console.error('Rename file error:', error);
    res.status(500).json({ error: error.message || 'Failed to rename file' });
  }
});

// Move file
router.put('/move', authenticateToken, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }

    // Check permissions for both source and destination
    const hasSourcePermission = await checkFilePermission(req.user.id, sourcePath, 'write');
    const hasDestPermission = await checkFilePermission(req.user.id, destinationPath, 'write');
    
    if (!hasSourcePermission || !hasDestPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await moveFile(sourcePath, destinationPath);
    res.json({ message: 'File moved successfully' });
  } catch (error) {
    console.error('Move file error:', error);
    res.status(500).json({ error: error.message || 'Failed to move file' });
  }
});

// Copy file
router.post('/copy', authenticateToken, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }

    // Check permissions
    const hasSourcePermission = await checkFilePermission(req.user.id, sourcePath, 'read');
    const hasDestPermission = await checkFilePermission(req.user.id, destinationPath, 'write');
    
    if (!hasSourcePermission || !hasDestPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await copyFile(sourcePath, destinationPath);
    res.json({ message: 'File copied successfully' });
  } catch (error) {
    console.error('Copy file error:', error);
    res.status(500).json({ error: error.message || 'Failed to copy file' });
  }
});

// Get thumbnail (legacy route - now handled by static file serving)
router.get('/thumbnail/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { getThumbnailPath } = require('../utils/thumbnail');
    const fs = require('fs');
    const thumbnailPath = getThumbnailPath(`/${hash}`);
    
    if (fs.existsSync(thumbnailPath)) {
      res.sendFile(thumbnailPath);
    } else {
      res.status(404).json({ error: 'Thumbnail not found' });
    }
  } catch (error) {
    console.error('Get thumbnail error:', error);
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

module.exports = router;

