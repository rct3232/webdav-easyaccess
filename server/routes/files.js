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

const downloadProgress = new Map();
const operationProgress = new Map();

const upload = multer({ 
  storage: multer.memoryStorage(),
  preservePath: true,
});

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

router.get('/list', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        folderPath = userFolder;
      } else if (!folderPath.startsWith(userFolder)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    const hasPermission = await Permission.checkPermission(req.user.id, folderPath, 'read');
    
    if (!hasPermission) {
      const rootPermission = folderPath !== '/' ? await Permission.checkPermission(req.user.id, '/', 'read') : false;
      if (!rootPermission) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const items = await listDirectory(folderPath);
    const { ensureThumbnail } = require('../utils/thumbnail');
    
    const itemsWithThumbnails = await Promise.all(
      items.map(async (item) => {
        const fullPath = folderPath === '/' 
          ? '/' + item.basename 
          : (folderPath.endsWith('/') ? folderPath : folderPath + '/') + item.basename;
        const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        
        let thumbnailUrl = null;
        if (isImageFile(item.basename) || isVideoFile(item.basename)) {
          try {
            thumbnailUrl = await ensureThumbnail(normalizedPath);
          } catch (error) {
            // Continue without thumbnail
          }
        }
        
        return {
          ...item,
          path: normalizedPath,
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

router.get('/download', authenticateToken, async (req, res) => {
  try {
    const filePath = req.query.path;
    const inline = req.query.inline === 'true';
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const hasPermission = await checkFilePermission(req.user.id, filePath, 'read');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const buffer = await getFileContents(filePath);
    const filename = path.basename(filePath);
    const encodedFilename = encodeURIComponent(filename);
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
    
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
    
    const user = await User.findById(req.user.id);
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        folderPath = userFolder;
      } else if (!folderPath.startsWith(userFolder)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    if (!folderPath.startsWith('/')) {
      folderPath = '/' + folderPath;
    }
    if (folderPath !== '/' && !folderPath.endsWith('/')) {
      folderPath = folderPath + '/';
    }
    
    const filePath = folderPath === '/' 
      ? '/' + originalFilename 
      : (folderPath + originalFilename).replace(/\\/g, '/').replace(/\/+/g, '/');

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

    const user = await User.findById(req.user.id);
    if (user && user.is_admin) {
      try {
        await listDirectory(filePath);
        const usersWithPermissions = await Permission.hasPermissionsInPath(filePath);
        
        if (usersWithPermissions.length > 0) {
          const userList = usersWithPermissions.map(u => `${u.username} (${u.folder_path})`).join(', ');
          return res.status(400).json({ 
            error: `이 폴더에는 접근 권한이 부여된 사용자가 있어 삭제할 수 없습니다.\n권한이 있는 사용자: ${userList}\n\n먼저 권한을 제거한 후 삭제해주세요.`,
            usersWithPermissions: usersWithPermissions.map(u => ({ username: u.username, path: u.folder_path }))
          });
        }
      } catch (dirError) {
        // Not a directory or doesn't exist, proceed with deletion
      }
    }

    await deleteFile(filePath);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
});

router.put('/rename', authenticateToken, async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Old path and new name are required' });
    }

    const hasPermission = await checkFilePermission(req.user.id, oldPath, 'write');
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName).replace(/\\/g, '/');
    const normalizedOldPath = oldPath.replace(/\\/g, '/');
    const normalizedNewPath = newPath.replace(/\\/g, '/');
    
    if (normalizedOldPath === normalizedNewPath) {
      return res.json({ message: 'File name unchanged', path: newPath });
    }

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

router.put('/move', authenticateToken, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }

    const hasSourcePermission = await checkFilePermission(req.user.id, sourcePath, 'write');
    const hasDestPermission = await checkFilePermission(req.user.id, destinationPath, 'write');
    
    if (!hasSourcePermission || !hasDestPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const destExists = await pathExists(destinationPath);
    if (destExists) {
      return res.status(409).json({ error: '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' });
    }

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
      // Ignore error
    }

    const operationId = `move_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    operationProgress.set(operationId, {
      stage: 'preparing',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });

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

router.post('/copy', authenticateToken, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }

    const hasSourcePermission = await checkFilePermission(req.user.id, sourcePath, 'read');
    const hasDestPermission = await checkFilePermission(req.user.id, destinationPath, 'write');
    
    if (!hasSourcePermission || !hasDestPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const destExists = await pathExists(destinationPath);
    if (destExists) {
      return res.status(409).json({ error: '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' });
    }

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
      // Ignore error
    }

    const operationId = `copy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    operationProgress.set(operationId, {
      stage: 'preparing',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });

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

router.get('/thumbnail/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { thumbnailCache, getThumbnailHash } = require('../utils/thumbnail');
    
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
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

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

    downloadProgress.set(downloadId, {
      status: 'preparing',
      progress: 0,
      total: 0,
      current: '',
      zipName: '',
    });

    const allFiles = [];
    let zipName = 'download';
    
    let commonParentDir = null;
    if (paths.length > 1) {
      const parentDirs = paths.map(p => {
        const dir = path.dirname(p);
        return dir === '/' ? '' : dir;
      });
      
      if (parentDirs.every(d => d === parentDirs[0])) {
        commonParentDir = parentDirs[0] || '/';
      }
    }
    
    for (const filePath of paths) {
      try {
        let isDirectory = false;
        try {
          const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
          const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
          const parentItems = await listDirectory(parentPath);
          const item = parentItems.find(i => i.basename === fileName);
          if (item) {
            isDirectory = item.type === 'directory';
          } else {
            try {
              const items = await listDirectory(filePath);
              isDirectory = items.length > 0 || filePath.endsWith('/');
            } catch (listError) {
              isDirectory = false;
            }
          }
        } catch (checkError) {
          try {
            const items = await listDirectory(filePath);
            isDirectory = items.length > 0 || filePath.endsWith('/');
          } catch (listError) {
            isDirectory = false;
          }
        }
        
        if (isDirectory) {
          const dirName = path.basename(filePath.replace(/\/$/, '')) || 'folder';
          if (paths.length === 1) {
            zipName = dirName;
          }
          await collectFilesFromDirectory(filePath, dirName, allFiles);
        } else {
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
            if (commonParentDir && commonParentDir !== '/') {
              const relativePath = filePath.replace(commonParentDir, '').replace(/^\//, '');
              allFiles.push({ path: filePath, relativePath });
            } else {
              allFiles.push({ path: filePath, relativePath: fileName });
            }
          }
        }
      } catch (error) {
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
          allFiles.push({ path: filePath, relativePath: fileName });
        }
      }
    }

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

    const encodedZipName = encodeURIComponent(`${zipName}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"; filename*=UTF-8''${encodedZipName}`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
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

    archive.pipe(res);

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

        const buffer = await getFileContents(file.path);
        const fileBuffer = Buffer.from(buffer);
        archive.append(fileBuffer, { name: file.relativePath });
        } catch (error) {
          // Continue with other files even if one fails
        }
      }

    await archive.finalize();

    downloadProgress.set(downloadId, {
      status: 'completed',
      progress: allFiles.length,
      total: allFiles.length,
      current: '',
      zipName: `${zipName}.zip`,
    });

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

