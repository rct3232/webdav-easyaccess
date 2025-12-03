const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
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

// Memory storage for file uploads with UTF-8 filename support
const upload = multer({ 
  storage: multer.memoryStorage(),
  // Preserve original filename encoding
  preservePath: true,
});

// Helper function to check if user can access a path
async function canAccessPath(userId, requestedPath) {
  const user = await User.findById(userId);
  
  if (!user) {
    return false;
  }

  if (user.is_admin) {
    return true;
  }

  const normalizedPath = requestedPath.replace(/\\/g, '/');
  const userFolder = `/${user.username}`;
  
  if (normalizedPath === '/' || normalizedPath === '') {
    return false;
  }
  
  return normalizedPath.startsWith(userFolder);
}

// Helper function to check permissions
async function checkFilePermission(userId, filePath, requiredPermission = 'read') {
  if (!await canAccessPath(userId, filePath)) {
    return false;
  }

  const folderPath = path.dirname(filePath) || '/';
  const hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  
  if (!hasPermission && folderPath !== '/') {
    return await Permission.checkPermission(userId, '/', requiredPermission);
  }
  
  return hasPermission;
}

// List files in directory
router.get('/list', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    const user = await User.findById(req.user.id);
    
    console.log('[Files List] User:', user);
    console.log('[Files List] Requested path:', folderPath);
    console.log('[Files List] is_admin:', user?.is_admin);
    
    if (!user) {
      console.log('[Files List] User not found!');
      return res.status(403).json({ error: 'User not found' });
    }
    
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      console.log('[Files List] Non-admin user, userFolder:', userFolder);
      if (folderPath === '/' || folderPath === '') {
        folderPath = userFolder;
      } else if (!folderPath.startsWith(userFolder)) {
        console.log('[Files List] Access denied - path does not start with user folder');
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    // For directory listing, check permission on the directory itself
    console.log('[Files List] Checking permission for folder:', folderPath);
    const hasPermission = await Permission.checkPermission(req.user.id, folderPath, 'read');
    console.log('[Files List] Direct permission:', hasPermission);
    
    if (!hasPermission) {
      // Fallback to root permission
      const rootPermission = folderPath !== '/' ? await Permission.checkPermission(req.user.id, '/', 'read') : false;
      console.log('[Files List] Root permission fallback:', rootPermission);
      
      if (!rootPermission) {
        console.log('[Files List] Permission denied - no access to folder');
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const items = await listDirectory(folderPath);
    const { ensureThumbnail } = require('../utils/thumbnail');
    
    // Add thumbnail URLs for images and videos (generate if needed)
    const itemsWithThumbnails = await Promise.all(
      items.map(async (item) => {
        // Build full path - handle root path specially
        let fullPath;
        if (folderPath === '/') {
          fullPath = '/' + item.basename;
        } else {
          // Ensure folderPath ends with / for proper joining
          const normalizedFolder = folderPath.endsWith('/') ? folderPath : folderPath + '/';
          fullPath = normalizedFolder + item.basename;
        }
        
        // Normalize path separators
        fullPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        
        let thumbnailUrl = null;
        
        if (isImageFile(item.basename) || isVideoFile(item.basename)) {
          try {
            thumbnailUrl = await ensureThumbnail(fullPath);
          } catch (error) {
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
    const inline = req.query.inline === 'true'; // Check if this is for preview
    
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

    // Encode filename for Content-Disposition header (RFC 5987)
    // Support both ASCII and UTF-8 filenames
    const encodedFilename = encodeURIComponent(filename);
    
    // For ASCII-only filename, use simple format
    // For non-ASCII (e.g., Korean), use only the encoded format to avoid header errors
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_'); // Replace non-ASCII with underscore
    
    // Use 'inline' for preview, 'attachment' for download
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
    
    // Set appropriate content type for inline display
    if (inline) {
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    
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

    let originalFilename = req.file.originalname;
    
    try {
      if (/[^\x00-\x7F]/.test(originalFilename)) {
        const latin1Buffer = Buffer.from(originalFilename, 'latin1');
        originalFilename = latin1Buffer.toString('utf8');
      }
    } catch (e) {
      // If conversion fails, use original filename
    }

    let folderPath = req.body.path || '/';
    
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
    
    // Normalize folder path
    if (!folderPath.startsWith('/')) {
      folderPath = '/' + folderPath;
    }
    if (folderPath !== '/' && !folderPath.endsWith('/')) {
      folderPath = folderPath + '/';
    }
    
    // Build file path - handle root path specially
    let filePath;
    if (folderPath === '/') {
      filePath = '/' + originalFilename;
    } else {
      filePath = folderPath + originalFilename;
    }
    
    filePath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

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

    // Check if this is a directory with assigned permissions
    const user = await User.findById(req.user.id);
    if (user && user.is_admin) {
      try {
        // Try to list directory contents to determine if it's a directory
        await listDirectory(filePath);
        
        // It's a directory - check for permissions
        console.log('[Delete] Checking permissions for directory:', filePath);
        const usersWithPermissions = await Permission.hasPermissionsInPath(filePath);
        
        if (usersWithPermissions.length > 0) {
          console.log('[Delete] Found users with permissions:', usersWithPermissions.map(u => u.username));
          const userList = usersWithPermissions.map(u => `${u.username} (${u.folder_path})`).join(', ');
          return res.status(400).json({ 
            error: `이 폴더에는 접근 권한이 부여된 사용자가 있어 삭제할 수 없습니다.\n권한이 있는 사용자: ${userList}\n\n먼저 권한을 제거한 후 삭제해주세요.`,
            usersWithPermissions: usersWithPermissions.map(u => ({ username: u.username, path: u.folder_path }))
          });
        }
      } catch (dirError) {
        // Not a directory or doesn't exist, proceed with deletion
        console.log('[Delete] Not a directory or does not exist, proceeding with deletion');
      }
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

