const express = require('express');
const router = express.Router();
const multer = require('multer');
const archiver = require('archiver');
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
  pathExists,
} = require('../utils/webdav');
const { getThumbnailUrl } = require('../utils/thumbnail');
const path = require('path');

// Download progress tracking
const downloadProgress = new Map();
// Operation progress tracking (move/copy)
const operationProgress = new Map();

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
    
    // Normalize paths for comparison
    const normalizedOldPath = oldPath.replace(/\\/g, '/');
    const normalizedNewPath = newPath.replace(/\\/g, '/');
    
    // If same path, no need to rename
    if (normalizedOldPath === normalizedNewPath) {
      return res.json({ message: 'File name unchanged', path: newPath });
    }

    // Check if target file already exists
    const targetExists = await pathExists(newPath);
    if (targetExists) {
      return res.status(409).json({ 
        error: `파일 이름 변경 실패: "${newName}" 이름의 파일이 이미 존재합니다.` 
      });
    }

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

    // Check if destination file already exists
    const destExists = await pathExists(destinationPath);
    if (destExists) {
      return res.status(409).json({ error: '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' });
    }

    // Get file info for progress tracking
    let fileSize = 0;
    try {
      const parentPath = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
      const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
      const items = await listDirectory(parentPath);
      const fileItem = items.find(item => item.basename === fileName);
      if (fileItem && fileItem.size) {
        fileSize = fileItem.size;
      }
    } catch (err) {
      // Ignore error, continue without size info
    }

    // Create progress tracking ID
    const operationId = `move_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    operationProgress.set(operationId, {
      stage: 'preparing',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });

    // Start move operation with progress callback
    const progressCallback = (progress) => {
      operationProgress.set(operationId, {
        stage: progress.stage,
        progress: progress.progress,
        total: progress.total,
        percentage: progress.total > 0 ? Math.min(100, (progress.progress / progress.total) * 100) : 0,
      });
    };

    try {
      await moveFile(sourcePath, destinationPath, progressCallback);
      operationProgress.set(operationId, {
        stage: 'completed',
        progress: fileSize,
        total: fileSize,
        percentage: 100,
      });
      
      // Clean up after 5 minutes
      setTimeout(() => {
        operationProgress.delete(operationId);
      }, 5 * 60 * 1000);
      
      res.json({ message: 'File moved successfully', fileSize, operationId });
    } catch (error) {
      operationProgress.set(operationId, {
        stage: 'error',
        progress: 0,
        total: fileSize,
        percentage: 0,
        error: error.message,
      });
      throw error;
    }
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

    // Check if destination file already exists
    const destExists = await pathExists(destinationPath);
    if (destExists) {
      return res.status(409).json({ error: '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' });
    }

    // Get file info for progress tracking
    let fileSize = 0;
    try {
      const parentPath = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
      const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
      const items = await listDirectory(parentPath);
      const fileItem = items.find(item => item.basename === fileName);
      if (fileItem && fileItem.size) {
        fileSize = fileItem.size;
      }
    } catch (err) {
      // Ignore error, continue without size info
    }

    // Create progress tracking ID
    const operationId = `copy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    operationProgress.set(operationId, {
      stage: 'preparing',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });

    // Start copy operation with progress callback
    const progressCallback = (progress) => {
      operationProgress.set(operationId, {
        stage: progress.stage,
        progress: progress.progress,
        total: progress.total,
        percentage: progress.total > 0 ? Math.min(100, (progress.progress / progress.total) * 100) : 0,
      });
    };

    try {
      await copyFile(sourcePath, destinationPath, progressCallback);
      operationProgress.set(operationId, {
        stage: 'completed',
        progress: fileSize,
        total: fileSize,
        percentage: 100,
      });
      
      // Clean up after 5 minutes
      setTimeout(() => {
        operationProgress.delete(operationId);
      }, 5 * 60 * 1000);
      
      res.json({ message: 'File copied successfully', fileSize, operationId });
    } catch (error) {
      operationProgress.set(operationId, {
        stage: 'error',
        progress: 0,
        total: fileSize,
        percentage: 0,
        error: error.message,
      });
      throw error;
    }
  } catch (error) {
    console.error('Copy file error:', error);
    res.status(500).json({ error: error.message || 'Failed to copy file' });
  }
});

// Get thumbnail (legacy route - now handled by memory cache in server/index.js)
// This route is kept for backward compatibility but redirects to the new endpoint
router.get('/thumbnail/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { thumbnailCache, getThumbnailHash } = require('../utils/thumbnail');
    
    // Find thumbnail in cache by hash
    let foundThumbnail = null;
    for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
      if (getThumbnailHash(webdavPath) === hash) {
        foundThumbnail = thumbnail;
        break;
      }
    }
    
    if (foundThumbnail) {
      res.setHeader('Content-Type', foundThumbnail.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(foundThumbnail.buffer);
    } else {
      res.status(404).json({ error: 'Thumbnail not found' });
    }
  } catch (error) {
    console.error('Get thumbnail error:', error);
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

// Helper function to recursively collect files from a directory
async function collectFilesFromDirectory(dirPath, basePath = '', files = []) {
  try {
    const items = await listDirectory(dirPath);
    for (const item of items) {
      const itemPath = item.filename || `${dirPath}/${item.basename}`;
      const relativePath = basePath ? `${basePath}/${item.basename}` : item.basename;
      
      if (item.type === 'directory') {
        await collectFilesFromDirectory(itemPath, relativePath, files);
      } else {
        files.push({ path: itemPath, relativePath });
      }
    }
  } catch (error) {
    console.error(`Error collecting files from ${dirPath}:`, error);
  }
  return files;
}

// Download multiple files/folders as zip
router.post('/download-multiple', authenticateToken, async (req, res) => {
  const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { paths } = req.body;
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'Paths array is required' });
    }

    // Check permissions for all paths
    for (const filePath of paths) {
      const hasPermission = await checkFilePermission(req.user.id, filePath, 'read');
      if (!hasPermission) {
        return res.status(403).json({ error: `Access denied: ${filePath}` });
      }
    }

    // Initialize progress
    downloadProgress.set(downloadId, {
      status: 'preparing',
      progress: 0,
      total: 0,
      current: '',
      zipName: '',
    });

    // Collect all files to download
    const allFiles = [];
    let zipName = 'download';
    
    // Find common parent directory for all paths
    let commonParentDir = null;
    if (paths.length > 1) {
      // Get all parent directories
      const parentDirs = paths.map(p => {
        const dir = path.dirname(p);
        return dir === '/' ? '' : dir;
      });
      
      // Find common prefix
      if (parentDirs.every(d => d === parentDirs[0])) {
        commonParentDir = parentDirs[0] || '/';
      }
    }
    
    for (const filePath of paths) {
      console.log(`[Download] Processing path: ${filePath}`);
      try {
        // Check if it's a directory by checking parent directory
        let isDirectory = false;
        try {
          const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
          const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
          const parentItems = await listDirectory(parentPath);
          const item = parentItems.find(i => i.basename === fileName);
          if (item) {
            isDirectory = item.type === 'directory';
          } else {
            // Item not found in parent, try direct listing
            try {
              const items = await listDirectory(filePath);
              isDirectory = items.length > 0 || filePath.endsWith('/');
            } catch (listError) {
              isDirectory = false;
            }
          }
        } catch (checkError) {
          // If check fails, try direct listing
          try {
            const items = await listDirectory(filePath);
            isDirectory = items.length > 0 || filePath.endsWith('/');
          } catch (listError) {
            // If listDirectory fails, it's probably a file
            isDirectory = false;
          }
        }
        
        if (isDirectory) {
          // It's a directory - collect all files recursively
          const dirName = path.basename(filePath.replace(/\/$/, '')) || 'folder';
          if (paths.length === 1) {
            zipName = dirName;
          }
          await collectFilesFromDirectory(filePath, dirName, allFiles);
        } else {
          // It's a file
          const fileName = path.basename(filePath);
          console.log(`[Download] Found file: ${filePath}, filename: ${fileName}`);
          
          if (paths.length === 1) {
            // Single file - use parent directory name or file name
            const parentDir = path.dirname(filePath);
            if (parentDir && parentDir !== '/') {
              zipName = path.basename(parentDir) || 'download';
            } else {
              zipName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
            }
            // Single file: just use filename
            allFiles.push({ path: filePath, relativePath: fileName });
          } else {
            // Multiple files: preserve directory structure relative to common parent
            if (commonParentDir && commonParentDir !== '/') {
              // Remove common parent from path
              const relativePath = filePath.replace(commonParentDir, '').replace(/^\//, '');
              console.log(`[Download] Multiple files - common parent: ${commonParentDir}, relativePath: ${relativePath}`);
              allFiles.push({ path: filePath, relativePath });
            } else {
              // No common parent or root, use filename directly
              console.log(`[Download] Multiple files - no common parent, using filename: ${fileName}`);
              allFiles.push({ path: filePath, relativePath: fileName });
            }
          }
        }
      } catch (error) {
        // If everything fails, assume it's a file
        console.log(`[Download] Error processing ${filePath}, assuming it's a file:`, error.message);
        const fileName = path.basename(filePath);
        if (paths.length === 1) {
          const parentDir = path.dirname(filePath);
          if (parentDir && parentDir !== '/') {
            zipName = path.basename(parentDir) || 'download';
          } else {
            zipName = fileName.replace(/\.[^/.]+$/, '');
          }
          allFiles.push({ path: filePath, relativePath: fileName });
        } else {
          // Multiple files: use filename directly
          allFiles.push({ path: filePath, relativePath: fileName });
        }
      }
    }
    
    console.log(`[Download] Collected ${allFiles.length} files:`, allFiles.map(f => ({ path: f.path, relativePath: f.relativePath })));

    // If multiple items, use a generic name
    if (paths.length > 1) {
      const firstPath = paths[0];
      const parentDir = path.dirname(firstPath);
      if (parentDir && parentDir !== '/') {
        zipName = path.basename(parentDir) || 'download';
      } else {
        zipName = 'download';
      }
    }

    downloadProgress.set(downloadId, {
      status: 'downloading',
      progress: 0,
      total: allFiles.length,
      current: '',
      zipName: `${zipName}.zip`,
    });

    // Set response headers
    const encodedZipName = encodeURIComponent(`${zipName}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"; filename*=UTF-8''${encodedZipName}`);

    // Create zip archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      downloadProgress.set(downloadId, {
        status: 'error',
        progress: 0,
        total: allFiles.length,
        current: '',
        zipName: `${zipName}.zip`,
        error: err.message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip archive' });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      try {
        downloadProgress.set(downloadId, {
          status: 'downloading',
          progress: i + 1,
          total: allFiles.length,
          current: file.relativePath,
          zipName: `${zipName}.zip`,
        });

        console.log(`[Download] Adding file to zip: path=${file.path}, relativePath=${file.relativePath}`);
        const buffer = await getFileContents(file.path);
        console.log(`[Download] File content size: ${buffer.length} bytes for ${file.path}`);
        
        // Create a new buffer copy to avoid reference issues
        const fileBuffer = Buffer.from(buffer);
        archive.append(fileBuffer, { name: file.relativePath });
      } catch (error) {
        console.error(`Error adding file ${file.path} to archive:`, error);
        // Continue with other files even if one fails
      }
    }

    // Finalize archive
    await archive.finalize();

    downloadProgress.set(downloadId, {
      status: 'completed',
      progress: allFiles.length,
      total: allFiles.length,
      current: '',
      zipName: `${zipName}.zip`,
    });

    // Clean up progress after 5 minutes
    setTimeout(() => {
      downloadProgress.delete(downloadId);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('Download multiple files error:', error);
    downloadProgress.set(downloadId, {
      status: 'error',
      progress: 0,
      total: 0,
      current: '',
      zipName: '',
      error: error.message,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download files' });
    }
  }
});

// Get download progress
router.get('/download-progress/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const progress = downloadProgress.get(id);
    
    if (!progress) {
      return res.status(404).json({ error: 'Download progress not found' });
    }
    
    res.json(progress);
  } catch (error) {
    console.error('Get download progress error:', error);
    res.status(500).json({ error: 'Failed to get download progress' });
  }
});

// Get operation progress (move/copy)
router.get('/operation-progress/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const progress = operationProgress.get(id);
    
    if (!progress) {
      return res.status(404).json({ error: 'Operation progress not found' });
    }
    
    res.json(progress);
  } catch (error) {
    console.error('Get operation progress error:', error);
    res.status(500).json({ error: 'Failed to get operation progress' });
  }
});

module.exports = router;

