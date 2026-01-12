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
  const user = await User.findById(userId);
  if (!user) {
    return false;
  }

  const folderPath = path.dirname(filePath) || '/';
  
  // 디렉토리 경로 정규화 (끝에 / 추가)
  const normalizedFolderPath = folderPath === '/' ? '/' : (folderPath.endsWith('/') ? folderPath : folderPath + '/');
  
  // 정확한 경로에 권한이 있는지 먼저 체크
  let hasPermission = await Permission.checkPermission(userId, normalizedFolderPath, requiredPermission);
  
  // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
  if (!hasPermission && !normalizedFolderPath.endsWith('/') && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  }
  
  // 상위 경로들을 체크 (예: /a/b/c -> /a/b, /a, /)
  if (!hasPermission && normalizedFolderPath !== '/') {
    const pathParts = normalizedFolderPath.split('/').filter(Boolean);
    for (let i = pathParts.length; i > 0; i--) {
      const parentPath = '/' + pathParts.slice(0, i).join('/') + '/';
      hasPermission = await Permission.checkPermission(userId, parentPath, requiredPermission);
      if (hasPermission) {
        break;
      }
    }
  }
  
  // 루트 경로 체크
  if (!hasPermission && normalizedFolderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, '/', requiredPermission);
  }
  
  // 비관리자의 경우 자신의 폴더인지 확인
  if (!hasPermission && !user.is_admin) {
    const userFolder = `/${user.username}`;
    if (normalizedFolderPath.startsWith(userFolder) || folderPath.startsWith(userFolder)) {
      hasPermission = true;
    }
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
    
    // 경로 정규화 (끝에 / 제거)
    folderPath = folderPath.trim();
    if (!folderPath.startsWith('/')) {
      folderPath = '/' + folderPath;
    }
    if (folderPath !== '/' && folderPath.endsWith('/')) {
      folderPath = folderPath.slice(0, -1);
    }
    folderPath = folderPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    
    // 권한 체크를 먼저 수행 (상위 경로 포함)
    // 디렉토리 경로 정규화 (끝에 / 추가)
    const normalizedDirPath = folderPath === '/' ? '/' : folderPath + '/';
    let hasPermission = await Permission.checkPermission(req.user.id, normalizedDirPath, 'read');
    
    // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
    if (!hasPermission && folderPath !== '/') {
      hasPermission = await Permission.checkPermission(req.user.id, folderPath, 'read');
    }
    
    // 상위 경로들을 체크 (예: /a/b/c -> /a/b, /a, /)
    if (!hasPermission && folderPath !== '/') {
      const pathParts = folderPath.split('/').filter(Boolean);
      for (let i = pathParts.length; i > 0; i--) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        const parentDirPath = parentPath + '/';
        
        // 부모 경로에 직접 권한이 있는지 확인
        const parentHasPermission = await Permission.checkPermission(req.user.id, parentDirPath, 'read');
        if (parentHasPermission) {
          hasPermission = true;
          break;
        }
        
        // 부모 경로 끝에 /가 없는 경우도 체크
        if (!parentHasPermission) {
          const parentHasPermissionNoSlash = await Permission.checkPermission(req.user.id, parentPath, 'read');
          if (parentHasPermissionNoSlash) {
            hasPermission = true;
            break;
          }
        }
      }
    }
    
    // 루트 경로 체크
    if (!hasPermission && folderPath !== '/') {
      hasPermission = await Permission.checkPermission(req.user.id, '/', 'read');
    }
    
    if (!hasPermission) {
      // 관리자는 모든 경로에 접근 가능
      if (user.is_admin) {
        // 권한 체크 건너뛰기
      } else {
        // 권한이 없으면, 비관리자의 경우 자신의 폴더인지 확인
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

    const items = await listDirectory(folderPath);
    const { ensureThumbnail } = require('../utils/thumbnail');
    
    // 각 항목에 대한 권한 체크 및 필터링
    const itemsWithThumbnails = await Promise.all(
      items.map(async (item) => {
        // 경로 구성: folderPath와 basename을 조합하여 직접 자식만 표시되도록 함
        // folderPath는 이미 정규화되어 있고 끝에 /가 없음
        // basename이 경로 구분자를 포함하지 않도록 검증 (직접 자식만)
        if (!item.basename || item.basename.includes('/') || item.basename.includes('\\')) {
          // basename이 경로를 포함하고 있으면 직접 자식이 아니므로 필터링
          return null;
        }
        
        const cleanFolderPath = folderPath === '/' ? '/' : folderPath;
        const fullPath = cleanFolderPath === '/' 
          ? '/' + item.basename 
          : cleanFolderPath + '/' + item.basename;
        
        // 경로 정규화 (중복 슬래시 제거)
        const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        
        // 권한 체크 (모든 항목에 대해)
        let hasReadPermission = true;
        let hasWritePermission = true;
        
        if (item.type === 'directory') {
          // 관리자는 모든 디렉토리에 접근 가능
          if (user.is_admin) {
            hasReadPermission = true;
            hasWritePermission = true;
          } else {
            // 디렉토리 경로 정규화 (끝에 / 추가)
            const normalizedDirPath = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
            
            // 해당 경로에 직접 권한이 있는지 확인 (상위 경로 체크 제거 - 각 폴더의 직접 권한만 확인)
            hasReadPermission = await Permission.checkPermission(req.user.id, normalizedDirPath, 'read');
            
            // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
            if (!hasReadPermission && !normalizedPath.endsWith('/')) {
              hasReadPermission = await Permission.checkPermission(req.user.id, normalizedPath, 'read');
            }
            
            // 비관리자의 경우 자신의 폴더인지 확인 (항상 표시)
            if (!hasReadPermission) {
              const userFolder = `/${user.username}`;
              if (normalizedPath.startsWith(userFolder) || normalizedDirPath.startsWith(userFolder)) {
                hasReadPermission = true;
                hasWritePermission = true;
              }
            }
            
            // 참고: 상위 경로에 권한이 있어도 하위 폴더에 직접 권한이 없으면
            // hasReadPermission은 false로 설정되어 비활성화 상태로 표시됨
            
            // 쓰기 권한 체크
            if (hasReadPermission) {
              hasWritePermission = await Permission.checkPermission(req.user.id, normalizedDirPath, 'write');
              if (!hasWritePermission && !normalizedPath.endsWith('/')) {
                hasWritePermission = await Permission.checkPermission(req.user.id, normalizedPath, 'write');
              }
              
              // 자신의 폴더인 경우 쓰기 권한 확인
              if (!hasWritePermission) {
                const userFolder = `/${user.username}`;
                if (normalizedPath.startsWith(userFolder) || normalizedDirPath.startsWith(userFolder)) {
                  hasWritePermission = true;
                }
              }
            }
          }
        }
        
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
          hasReadPermission,
          hasWritePermission,
        };
      })
    );

    // 모든 항목 반환 (권한 정보 포함)
    // 직접 권한이 없는 디렉토리도 표시하되, 비활성화 상태로 표시됨
    res.json(itemsWithThumbnails.filter(item => item !== null));
  } catch (error) {
    // 404 에러는 폴더가 존재하지 않는 경우이므로 빈 배열 반환
    if (error.message && (error.message.includes('404') || error.message.includes('Not Found'))) {
      // 디버그 로그만 출력 (에러로 처리하지 않음)
      console.log(`Folder not found (404): ${req.query.path || '/'}`);
      return res.json([]);
    }
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
    const relativePath = req.body.relativePath || ''; // Support for nested folder uploads
    
    const user = await User.findById(req.user.id);
    
    // 관리자는 모든 경로에 파일 업로드 가능
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        folderPath = userFolder;
      } else if (!folderPath.startsWith(userFolder)) {
        // 공유된 폴더인지 권한 체크
        // 먼저 경로 정규화
        if (!folderPath.startsWith('/')) {
          folderPath = '/' + folderPath;
        }
        if (folderPath !== '/' && !folderPath.endsWith('/')) {
          folderPath = folderPath + '/';
        }
        
        // 폴더 경로에 대한 쓰기 권한 체크 - 해당 폴더에 직접 쓰기 권한이 있어야 함 (상위 경로 체크 안 함)
        // 경로 정규화
        let normalizedFolderPath = folderPath;
        if (normalizedFolderPath !== '/') {
          if (!normalizedFolderPath.endsWith('/')) {
            normalizedFolderPath = normalizedFolderPath + '/';
          }
        }
        // 해당 폴더에 직접 쓰기 권한이 있는지 확인 (상위 경로 체크 제거)
        // 경로 끝에 /가 있는 경우와 없는 경우 모두 체크
        let hasPermission = await Permission.checkPermission(req.user.id, normalizedFolderPath, 'write');
        if (!hasPermission && folderPath !== '/') {
          hasPermission = await Permission.checkPermission(req.user.id, folderPath, 'write');
        }
        if (!hasPermission) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }
    
    // 경로 정규화
    if (!folderPath.startsWith('/')) {
      folderPath = '/' + folderPath;
    }
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
                
                // Auto-grant permissions to folder owner if within user's home directory
                const allUsers = await User.findAll();
                for (const targetUser of allUsers) {
                  const userHomeFolder = `/${targetUser.username}/`;
                  if (currentPath.startsWith(userHomeFolder)) {
                    await Permission.grant(targetUser.id, currentPath, 'write');
                  }
                }
              } catch (permError) {
                console.error('Failed to grant permissions for intermediate directory:', permError);
              }
            } catch (createError) {
              // Directory might already exist or be created by another request
              console.log('Directory creation skipped or failed:', currentPath, createError.message);
            }
          }
        }
      }
    }
    
    const filePath = finalFolderPath === '/' 
      ? '/' + originalFilename 
      : (finalFolderPath + originalFilename).replace(/\\/g, '/').replace(/\/+/g, '/');

    // Check if file already exists
    const fileExists = await pathExists(filePath);
    
    if (fileExists) {
      return res.status(409).json({ 
        error: `파일 업로드 실패: "${originalFilename}" 이름의 파일이 이미 존재합니다.` 
      });
    }

    // 최종 권한 체크는 이미 위에서 완료됨 (folderPath에 대한 권한 체크)
    // 파일 경로 자체에 대한 추가 체크는 불필요 (부모 폴더 권한으로 충분)

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

    const user = await User.findById(req.user.id);
    const folderPath = path.dirname(filePath) || '/';
    // 경로 정규화: 끝에 / 추가 (권한 DB 형식과 일치)
    const normalizedFolderPath = folderPath === '/' ? '/' : (folderPath.endsWith('/') ? folderPath : folderPath + '/');
    
    // 관리자는 모든 경로에 삭제 가능
    let hasPermission = false;
    if (user.is_admin) {
      hasPermission = true;
    } else {
      const userFolder = `/${user.username}`;
      // 자신의 폴더인 경우
      if (normalizedFolderPath.startsWith(userFolder) || folderPath.startsWith(userFolder)) {
        hasPermission = true;
      } else {
        // 공유받은 폴더인 경우 직접 권한만 체크 (상위 경로 체크 안 함)
        // 경로 끝에 /가 있는 경우와 없는 경우 모두 체크
        hasPermission = await Permission.checkPermission(req.user.id, normalizedFolderPath, 'write');
        if (!hasPermission && folderPath !== '/') {
          hasPermission = await Permission.checkPermission(req.user.id, folderPath, 'write');
        }
      }
    }
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user && user.is_admin) {
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
            return res.status(400).json({ 
              error: `이 폴더는 사용자 "${folderUsername}"의 루트 디렉토리입니다. 사용자가 존재하는 동안 삭제할 수 없습니다.\n\n사용자를 먼저 삭제한 후 폴더를 삭제해주세요.`,
            });
          }
          // 사용자가 존재하지 않으면 삭제 가능
        }
        // 하위 디렉토리나 다른 경로는 권한 체크 없이 삭제 가능
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

    const user = await User.findById(req.user.id);
    
    // 소스 파일의 부모 디렉토리 권한 확인
    const sourceParentPath = path.dirname(sourcePath) || '/';
    const normalizedSourceParentPath = sourceParentPath === '/' ? '/' : (sourceParentPath.endsWith('/') ? sourceParentPath : sourceParentPath + '/');
    
    let hasSourcePermission = false;
    if (user.is_admin) {
      hasSourcePermission = true;
    } else {
      const userFolder = `/${user.username}`;
      // 자신의 폴더인 경우
      if (normalizedSourceParentPath.startsWith(userFolder) || sourceParentPath.startsWith(userFolder)) {
        hasSourcePermission = true;
      } else {
        // 공유받은 폴더인 경우 직접 권한만 체크 (상위 경로 체크 안 함)
        // 경로 끝에 /가 있는 경우와 없는 경우 모두 체크
        hasSourcePermission = await Permission.checkPermission(req.user.id, normalizedSourceParentPath, 'write');
        if (!hasSourcePermission && sourceParentPath !== '/') {
          hasSourcePermission = await Permission.checkPermission(req.user.id, sourceParentPath, 'write');
        }
      }
    }
    
    if (!hasSourcePermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 대상 경로의 부모 디렉토리 권한 확인
    const destParentPath = path.dirname(destinationPath) || '/';
    const normalizedDestParentPath = destParentPath === '/' ? '/' : (destParentPath.endsWith('/') ? destParentPath : destParentPath + '/');
    
    let hasDestPermission = false;
    if (user.is_admin) {
      hasDestPermission = true;
    } else {
      const userFolder = `/${user.username}`;
      // 자신의 폴더인 경우
      if (normalizedDestParentPath.startsWith(userFolder) || destParentPath.startsWith(userFolder)) {
        hasDestPermission = true;
      } else {
        // 공유받은 폴더인 경우 직접 권한만 체크 (상위 경로 체크 안 함)
        // 경로 끝에 /가 있는 경우와 없는 경우 모두 체크
        hasDestPermission = await Permission.checkPermission(req.user.id, normalizedDestParentPath, 'write');
        if (!hasDestPermission && destParentPath !== '/') {
          hasDestPermission = await Permission.checkPermission(req.user.id, destParentPath, 'write');
        }
      }
    }
    
    if (!hasDestPermission) {
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

    // 소스 파일의 읽기 권한 확인
    const hasSourcePermission = await checkFilePermission(req.user.id, sourcePath, 'read');
    if (!hasSourcePermission) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 대상 경로의 부모 디렉토리 권한 확인
    const destParentPath = path.dirname(destinationPath) || '/';
    const user = await User.findById(req.user.id);
    let hasDestPermission = await Permission.checkPermission(req.user.id, destParentPath, 'write');
    
    // 상위 경로들을 체크
    if (!hasDestPermission && destParentPath !== '/') {
      const pathParts = destParentPath.split('/').filter(Boolean);
      for (let i = pathParts.length; i > 0; i--) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        hasDestPermission = await Permission.checkPermission(req.user.id, parentPath, 'write');
        if (hasDestPermission) {
          break;
        }
      }
    }
    
    // 루트 경로 체크
    if (!hasDestPermission && destParentPath !== '/') {
      hasDestPermission = await Permission.checkPermission(req.user.id, '/', 'write');
    }
    
    // 비관리자의 경우 자신의 폴더인지 확인
    if (!hasDestPermission && !user.is_admin) {
      const userFolder = `/${user.username}`;
      if (destParentPath.startsWith(userFolder)) {
        hasDestPermission = true;
      }
    }
    
    if (!hasDestPermission) {
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

