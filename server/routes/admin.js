const express = require('express');
const router = express.Router();
const {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const User = require('../models/User');
const Permission = require('../models/Permission');
const PermissionRequest = require('../models/PermissionRequest');
const Settings = require('../models/Settings');
const { authenticateToken } = require('../utils/auth');
const { sendApprovalEmail, sendRejectionEmail } = require('../utils/email');
const { createDirectory } = require('../utils/webdav');
const { createError } = require('../utils/errorHandler');

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '권한 확인 중 문제가 발생했습니다.' });
  }
};

// Get settings
router.get('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const settings = await Settings.getAll();
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '설정을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Update settings
router.put('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { registration_enabled } = req.body;
    
    if (registration_enabled !== undefined) {
      await Settings.set('registration_enabled', String(registration_enabled));
    }
    
    const settings = await Settings.getAll();
    res.json({ 
      message: '설정이 저장되었습니다.',
      settings 
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '설정 저장 중 문제가 발생했습니다.' });
  }
});

// Get all pending users
router.get('/users/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findByStatus(USER_STATUS.PENDING);
    res.json(users);
  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 목록을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Get all users with status
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 목록을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Create user (admin only)
router.post('/users', authenticateToken, isAdmin, async (req, res) => {
  const { pathExists } = require('../utils/webdav');
  let createdUser = null;
  
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '사용자명, 이메일, 비밀번호를 모두 입력해주세요.' });
    }

    if (password.length < 6) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '비밀번호는 최소 6자 이상이어야 합니다.' });
    }

    // Check if user already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '이미 사용 중인 사용자명입니다.' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    // Check if folder with same name already exists in WebDAV
    const userFolder = `/${username}`;
    
    // Create user with approved status (skip approval process)
    createdUser = await User.create(username, email, password, false);
    await User.updateStatus(createdUser.id, USER_STATUS.APPROVED);

    // Create user folder or reuse existing one
    try {
      const folderExists = await pathExists(userFolder);
      if (!folderExists) {
        await createDirectory(userFolder);
      }
      
      // Verify folder was created/exists
      const folderExistsAfter = await pathExists(userFolder);
      if (!folderExistsAfter) {
        throw createError(`Failed to verify folder exists: ${userFolder}`, 500);
      }
    } catch (folderError) {
      console.error('[Admin Create] Failed to check or create user folder:', folderError);
      // Rollback user creation
      await User.delete(createdUser.id);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: '사용자 폴더 확인/생성에 실패했습니다. 사용자 계정이 삭제되었습니다.' 
      });
    }

    // Grant permissions
    try {
      await Permission.grant(createdUser.id, userFolder, PERMISSIONS.ADMIN);
      
      // Verify permissions were granted successfully
      const hasPermission = await Permission.checkPermission(createdUser.id, userFolder, PERMISSIONS.ADMIN);
      if (!hasPermission) {
        throw createError('Permission verification failed', 500);
      }
    } catch (permError) {
      console.error('[Admin Create] Failed to grant permissions:', permError);
      // Rollback user creation - permissions are essential
      await User.delete(createdUser.id);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: '사용자 권한 부여에 실패했습니다. 사용자 계정이 삭제되었습니다.' 
      });
    }

    res.status(HTTP_STATUS.CREATED).json({
      message: '사용자가 추가되었습니다.',
      user: { 
        id: createdUser.id, 
        username: createdUser.username, 
        email: createdUser.email, 
        status: USER_STATUS.APPROVED,
        is_admin: false
      }
    });
  } catch (error) {
    console.error('[Admin Create] Create user error:', error);
    // If user was created but something else failed, try to delete
    if (createdUser && createdUser.id) {
      try {
        await User.delete(createdUser.id);
      } catch (deleteError) {
        console.error('[Admin Create] Failed to delete user after error:', deleteError);
      }
    }
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 추가 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Approve user
router.post('/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (user.status !== USER_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '승인 대기 중인 사용자가 아닙니다.' });
    }

    // Update user status
    await User.updateStatus(userId, USER_STATUS.APPROVED);

    // Create user folder or reuse existing one
    const userFolder = `/${user.username}`;
    const { pathExists } = require('../utils/webdav');
    try {
      const folderExists = await pathExists(userFolder);
      if (!folderExists) {
        await createDirectory(userFolder);
      }
      
      // Verify folder was created/exists
      const folderExistsAfter = await pathExists(userFolder);
      if (!folderExistsAfter) {
        throw createError(`Failed to verify folder exists: ${userFolder}`, 500);
      }
    } catch (folderError) {
      console.error(`[Admin] Failed to check or create user folder:`, folderError);
      // Rollback approval
      await User.updateStatus(userId, USER_STATUS.PENDING);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 폴더 확인/생성에 실패했습니다. 관리자에게 문의해주세요.' });
    }

    // Grant permissions
    try {
      await Permission.grant(userId, `/${user.username}`, PERMISSIONS.ADMIN);
      
      // Verify permissions were granted successfully
      const hasPermission = await Permission.checkPermission(userId, `/${user.username}`, PERMISSIONS.ADMIN);
      if (!hasPermission) {
        throw createError('Permission verification failed', 500);
      }
    } catch (permError) {
      console.error(`[Admin] Failed to grant permissions:`, permError);
      // Rollback approval - permissions are essential
      await User.updateStatus(userId, USER_STATUS.PENDING);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: '사용자 권한 부여에 실패했습니다. 승인이 취소되었습니다. 다시 시도해주세요.' 
      });
    }

    // Send approval email
    try {
      await sendApprovalEmail(user.email, user.username);
    } catch (emailError) {
      console.error('[Admin] Failed to send approval email:', emailError);
      // Continue anyway - user is approved
    }

    res.json({ 
      message: '사용자가 승인되었습니다.',
      user: { id: user.id, username: user.username, email: user.email, status: USER_STATUS.APPROVED }
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '승인 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Reject user
router.post('/users/:id/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (user.status !== USER_STATUS.PENDING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '승인 대기 중인 사용자가 아닙니다.' });
    }

    // Send rejection email first
    try {
      await sendRejectionEmail(user.email, user.username);
    } catch (emailError) {
      console.error('[Admin] Failed to send rejection email:', emailError);
      // Continue with deletion even if email fails
    }

    // Clean up permission requests where user is requester
    await PermissionRequest.deleteByRequesterId(userId);

    // Reject permission requests where user is owner
    await PermissionRequest.rejectByOwnerId(userId, req.user.id);

    // Delete user permissions
    await Permission.revokeAllUserPermissions(userId);

    // Delete permission file
    await Permission.deleteUserPermissionsFile(userId);

    // Delete user from database
    await User.delete(userId);

    res.json({ 
      message: '사용자 가입이 거절되었으며, 계정이 삭제되었습니다.',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Reject user error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '거절 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const adminId = req.user.id;
    
    // Prevent admin from deleting themselves
    if (userId === adminId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '자기 자신의 계정은 삭제할 수 없습니다.' });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    // Prevent deleting other admin accounts
    if (user.is_admin) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '다른 관리자 계정은 삭제할 수 없습니다.' });
    }

    // Clean up permission requests where user is requester
    await PermissionRequest.deleteByRequesterId(userId);

    // Reject permission requests where user is owner
    await PermissionRequest.rejectByOwnerId(userId, adminId);

    // Delete user permissions
    await Permission.revokeAllUserPermissions(userId);

    // Delete permission file
    await Permission.deleteUserPermissionsFile(userId);

    // Delete user from database
    await User.delete(userId);

    res.json({ 
      message: '사용자가 삭제되었습니다.',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 삭제 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Get folder list for admin (single level)
router.get('/folders/list', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { listDirectory } = require('../utils/webdav');
    const path = req.query.path || '/';
    
    const items = await listDirectory(path);
    const folders = items
      .filter(item => item.type === 'directory')
      .filter(item => item.basename !== '.wea')
      .map(item => ({
        path: item.filename || item.basename,
        name: item.basename || item.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    res.json(folders);
  } catch (error) {
    console.error('Get folder list error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '폴더 목록을 불러오는데 실패했습니다.' });
  }
});

// Get user permissions
router.get('/users/:id/permissions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const permissions = await Permission.getUserPermissions(userId);
    res.json(permissions);
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '사용자 권한을 불러오는데 실패했습니다.' });
  }
});

// Update user permissions (bulk)
router.put('/users/:id/permissions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { permissions } = req.body; // Array of { folderPath, permission: 'read' | 'write' }
    
    if (!Array.isArray(permissions)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: '권한 목록이 올바르지 않습니다.' });
    }

    // Revoke all existing permissions first
    await Permission.revokeAllUserPermissions(userId);

    // Grant new permissions
    for (const perm of permissions) {
      if (perm.folderPath && perm.permission && PERMISSIONS.isValid(perm.permission)) {
        await Permission.grant(userId, perm.folderPath, perm.permission);
      }
    }

    res.json({ message: '권한이 업데이트되었습니다.' });
  } catch (error) {
    console.error('Update user permissions error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: '권한 업데이트에 실패했습니다.' });
  }
});

// Clean up orphaned data
router.post('/cleanup/orphaned', authenticateToken, isAdmin, async (req, res) => {
  try {
    const results = {
      deletedPermissionFiles: 0,
      deletedUserFiles: 0,
      deletedEmailIndexFiles: 0,
      cleanedPermissionRequests: 0,
      errors: [],
    };

    const allUsers = await User.findAll();
    const validUserIds = new Set(allUsers.map(u => String(u.id)));
    const validUsernames = new Set(allUsers.map(u => u.username));
    const validEmailHashes = new Set(allUsers.map(u => u.email_hash).filter(Boolean));

    const { listDir, deletePath, exists } = require('../store/storage');
    const { 
      PERMISSIONS_USERS_DIR, 
      userPermissionsPathByUserId,
      USERS_DIR,
      USERS_INDEX_PATH,
      userPathByUsername,
      EMAIL_INDEX_DIR,
      emailIndexPathByEmailHash,
      basename: pathBasename,
    } = require('../store/metaPaths');

    // 1. Orphaned permission 파일 정리
    {
      try {
        const entries = await listDir(PERMISSIONS_USERS_DIR);
        for (const ent of entries) {
          if (!ent.basename || !ent.basename.endsWith('.json')) continue;
          const userId = ent.basename.replace(/\.json$/, '');
          
          if (!validUserIds.has(userId)) {
            const filePath = userPermissionsPathByUserId(userId);
            try {
              if (await exists(filePath)) {
                await deletePath(filePath);
                results.deletedPermissionFiles++;
              }
            } catch (error) {
              results.errors.push(`Failed to delete permission file ${filePath}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        results.errors.push(`Failed to list permission files: ${error.message}`);
      }
    }

    // 2. Orphaned user 메타데이터 파일 정리
    {
      try {
        const entries = await listDir(USERS_DIR);
        const indexBasename = pathBasename(USERS_INDEX_PATH);
        
        for (const ent of entries) {
          if (!ent.basename || !ent.basename.endsWith('.json')) continue;
          if (ent.basename === indexBasename) continue; // _index.json 제외
          
          const username = ent.basename.replace(/\.json$/, '');
          
          if (!validUsernames.has(username)) {
            const filePath = userPathByUsername(username);
            try {
              if (await exists(filePath)) {
                await deletePath(filePath);
                results.deletedUserFiles++;
              }
            } catch (error) {
              results.errors.push(`Failed to delete user file ${filePath}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        results.errors.push(`Failed to list user files: ${error.message}`);
      }
    }

    // 3. Orphaned email 인덱스 파일 정리
    {
      try {
        const entries = await listDir(EMAIL_INDEX_DIR);
        
        for (const ent of entries) {
          if (!ent.basename || !ent.basename.endsWith('.txt')) continue;
          
          const emailHash = ent.basename.replace(/\.txt$/, '');
          
          if (!validEmailHashes.has(emailHash)) {
            const filePath = emailIndexPathByEmailHash(emailHash);
            try {
              if (await exists(filePath)) {
                await deletePath(filePath);
                results.deletedEmailIndexFiles++;
              }
            } catch (error) {
              results.errors.push(`Failed to delete email index file ${filePath}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        results.errors.push(`Failed to list email index files: ${error.message}`);
      }
    }

    // 4. Orphaned permission request 항목 정리
    {
      try {
        const { PERMISSION_REQUESTS_PATH } = require('../store/permissionRequestStore');
        const { withLock } = require('../store/locks');
        const { readFile, writeFile, exists, ensureDir } = require('../store/storage');
        const { META_ROOT } = require('../store/metaPaths');
        
        await withLock('permission_requests', async () => {
          // Ensure directory exists
          await ensureDir(META_ROOT);
          
          if (!(await exists(PERMISSION_REQUESTS_PATH))) {
            return; // 파일이 없으면 스킵
          }
          
          // 파일 읽기
          const buf = await readFile(PERMISSION_REQUESTS_PATH);
          const text = Buffer.from(buf).toString('utf8');
          let doc;
          
          try {
            doc = JSON.parse(text);
          } catch (parseError) {
            results.errors.push(`Failed to parse permission requests file: ${parseError.message}`);
            return;
          }
          
          if (!doc || !Array.isArray(doc.requests)) {
            return; // 잘못된 형식이면 스킵
          }
          
          const originalCount = doc.requests.length;
          
          // 유효한 사용자 ID를 참조하는 요청만 유지
          doc.requests = doc.requests.filter(req => {
            if (!req || typeof req !== 'object') return false;
            const requesterId = String(req.requester_id);
            const ownerId = String(req.owner_id);
            return validUserIds.has(requesterId) && validUserIds.has(ownerId);
          });
          
          const cleanedCount = originalCount - doc.requests.length;
          if (cleanedCount > 0) {
            doc.updated_at = new Date().toISOString();
            await writeFile(PERMISSION_REQUESTS_PATH, JSON.stringify(doc, null, 2), {
              overwrite: true,
              contentType: 'application/json; charset=utf-8',
            });
            results.cleanedPermissionRequests = cleanedCount;
          }
        });
      } catch (error) {
        results.errors.push(`Failed to clean permission requests: ${error.message}`);
      }
    }

    res.json({
      message: 'Orphaned data cleanup completed',
      results,
    });
  } catch (error) {
    console.error('Cleanup orphaned data error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to cleanup orphaned data' });
  }
});

module.exports = router;

