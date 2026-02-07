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
const { normalizePath, getParentPath } = require('../utils/pathUtils');
const {
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  hasDirectFolderPermission,
  isOwnerPath,
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncWriteFileByParentChecker,
} = require('../utils/permissionPolicy');
const { selectiveTransfer } = require('../services/selectiveTransfer');
const { selectiveCollectFiles } = require('../services/selectiveDownload');
const { selectiveDelete } = require('../services/selectiveDelete');
const { isMetaPath } = require('../store/metaPaths');
const { asyncLimitSettled } = require('../utils/asyncUtils');
const path = require('path');
const requireUser = require('../middleware/requireUser');
const { checkMetaPathAccess } = require('../middleware/metaPathGuard');
const normalizePathParam = require('../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError, conflictError } = require('../utils/errorHandler');

const downloadProgress = new Map();
const operationProgress = new Map();

async function isDirectoryPath(webdavPath) {
  try {
    await listDirectory(webdavPath);
    return true;
  } catch (error) {
    // Try with/without trailing slash (WebDAV servers can differ)
    try {
      if (!webdavPath.endsWith('/')) {
        await listDirectory(webdavPath + '/');
        return true;
      }
    } catch (_) {
      // ignore
    }
    try {
      if (webdavPath.endsWith('/') && webdavPath !== '/') {
        await listDirectory(webdavPath.slice(0, -1));
        return true;
      }
    } catch (_) {
      // ignore
    }
    return false;
  }
}

async function hasDirectFolderWritePermission(userId, folderPath) {
  return await hasDirectFolderPermission(userId, folderPath, 'write');
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  preservePath: true,
});

async function checkConflictsRecursive(sourcePath, destinationPath, conflicts = [], depth = 0, cache = {}) {
  // Limit depth and total conflicts
  if (depth > 5 || conflicts.length > 100) return conflicts;

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await listDirectory(p);
      cache[p] = items;
      return items;
    } catch (e) {
      cache[p] = null;
      return null;
    }
  };

  const getExists = async (p) => {
    const key = `exists:${p}`;
    if (cache[key] !== undefined) return cache[key];
    const exists = await pathExists(p);
    cache[key] = exists;
    return exists;
  };

  const [sourceItems, destItems] = await Promise.all([
    getItems(sourcePath),
    getItems(destinationPath)
  ]);
  
  const isSourceDir = sourceItems !== null;
  const isDestDir = destItems !== null;

  if (!isDestDir) {
    const exists = await getExists(destinationPath);
    if (!exists) return conflicts;
  }

  // Add the current path if it exists
  conflicts.push({
    path: destinationPath,
    type: isDestDir ? 'directory' : 'file',
    sourcePath: sourcePath
  });

  if (conflicts.length > 100) return conflicts;

  // If both are directories, check children
  if (isSourceDir && isDestDir && sourceItems && destItems) {
    const destItemNames = new Set(destItems.map(item => item.basename));

    const itemResults = await Promise.all(sourceItems.map(async (item) => {
      if (conflicts.length > 100) return;
      
      if (destItemNames.has(item.basename)) {
        const childSourcePath = sourcePath === '/' ? '/' + item.basename : sourcePath + '/' + item.basename;
        const childDestPath = destinationPath === '/' ? '/' + item.basename : destinationPath + '/' + item.basename;
        
        if (item.type === 'directory') {
          await checkConflictsRecursive(childSourcePath, childDestPath, conflicts, depth + 1, cache);
        } else {
          conflicts.push({
            path: childDestPath,
            type: 'file',
            sourcePath: childSourcePath
          });
        }
      }
    }));
  }

  return conflicts;
}

router.post('/check-conflicts', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { operations } = req.body; // [{ sourcePath, destinationPath, type }]
  if (!operations || !Array.isArray(operations)) {
    throw validationError('Operations array is required');
  }

  const conflicts = [];
  const cache = {};

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await listDirectory(p);
      cache[p] = items;
      return items;
    } catch (e) {
      cache[p] = null;
      return null;
    }
  };

  const getExists = async (p) => {
    const key = `exists:${p}`;
    if (cache[key] !== undefined) return cache[key];
    const exists = await pathExists(p);
    cache[key] = exists;
    return exists;
  };

  // Group upload operations by parent directory for faster checking
  const uploadOps = operations.filter(op => op.type === 'upload');
  const otherOps = operations.filter(op => op.type !== 'upload');

  // Process upload operations in parallel
  await asyncLimitSettled(10, uploadOps, async (op) => {
    if (conflicts.length > 100) return;
    const { sourcePath, destinationPath } = op;
    const parentPath = getParentPath(destinationPath);
    const fileName = path.posix.basename(destinationPath);
    const items = await getItems(parentPath);
    
    if (items) {
      const item = items.find(i => i.basename === fileName);
      if (item) {
        conflicts.push({
          path: destinationPath,
          type: item.type === 'directory' ? 'directory' : 'file',
          sourcePath: sourcePath || destinationPath
        });
      }
    } else {
      const exists = await getExists(destinationPath);
      if (exists) {
        const isDir = await isDirectoryPath(destinationPath);
        conflicts.push({
          path: destinationPath,
          type: isDir ? 'directory' : 'file',
          sourcePath: sourcePath || destinationPath
        });
      }
    }
  });

  // Process other operations (move/copy) in parallel
  await asyncLimitSettled(5, otherOps, async (op) => {
    if (conflicts.length > 100) return;
    await checkConflictsRecursive(op.sourcePath, op.destinationPath, conflicts, 0, cache);
  });

  res.json({ conflicts });
}));

router.get('/list', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let folderPath = normalizePath(req.query.path || '/');
  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);

    // 권한 체크 (doc 1회 로드 후 동기 판별)
    let hasPermission =
      user.is_admin ||
      isOwnerPath(user, folderPath) ||
      Permission.checkPermissionSync(doc, folderPath, 'read');
    if (!hasPermission && folderPath !== '/') {
      const pathParts = folderPath.split('/').filter(Boolean);
      for (let i = pathParts.length; i > 0; i--) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        if (Permission.checkPermissionSync(doc, parentPath, 'read')) {
          hasPermission = true;
          break;
        }
      }
    }
    if (!hasPermission && folderPath !== '/') {
      hasPermission = Permission.checkPermissionSync(doc, '/', 'read');
    }
    if (!hasPermission) {
      if (user.is_admin) {
        // 권한 체크 건너뛰기
      } else {
        const userFolder = `/${user.username}`;
        if (folderPath === '/' || folderPath === '') {
          folderPath = userFolder;
        } else if (!folderPath.startsWith(userFolder)) {
          return res.status(403).json({
            error: 'Access denied',
            message: '이 폴더에 대한 접근 권한이 없습니다.'
          });
        }
      }
    }

    let items;
    try {
      items = await listDirectory(folderPath);
    } catch (error) {
      // Handle 404 errors (directory doesn't exist) with proper status code
      if (error.status === 404) {
        throw notFoundError(`Directory not found: ${folderPath}`);
      }
      // Re-throw other errors
      throw error;
    }
    // Admin인 경우 .wea 폴더도 반환 (필터링은 클라이언트에서 처리)
    // 일반 사용자는 여전히 필터링 (보안)
    const filteredItems = user.is_admin 
      ? items 
      : items.filter(item => item.basename !== '.wea');
    const { getThumbnailUrl } = require('../utils/thumbnail');
    
    // Current directory write permission (sync from doc)
    const currentDirWritePermission =
      user.is_admin ||
      isOwnerPath(user, folderPath) ||
      Permission.checkPermissionSync(doc, folderPath, 'write');

    // 항목별 권한 체크 (동기, doc 기반)
    const itemsWithThumbnails = filteredItems.map((item) => {
      if (!item.basename || item.basename.includes('/') || item.basename.includes('\\')) {
        return null;
      }
      const cleanFolderPath = folderPath === '/' ? '/' : folderPath;
      const fullPath =
        cleanFolderPath === '/' ? '/' + item.basename : cleanFolderPath + '/' + item.basename;
      const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');

      let hasReadPermission = true;
      let hasWritePermission = item.type === 'directory' ? true : currentDirWritePermission;

      if (item.type === 'directory') {
        if (user.is_admin) {
          hasReadPermission = true;
          hasWritePermission = true;
        } else {
          hasReadPermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, 'read');
          hasWritePermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, 'write');
        }
      }

      let thumbnailUrl = null;
      if (isImageFile(item.basename) || isVideoFile(item.basename)) {
        thumbnailUrl = getThumbnailUrl(normalizedPath);
      }
      const isHidden = item.basename.startsWith('.');

      return {
        ...item,
        path: normalizedPath,
        thumbnailUrl,
        hasReadPermission,
        hasWritePermission,
        isHidden,
      };
    });

  // 모든 항목 반환 (권한 정보 포함)
  // 직접 권한이 없는 디렉토리도 표시하되, 비활성화 상태로 표시됨
  res.json(itemsWithThumbnails.filter(item => item !== null));
}));

router.get('/download', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const inline = req.query.inline === 'true';
  
  if (!filePath) {
    throw validationError('File path is required');
  }

  const user = req.user.full;

    // Download policy: direct-only read (admin/owner bypass)
    let hasPermission = false;
    if (user.is_admin || isOwnerPath(user, filePath)) {
      hasPermission = true;
    } else {
      const normalized = normalizePath(filePath);
      const parentDir = path.posix.dirname(normalized) || '/';
      hasPermission = await hasDirectFolderPermission(user.id, parentDir, 'read');
    }
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const buffer = await getFileContents(filePath);
    const filename = path.basename(filePath);
    const encodedFilename = encodeURIComponent(filename);
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
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
}));

router.post('/upload', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw validationError('No file uploaded');
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
  const relativePath = req.body.relativePath || ''; // Support for nested folder uploads
  
  const user = req.user.full;
    
    // 관리자는 모든 경로에 파일 업로드 가능
    if (!user.is_admin) {
      // 경로 정규화 (끝의 / 제거)
      const normalizedPath = normalizePath(folderPath);
      
      if (normalizedPath === '/' || normalizedPath === '') {
        folderPath = `/${user.username}`;
      } else {
        const ok = await canWriteFolder(user, normalizedPath);
        if (!ok) {
          return res.status(403).json({ error: 'Access denied' });
        }
        folderPath = normalizedPath;
      }
    } else {
      // 관리자의 경우도 경로 정규화
      folderPath = normalizePath(folderPath);
    }
    
    // 디렉토리 경로로 변환 (끝에 / 추가)
    if (folderPath !== '/' && !folderPath.endsWith('/')) {
      folderPath = folderPath + '/';
    }
    
    // If relativePath is provided, create intermediate directories
    let finalFolderPath = folderPath;
    if (relativePath) {
      // Extract directory path from relativePath (excluding filename)
      const relativeDir = path.dirname(relativePath);
      if (relativeDir && relativeDir !== '.') {
        // Construct full directory path
        finalFolderPath = path.join(folderPath, relativeDir).replace(/\\/g, '/');
        if (!finalFolderPath.endsWith('/')) {
          finalFolderPath = finalFolderPath + '/';
        }
        
        // Create intermediate directories if they don't exist
        const { createDirectory } = require('../utils/webdav');
        const dirParts = relativeDir.split('/').filter(Boolean);
        let currentPath = folderPath;
        
        // Get parent folder owners (users with write/admin permissions on the parent folder)
        // This is done once before the loop to avoid repeated queries
        let parentFolderOwners = [];
        try {
          const parentPermissions = await Permission.getFolderPermissions(folderPath);
          // Filter users with write or admin permissions
          parentFolderOwners = parentPermissions
            .filter(perm => perm.permission === 'write' || perm.permission === 'admin')
            .map(perm => perm.id);
        } catch (permQueryError) {
          console.error('Failed to query parent folder permissions:', permQueryError);
          // Continue even if query fails
        }
        
        for (const dirPart of dirParts) {
          currentPath = path.join(currentPath, dirPart).replace(/\\/g, '/');
          if (!currentPath.endsWith('/')) {
            currentPath = currentPath + '/';
          }
          
          // Check if directory exists, create if not
          const dirExists = await pathExists(currentPath);
          
          if (!dirExists) {
            try {
              await createDirectory(currentPath);
              
              // Grant permissions to the user who created it
              try {
                await Permission.grant(req.user.id, currentPath, 'write');
                
                // Grant permissions to parent folder owners (users with write/admin permissions on parent folder)
                for (const ownerId of parentFolderOwners) {
                  try {
                    // Skip if it's the same user (already granted above)
                    if (ownerId !== req.user.id) {
                      await Permission.grant(ownerId, currentPath, 'write');
                    }
                  } catch (ownerPermError) {
                    console.error(`Failed to grant permission to parent folder owner ${ownerId} for ${currentPath}:`, ownerPermError);
                    // Continue with other owners even if one fails
                  }
                }
                
              } catch (permError) {
                console.error('Failed to grant permissions for intermediate directory:', permError);
              }
            } catch (createError) {
              // Directory might already exist or be created by another request
            }
          }
        }
      }
    }
  const { onConflict } = req.body;

  const filePath = finalFolderPath === '/' 
    ? '/' + originalFilename 
    : (finalFolderPath + originalFilename).replace(/\\/g, '/').replace(/\/+/g, '/');

  // Check if file already exists
  const fileExists = await pathExists(filePath);
  
  if (fileExists && onConflict !== 'overwrite') {
    throw conflictError(`파일 업로드 실패: "${originalFilename}" 이름의 파일이 이미 존재합니다.`);
  }

  // If onConflict is 'skip' and file exists, we return success but don't actually upload
  if (fileExists && onConflict === 'skip') {
    return res.json({ message: 'File upload skipped', path: filePath, skipped: true });
  }

  // 최종 권한 체크는 이미 위에서 완료됨 (folderPath에 대한 권한 체크)
  // 파일 경로 자체에 대한 추가 체크는 불필요 (부모 폴더 권한으로 충분)

  await putFileContents(filePath, req.file.buffer);

  res.json({ message: 'File uploaded successfully', path: filePath });
}));

router.delete('/delete', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    throw validationError('File path is required');
  }

  const user = req.user.full;
  const normalizedTargetPath = normalizePath(filePath);
  const isDir = await isDirectoryPath(filePath);
  const hasPermission = isDir
    ? await canWriteFolder(user, normalizedTargetPath)
    : await canWriteFileByParent(user, normalizedTargetPath);
  
  if (!hasPermission) {
    throw forbiddenError('Access denied');
  }
  
  if (user.is_admin) {
    try {
      await listDirectory(filePath);
      // 디렉토리인 경우
      // 경로 정규화 (끝에 / 제거하여 비교)
      const normalizedPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
      
      // 경로가 정확히 /{username} 형식인지 확인 (루트 사용자 디렉토리)
      const pathParts = normalizedPath.split('/').filter(Boolean);
      if (pathParts.length === 1) {
        // 루트 사용자 디렉토리인 경우, 해당 사용자가 존재하는지 확인
        const folderUsername = pathParts[0];
        const folderUser = await User.findByUsername(folderUsername);
        
        if (folderUser) {
          // 사용자가 존재하면 삭제 불가
          throw validationError(`이 폴더는 사용자 "${folderUsername}"의 루트 디렉토리입니다. 사용자가 존재하는 동안 삭제할 수 없습니다.\n\n사용자를 먼저 삭제한 후 폴더를 삭제해주세요.`);
        }
        // 사용자가 존재하지 않으면 삭제 가능
      }
      // 하위 디렉토리나 다른 경로는 권한 체크 없이 삭제 가능
    } catch (dirError) {
      // Not a directory or doesn't exist, proceed with deletion
    }
  }

  if (isDir) {
    if (user.is_admin || isOwnerPath(user, normalizedTargetPath)) {
      // Direct delete for admin/owner
      await deleteFile(filePath, { isDirectory: isDir });
      
      try {
        await Permission.revokePermissionsPrefixForAllUsers([normalizedTargetPath]);
      } catch (permError) {
        console.error('Failed to revoke permissions after direct directory deletion:', permError);
      }
      
      return res.json({
        message: 'File deleted successfully',
        deletedPaths: [filePath],
        deletedDirPrefixes: [filePath],
        skippedPaths: [],
      });
    }

    const canEnterDirectory = async (dirPath) => {
      if (user.is_admin || isOwnerPath(user, dirPath)) return true;
      return await hasDirectFolderPermission(user.id, dirPath, 'write');
    };
    const canDeleteFileByParent = async (parentDir) => canEnterDirectory(parentDir);

    const result = await selectiveDelete({
      rootPath: normalizedTargetPath,
      canEnterDirectory,
      canDeleteFileByParent,
      allowMetaPath: user.is_admin && isMetaPath(normalizedTargetPath),
    });

    try {
      const prefixes = (result.deletedDirPrefixes || []).map((p) => normalizePath(p));
      if (prefixes.length > 0) {
        await Permission.revokePermissionsPrefixForAllUsers(prefixes);
      }
    } catch (permError) {
      console.error('Failed to revoke permissions after directory deletion:', permError);
    }

    return res.json({
      message: 'File deleted successfully',
      deletedPaths: result.deletedPaths,
      deletedDirPrefixes: result.deletedDirPrefixes,
      skippedPaths: result.skippedPaths,
    });
  }

  await deleteFile(filePath, { isDirectory: isDir });
  res.json({ message: 'File deleted successfully' });
}));

// Batch delete endpoint
router.post('/batch-delete', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }

  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
  const results = {
    succeeded: [],
    failed: [],
    skipped: [],
    deletedDirPrefixes: []
  };

  const allDeletedDirPrefixes = new Set();

  await asyncLimitSettled(5, paths, async (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      results.failed.push({ path: filePath, error: 'Invalid path' });
      return;
    }

    try {
      const normalizedTargetPath = normalizePath(filePath);
      const isDir = await isDirectoryPath(filePath);
      const hasPermission = isDir
        ? canWriteDirSync(normalizedTargetPath)
        : canWriteFileByParentSync(normalizedTargetPath);
      
      if (!hasPermission) {
        results.skipped.push(filePath);
        return;
      }
      
      if (user.is_admin) {
        try {
          await listDirectory(filePath);
          const normalizedPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
          const pathParts = normalizedPath.split('/').filter(Boolean);
          if (pathParts.length === 1) {
            const folderUsername = pathParts[0];
            const folderUser = await User.findByUsername(folderUsername);
            if (folderUser) {
              results.skipped.push(filePath);
              return;
            }
          }
        } catch (dirError) {
          // Not a directory or doesn't exist, proceed with deletion
        }
      }

      if (isDir) {
        if (user.is_admin || isOwnerPath(user, normalizedTargetPath)) {
          // Direct delete for admin/owner
          await deleteFile(filePath, { isDirectory: isDir });
          
          try {
            await Permission.revokePermissionsPrefixForAllUsers([normalizedTargetPath]);
            allDeletedDirPrefixes.add(normalizedTargetPath);
          } catch (permError) {
            console.error('Failed to revoke permissions after direct directory deletion:', permError);
          }
          
          results.succeeded.push(filePath);
          return;
        }

        const canEnterDirectory = (dirPath) => canWriteDirSync(dirPath);
        const canDeleteFileByParent = (parentDir) => canWriteDirSync(parentDir);

        const result = await selectiveDelete({
          rootPath: normalizedTargetPath,
          canEnterDirectory,
          canDeleteFileByParent,
          allowMetaPath: user.is_admin && isMetaPath(normalizedTargetPath),
        });

        try {
          const prefixes = (result.deletedDirPrefixes || []).map((p) => normalizePath(p));
          if (prefixes.length > 0) {
            await Permission.revokePermissionsPrefixForAllUsers(prefixes);
            prefixes.forEach(p => allDeletedDirPrefixes.add(p));
          }
        } catch (permError) {
          console.error('Failed to revoke permissions after directory deletion:', permError);
        }

        results.succeeded.push(filePath);
        if (result.skippedPaths && result.skippedPaths.length > 0) {
          result.skippedPaths.forEach(p => results.skipped.push(p));
        }
      } else {
        await deleteFile(filePath, { isDirectory: isDir });
        results.succeeded.push(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete ${filePath}:`, error);
      const errorStatus = error.status || error.response?.status;
      if (errorStatus === 403 || errorStatus === 401) {
        results.skipped.push(filePath);
      } else {
        results.failed.push({ 
          path: filePath, 
          error: error.message || 'Unknown error' 
        });
      }
    }
  });

  res.json({
    message: 'Batch delete completed',
    succeeded: results.succeeded,
    failed: results.failed,
    skipped: results.skipped,
    deletedDirPrefixes: Array.from(allDeletedDirPrefixes)
  });
}));

router.put('/rename', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) {
    throw validationError('Old path and new name are required');
  }

  const user = req.user.full;

  const isDir = await isDirectoryPath(oldPath);
  const normalizedOld = normalizePath(oldPath);
  const hasPermission = isDir
    ? await canWriteFolder(user, normalizedOld)
    : await canWriteFileByParent(user, normalizedOld);

  if (!hasPermission) {
    throw forbiddenError('Access denied');
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
    throw conflictError(`파일 이름 변경 실패: "${newName}" 이름의 파일이 이미 존재합니다.`);
  }

  await moveFile(oldPath, newPath, null, false, { isDirectory: isDir });
  if (isDir) {
    try {
      const normalizedNew = normalizePath(newPath);
      await Permission.rewritePermissionsForAllUsers([{ fromPrefix: normalizedOld, toPrefix: normalizedNew }]);
    } catch (permError) {
      console.error('Failed to rewrite permissions after directory rename:', permError);
    }
  }
  res.json({ message: 'File renamed successfully', path: newPath });
}));

router.put('/move', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { sourcePath, destinationPath, onConflict } = req.body;
  if (!sourcePath || !destinationPath) {
    throw validationError('Source and destination paths are required');
  }

  const user = req.user.full;
  const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedDestinationPath = normalizePath(destinationPath);
    const isSourceDir = await isDirectoryPath(sourcePath);
    const hasSourcePermission = isSourceDir
      ? await canWriteFolder(user, normalizedSourcePath)
      : await canWriteFileByParent(user, normalizedSourcePath);
    
  if (!hasSourcePermission) {
    throw forbiddenError('Access denied');
  }

  // Destination parent write permission (direct-only, admin/owner bypass)
  const destParentPath = path.posix.dirname(normalizedDestinationPath) || '/';
  const hasDestPermission = await canWriteFolder(user, destParentPath);
  
  if (!hasDestPermission) {
    throw forbiddenError('Access denied');
  }

  const destExists = await pathExists(destinationPath);
  if (destExists && onConflict !== 'overwrite' && onConflict !== 'skip') {
    throw conflictError('대상 디렉토리에 같은 이름의 파일이 이미 존재합니다');
  }

  if (destExists && onConflict === 'skip') {
    return res.json({ message: 'Move skipped', path: destinationPath, skipped: true });
  }

  if (isSourceDir) {
    if (user.is_admin || isOwnerPath(user, normalizedSourcePath)) {
      const overwrite = onConflict === 'overwrite';
      await moveFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
      
      try {
        await Permission.rewritePermissionsForAllUsers([{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }]);
      } catch (permError) {
        console.error('Failed to rewrite permissions after direct move:', permError);
      }
      
      return res.json({
        message: 'Directory moved successfully',
        movedDirMappings: [{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }],
        skippedPaths: [],
      });
    }

    const canEnterDirectory = async (dirPath) => {
      if (user.is_admin || isOwnerPath(user, dirPath)) return true;
      return await hasDirectFolderPermission(user.id, dirPath, 'write');
    };
    const canTransferFile = async (parentDir) => canEnterDirectory(parentDir);

    const result = await selectiveTransfer({
      sourceRoot: normalizedSourcePath,
      destRoot: normalizedDestinationPath,
      mode: 'move',
      canEnterDirectory,
      canTransferFile,
      onConflict: onConflict || 'error',
    });

    // Always rewrite root prefix, but keep skipped subtrees' ACL in place.
    try {
      const excludePrefixes = (result.skippedPaths || [])
        .map((p) => normalizePath(p))
        .filter((p) => p !== normalizedSourcePath && p.startsWith(`${normalizedSourcePath}/`));

      const rootMovedFully = (result.movedDirMappings || []).some(
        (m) => normalizePath(m.fromPrefix) === normalizedSourcePath
      );

      await Permission.rewritePermissionsForAllUsers(
        [{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }],
        {
          excludePrefixes,
          // If source root still exists (partial move), keep exact "/a" ACL for traversal to skipped subtrees
          // while also granting it on "/1/a".
          duplicateExactMatches: !rootMovedFully,
        }
      );
    } catch (permError) {
      console.error('Failed to rewrite permissions after move:', permError);
    }

    if (result.movedDirMappings.length > 0) {
      try {
        await Permission.rewritePermissionsForAllUsers(result.movedDirMappings);
      } catch (permError) {
        console.error('Failed to rewrite permissions after move:', permError);
      }
    }

    return res.json({
      message: 'Directory moved (selective) successfully',
      movedDirMappings: result.movedDirMappings,
      skippedPaths: result.skippedPaths,
    });
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
    const overwrite = onConflict === 'overwrite';
    await moveFile(sourcePath, destinationPath, progressCallback, overwrite, { isDirectory: false });
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
}));

// Helper to handle onConflict in single operations
const handleSingleOpConflict = async (destPath, onConflict) => {
  const destExists = await pathExists(destPath);
  if (destExists) {
    if (onConflict === 'skip') return 'skip';
    if (onConflict !== 'overwrite') {
      throw conflictError('대상 디렉토리에 같은 이름의 파일이 이미 존재합니다');
    }
    return 'overwrite';
  }
  return 'none';
};

// Batch move endpoint
router.post('/batch-move', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { moves, onConflict } = req.body; // [{sourcePath, destinationPath}, ...]
  
  if (!moves || !Array.isArray(moves) || moves.length === 0) {
    throw validationError('Moves array is required');
  }

  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
  const results = {
    succeeded: [],
    failed: [],
    skipped: [],
    movedDirMappings: []
  };

  const allMovedDirMappings = [];

  // Concurrency 1: WebDAV MOVE fails with 500 when multiple MOVE requests run in parallel (single move works).
  await asyncLimitSettled(1, moves, async (move) => {
    const { sourcePath, destinationPath } = move;
    
    if (!sourcePath || !destinationPath) {
      results.failed.push({ 
        sourcePath: sourcePath || 'unknown', 
        destinationPath: destinationPath || 'unknown',
        error: 'Source and destination paths are required' 
      });
      return;
    }

    try {
      const normalizedSourcePath = normalizePath(sourcePath);
      const normalizedDestinationPath = normalizePath(destinationPath);
      const isSourceDir = await isDirectoryPath(sourcePath);
      const hasSourcePermission = isSourceDir
        ? canWriteDirSync(normalizedSourcePath)
        : canWriteFileByParentSync(normalizedSourcePath);
      
      if (!hasSourcePermission) {
        results.skipped.push(sourcePath);
        return;
      }

      const destParentPath = path.posix.dirname(normalizedDestinationPath) || '/';
      const hasDestPermission = canWriteDirSync(destParentPath);
      
      if (!hasDestPermission) {
        results.skipped.push(sourcePath);
        return;
      }

      const conflictStatus = await handleSingleOpConflict(destinationPath, onConflict);
      if (conflictStatus === 'skip') {
        results.skipped.push(sourcePath);
        return;
      }

      if (isSourceDir) {
        if (user.is_admin || isOwnerPath(user, normalizedSourcePath)) {
          const overwrite = onConflict === 'overwrite';
          await moveFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
          
          try {
            await Permission.rewritePermissionsForAllUsers([{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }]);
            allMovedDirMappings.push({ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath });
          } catch (permError) {
            console.error('Failed to rewrite permissions after direct move:', permError);
          }
          
          results.succeeded.push({ sourcePath, destinationPath });
          return;
        }

        const canEnterDirectory = (dirPath) => canWriteDirSync(dirPath);
        const canTransferFile = (parentDir) => canWriteDirSync(parentDir);

        const result = await selectiveTransfer({
          sourceRoot: normalizedSourcePath,
          destRoot: normalizedDestinationPath,
          mode: 'move',
          canEnterDirectory,
          canTransferFile,
          onConflict: onConflict || 'error',
        });

        try {
          const excludePrefixes = (result.skippedPaths || [])
            .map((p) => normalizePath(p))
            .filter((p) => p !== normalizedSourcePath && p.startsWith(`${normalizedSourcePath}/`));

          const rootMovedFully = (result.movedDirMappings || []).some(
            (m) => normalizePath(m.fromPrefix) === normalizedSourcePath
          );

          await Permission.rewritePermissionsForAllUsers(
            [{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }],
            {
              excludePrefixes,
              duplicateExactMatches: !rootMovedFully,
            }
          );
        } catch (permError) {
          console.error('Failed to rewrite permissions after move:', permError);
        }

        if (result.movedDirMappings.length > 0) {
          try {
            await Permission.rewritePermissionsForAllUsers(result.movedDirMappings);
            allMovedDirMappings.push(...result.movedDirMappings);
          } catch (permError) {
            console.error('Failed to rewrite permissions after move:', permError);
          }
        }

        results.succeeded.push({ sourcePath, destinationPath });
        if (result.skippedPaths && result.skippedPaths.length > 0) {
          result.skippedPaths.forEach(p => results.skipped.push(p));
        }
      } else {
        const overwrite = onConflict === 'overwrite';
        await moveFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
        results.succeeded.push({ sourcePath, destinationPath });
      }
    } catch (error) {
      console.error(`Failed to move ${sourcePath} to ${destinationPath}:`, error);
      const errorStatus = error.status || error.response?.status;
      if (errorStatus === 403 || errorStatus === 401) {
        results.skipped.push(sourcePath);
      } else {
        results.failed.push({ 
          sourcePath, 
          destinationPath, 
          error: error.message || 'Unknown error' 
        });
      }
    }
  });

  res.json({
    message: 'Batch move completed',
    succeeded: results.succeeded,
    failed: results.failed,
    skipped: results.skipped,
    movedDirMappings: allMovedDirMappings
  });
}));

router.post('/copy', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { sourcePath, destinationPath, onConflict } = req.body;
  if (!sourcePath || !destinationPath) {
    throw validationError('Source and destination paths are required');
  }

  const user = req.user.full;

  // Source read permission (effective/inherited)
  const isSourceDir = await isDirectoryPath(sourcePath);
  const hasSourcePermission = isSourceDir
    ? await canReadFolder(req.user.id, sourcePath, 'read')
    : await canReadFile(req.user.id, sourcePath, 'read');
  if (!hasSourcePermission) {
    throw forbiddenError('Access denied');
  }

  // Destination parent write permission (direct-only, admin/owner bypass)
  const normalizedDest = normalizePath(destinationPath);
  const destParentPath = path.posix.dirname(normalizedDest) || '/';
  const hasDestPermission = await canWriteFolder(user, destParentPath);
  if (!hasDestPermission) {
    throw forbiddenError('Access denied');
  }

  const conflictStatus = await handleSingleOpConflict(destinationPath, onConflict);
  if (conflictStatus === 'skip') {
    return res.json({ message: 'Copy skipped', path: destinationPath, skipped: true });
  }

  if (isSourceDir) {
    if (user.is_admin || isOwnerPath(user, sourcePath)) {
      const overwrite = onConflict === 'overwrite';
      await copyFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
      
      try {
        await Permission.grant(req.user.id, normalizedDest, 'write');
      } catch (permError) {
        console.error('Failed to grant executor permissions after direct copy:', permError);
      }
      
      return res.json({
        message: 'Directory copied successfully',
        createdDirs: [normalizedDest],
        skippedPaths: [],
      });
    }

    const normalizedSource = normalizePath(sourcePath);

    const canEnterDirectory = async (dirPath) => {
      if (user.is_admin || isOwnerPath(user, dirPath)) return true;
      return await hasDirectFolderPermission(user.id, dirPath, 'read');
    };
    const canTransferFile = async (parentDir) => canEnterDirectory(parentDir);

    const okRoot = await canEnterDirectory(normalizedSource);
    if (!okRoot) {
      throw forbiddenError('Access denied');
    }

    const result = await selectiveTransfer({
      sourceRoot: normalizedSource,
      destRoot: normalizedDest,
      mode: 'copy',
      canEnterDirectory,
      canTransferFile,
      onConflict: onConflict || 'error',
    });

    // executor_only: grant write to created directories for the executor
    try {
      for (const dir of result.createdDirs) {
        await Permission.grant(req.user.id, dir, 'write');
      }
    } catch (permError) {
      console.error('Failed to grant executor permissions after copy:', permError);
    }

    return res.json({
      message: 'Directory copied (selective) successfully',
      createdDirs: result.createdDirs,
      skippedPaths: result.skippedPaths,
    });
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
    const overwrite = onConflict === 'overwrite';
    await copyFile(sourcePath, destinationPath, progressCallback, overwrite, { isDirectory: false });
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
}));

// Batch copy endpoint
router.post('/batch-copy', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { copies, onConflict } = req.body; // [{sourcePath, destinationPath}, ...]
  
  if (!copies || !Array.isArray(copies) || copies.length === 0) {
    throw validationError('Copies array is required');
  }

  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);
  const canReadDirSync = buildSyncReadChecker(user, doc);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const results = {
    succeeded: [],
    failed: [],
    skipped: [],
    createdDirs: []
  };

  const allCreatedDirs = new Set();

  // Concurrency 1: WebDAV COPY fails with 500 when multiple COPY requests run in parallel (single copy works).
  await asyncLimitSettled(1, copies, async (copy) => {
    const { sourcePath, destinationPath } = copy;
    
    if (!sourcePath || !destinationPath) {
      results.failed.push({ 
        sourcePath: sourcePath || 'unknown', 
        destinationPath: destinationPath || 'unknown',
        error: 'Source and destination paths are required' 
      });
      return;
    }

    try {
      const isSourceDir = await isDirectoryPath(sourcePath);
      const normalizedSource = normalizePath(sourcePath);
      const hasSourcePermission = isSourceDir
        ? canReadDirSync(normalizedSource)
        : canReadDirSync(path.posix.dirname(normalizedSource) || '/');
      
      if (!hasSourcePermission) {
        results.skipped.push(sourcePath);
        return;
      }

      const normalizedDest = normalizePath(destinationPath);
      const destParentPath = path.posix.dirname(normalizedDest) || '/';
      const hasDestPermission = canWriteDirSync(destParentPath);
      
      if (!hasDestPermission) {
        results.skipped.push(sourcePath);
        return;
      }

      const conflictStatus = await handleSingleOpConflict(destinationPath, onConflict);
      if (conflictStatus === 'skip') {
        results.skipped.push(sourcePath);
        return;
      }

      if (isSourceDir) {
        if (user.is_admin || isOwnerPath(user, sourcePath)) {
          const overwrite = onConflict === 'overwrite';
          await copyFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
          
          try {
            await Permission.grant(req.user.id, normalizedDest, 'write');
            allCreatedDirs.add(normalizedDest);
          } catch (permError) {
            console.error('Failed to grant executor permissions after direct copy:', permError);
          }
          
          results.succeeded.push({ sourcePath, destinationPath });
          return;
        }

        const canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
        const canTransferFile = (parentDir) => canReadDirSync(parentDir);

        const okRoot = canEnterDirectory(normalizedSource);
        if (!okRoot) {
          results.skipped.push(sourcePath);
          return;
        }

        const result = await selectiveTransfer({
          sourceRoot: normalizedSource,
          destRoot: normalizedDest,
          mode: 'copy',
          canEnterDirectory,
          canTransferFile,
          onConflict: onConflict || 'error',
        });

        try {
          for (const dir of result.createdDirs) {
            await Permission.grant(req.user.id, dir, 'write');
            allCreatedDirs.add(dir);
          }
        } catch (permError) {
          console.error('Failed to grant executor permissions after copy:', permError);
        }

        results.succeeded.push({ sourcePath, destinationPath });
        if (result.skippedPaths && result.skippedPaths.length > 0) {
          result.skippedPaths.forEach(p => results.skipped.push(p));
        }
      } else {
        const overwrite = onConflict === 'overwrite';
        await copyFile(sourcePath, destinationPath, null, overwrite, { isDirectory: isSourceDir });
        results.succeeded.push({ sourcePath, destinationPath });
      }
    } catch (error) {
      console.error(`Failed to copy ${sourcePath} to ${destinationPath}:`, error);
      const errorStatus = error.status || error.response?.status;
      if (errorStatus === 403 || errorStatus === 401) {
        results.skipped.push(sourcePath);
      } else {
        results.failed.push({ 
          sourcePath, 
          destinationPath, 
          error: error.message || 'Unknown error' 
        });
      }
    }
  });

  res.json({
    message: 'Batch copy completed',
    succeeded: results.succeeded,
    failed: results.failed,
    skipped: results.skipped,
    createdDirs: Array.from(allCreatedDirs)
  });
}));

router.get('/thumbnail/:hash', asyncHandler(async (req, res) => {
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
    throw notFoundError('Thumbnail not found');
  }
}));

router.post('/thumbnails/batch', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }
  
  const { ensureThumbnailsBatch } = require('../utils/thumbnail');
  const results = await ensureThumbnailsBatch(paths);
  
  res.json({ thumbnails: results });
}));

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

router.post('/download-multiple', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { paths } = req.body;
  
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }

  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);
  const canReadDirSync = buildSyncReadChecker(user, doc);
  const canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
  const canIncludeFile = (parentDir) => canReadDirSync(parentDir);

    const skippedPaths = [];

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
          const collected = await selectiveCollectFiles({
            rootPath: filePath,
            basePath: dirName,
            canEnterDirectory,
            canIncludeFile,
          });
          allFiles.push(...collected.files);
          skippedPaths.push(...collected.skippedPaths);
        } else {
          const fileName = path.basename(filePath);
          
          if (paths.length === 1) {
            const parentDir = path.dirname(filePath);
            if (parentDir && parentDir !== '/') {
              zipName = path.basename(parentDir) || 'download';
            } else {
              zipName = fileName.replace(/\.[^/.]+$/, '');
            }
            const parentDirForPerm = path.posix.dirname(normalizePath(filePath)) || '/';
            const ok = await canIncludeFile(parentDirForPerm);
            if (!ok) {
              skippedPaths.push(filePath);
            } else {
              allFiles.push({ path: filePath, relativePath: fileName });
            }
          } else {
            if (commonParentDir && commonParentDir !== '/') {
              const relativePath = filePath.replace(commonParentDir, '').replace(/^\//, '');
              const parentDirForPerm = path.posix.dirname(normalizePath(filePath)) || '/';
              const ok = await canIncludeFile(parentDirForPerm);
              if (!ok) {
                skippedPaths.push(filePath);
              } else {
                allFiles.push({ path: filePath, relativePath });
              }
            } else {
              const parentDirForPerm = path.posix.dirname(normalizePath(filePath)) || '/';
              const ok = await canIncludeFile(parentDirForPerm);
              if (!ok) {
                skippedPaths.push(filePath);
              } else {
                allFiles.push({ path: filePath, relativePath: fileName });
              }
            }
          }
        }
      } catch (error) {
        const fileName = path.basename(filePath);
        // If we can't determine type, treat as file and apply direct-only read check
        const parentDirForPerm = path.posix.dirname(normalizePath(filePath)) || '/';
        const ok = await canIncludeFile(parentDirForPerm);
        if (!ok) {
          skippedPaths.push(filePath);
        } else {
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
    }

  if (allFiles.length === 0) {
    throw forbiddenError('Access denied');
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
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-WEA-Skipped-Count, X-WEA-Skipped');
    res.setHeader('X-WEA-Skipped-Count', String(skippedPaths.length));
    try {
      const maxLen = 7000;
      let payload = {
        paths: skippedPaths.slice(0, 100),
        truncated: skippedPaths.length > 100,
      };
      let encoded = encodeURIComponent(JSON.stringify(payload));

      // Keep the header parseable: shrink list instead of slicing percent-encoded data.
      while (encoded.length > maxLen && payload.paths.length > 0) {
        payload.paths.pop();
        payload.truncated = true;
        encoded = encodeURIComponent(JSON.stringify(payload));
      }

      if (encoded.length > maxLen) {
        encoded = encodeURIComponent(JSON.stringify({ paths: [], truncated: true }));
      }

      res.setHeader('X-WEA-Skipped', encoded);
    } catch {
      res.setHeader('X-WEA-Skipped', encodeURIComponent(JSON.stringify({ paths: [], truncated: true })));
    }
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
}));

router.get('/download-progress/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = downloadProgress.get(id);
  
  if (!progress) {
    throw notFoundError('Download progress not found');
  }
  
  res.json(progress);
}));

router.get('/operation-progress/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = operationProgress.get(id);
  
  if (!progress) {
    throw notFoundError('Operation progress not found');
  }
  
  res.json(progress);
}));

module.exports = router;

