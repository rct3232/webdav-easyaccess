const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Permission = require('../models/Permission');
const Settings = require('../models/Settings');
const { authenticateToken } = require('../utils/auth');
const { sendApprovalEmail, sendRejectionEmail } = require('../utils/email');
const { createDirectory } = require('../utils/webdav');

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: '권한 확인 중 문제가 발생했습니다.' });
  }
};

// Get settings
router.get('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const settings = await Settings.getAll();
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: '설정을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Update settings
router.put('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { registration_enabled } = req.body;
    
    if (registration_enabled !== undefined) {
      await Settings.set('registration_enabled', String(registration_enabled));
      console.log(`[Admin] Registration enabled set to: ${registration_enabled}`);
    }
    
    const settings = await Settings.getAll();
    res.json({ 
      message: '설정이 저장되었습니다.',
      settings 
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: '설정 저장 중 문제가 발생했습니다.' });
  }
});

// Get all pending users
router.get('/users/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findByStatus('pending');
    res.json(users);
  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({ error: '사용자 목록을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Get all users with status
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: '사용자 목록을 불러오는 중 문제가 발생했습니다.' });
  }
});

// Create user (admin only)
router.post('/users', authenticateToken, isAdmin, async (req, res) => {
  const { pathExists } = require('../utils/webdav');
  let createdUser = null;
  
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '사용자명, 이메일, 비밀번호를 모두 입력해주세요.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 최소 6자 이상이어야 합니다.' });
    }

    // Check if user already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    // Check if folder with same name already exists in WebDAV
    const userFolder = `/${username}`;
    console.log('[Admin Create] Checking if folder exists:', userFolder);
    
    try {
      const folderExists = await pathExists(userFolder);
      if (folderExists) {
        return res.status(400).json({ 
          error: '이미 사용 중인 사용자명입니다. WebDAV 서버에 동일한 이름의 폴더가 존재합니다.' 
        });
      }
    } catch (error) {
      console.error('[Admin Create] WebDAV folder check error:', error);
      return res.status(500).json({ 
        error: '폴더 확인 중 문제가 발생했습니다. 관리자에게 문의해주세요.' 
      });
    }

    // Create user with approved status (skip approval process)
    createdUser = await User.create(username, email, password, false);
    await User.updateStatus(createdUser.id, 'approved');
    console.log('[Admin Create] User created and approved:', createdUser.id);

    // Create user folder
    try {
      await createDirectory(userFolder);
      console.log(`[Admin Create] Created user folder: ${userFolder}`);
    } catch (folderError) {
      console.error('[Admin Create] Failed to create user folder:', folderError);
      // Rollback user creation
      await User.delete(createdUser.id);
      return res.status(500).json({ 
        error: '사용자 폴더 생성에 실패했습니다. 사용자 계정이 삭제되었습니다.' 
      });
    }

    // Grant permissions
    try {
      await Permission.grant(createdUser.id, userFolder, 'admin');
      console.log(`[Admin Create] Granted permissions to ${username}`);
    } catch (permError) {
      console.error('[Admin Create] Failed to grant permissions:', permError);
      // Continue anyway - admin can manually fix this
    }

    res.status(201).json({
      message: '사용자가 추가되었습니다.',
      user: { 
        id: createdUser.id, 
        username: createdUser.username, 
        email: createdUser.email, 
        status: 'approved',
        is_admin: false
      }
    });
  } catch (error) {
    console.error('[Admin Create] Create user error:', error);
    // If user was created but something else failed, try to delete
    if (createdUser && createdUser.id) {
      try {
        await User.delete(createdUser.id);
        console.log('[Admin Create] User deleted due to error');
      } catch (deleteError) {
        console.error('[Admin Create] Failed to delete user after error:', deleteError);
      }
    }
    res.status(500).json({ error: '사용자 추가 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Approve user
router.post('/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({ error: '승인 대기 중인 사용자가 아닙니다.' });
    }

    // Update user status
    await User.updateStatus(userId, 'approved');
    console.log(`[Admin] User ${user.username} approved`);

    // Create user folder
    try {
      await createDirectory(`/${user.username}`);
      console.log(`[Admin] Created user folder: /${user.username}`);
    } catch (folderError) {
      console.error(`[Admin] Failed to create user folder:`, folderError);
      // Rollback approval
      await User.updateStatus(userId, 'pending');
      return res.status(500).json({ error: '사용자 폴더 생성에 실패했습니다. 관리자에게 문의해주세요.' });
    }

    // Grant permissions
    try {
      await Permission.grant(userId, `/${user.username}`, 'admin');
      console.log(`[Admin] Granted permissions to ${user.username}`);
    } catch (permError) {
      console.error(`[Admin] Failed to grant permissions:`, permError);
      // Continue anyway - can be fixed manually
    }

    // Send approval email
    try {
      await sendApprovalEmail(user.email, user.username);
      console.log(`[Admin] Approval email sent to ${user.email}`);
    } catch (emailError) {
      console.error('[Admin] Failed to send approval email:', emailError);
      // Continue anyway - user is approved
    }

    res.json({ 
      message: '사용자가 승인되었습니다.',
      user: { id: user.id, username: user.username, email: user.email, status: 'approved' }
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ error: '승인 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Reject user
router.post('/users/:id/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({ error: '승인 대기 중인 사용자가 아닙니다.' });
    }

    // Send rejection email first
    try {
      await sendRejectionEmail(user.email, user.username);
      console.log(`[Admin] Rejection email sent to ${user.email}`);
    } catch (emailError) {
      console.error('[Admin] Failed to send rejection email:', emailError);
      // Continue with deletion even if email fails
    }

    // Delete user permissions
    await Permission.revokeAllUserPermissions(userId);
    console.log(`[Admin] Revoked all permissions for user ${user.username}`);

    // Delete user from database
    await User.delete(userId);
    console.log(`[Admin] User ${user.username} (ID: ${userId}) deleted after rejection`);

    res.json({ 
      message: '사용자 가입이 거절되었으며, 계정이 삭제되었습니다.',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Reject user error:', error);
    res.status(500).json({ error: '거절 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const adminId = req.user.id;
    
    // Prevent admin from deleting themselves
    if (userId === adminId) {
      return res.status(400).json({ error: '자기 자신의 계정은 삭제할 수 없습니다.' });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    // Prevent deleting other admin accounts
    if (user.is_admin) {
      return res.status(400).json({ error: '다른 관리자 계정은 삭제할 수 없습니다.' });
    }

    // Delete user permissions
    const permResult = await Permission.revokeAllUserPermissions(userId);
    console.log(`[Admin] Revoked ${permResult.deletedCount} permissions for user ${user.username}`);

    // Delete user from database
    await User.delete(userId);
    console.log(`[Admin] User ${user.username} (ID: ${userId}) deleted by admin`);

    res.json({ 
      message: '사용자가 삭제되었습니다.',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: '사용자 삭제 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
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
    res.status(500).json({ error: '폴더 목록을 불러오는데 실패했습니다.' });
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
    res.status(500).json({ error: '사용자 권한을 불러오는데 실패했습니다.' });
  }
});

// Update user permissions (bulk)
router.put('/users/:id/permissions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { permissions } = req.body; // Array of { folderPath, permission: 'read' | 'write' }
    
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: '권한 목록이 올바르지 않습니다.' });
    }

    // Revoke all existing permissions first
    await Permission.revokeAllUserPermissions(userId);

    // Grant new permissions
    for (const perm of permissions) {
      if (perm.folderPath && perm.permission && ['read', 'write', 'admin'].includes(perm.permission)) {
        await Permission.grant(userId, perm.folderPath, perm.permission);
      }
    }

    res.json({ message: '권한이 업데이트되었습니다.' });
  } catch (error) {
    console.error('Update user permissions error:', error);
    res.status(500).json({ error: '권한 업데이트에 실패했습니다.' });
  }
});

module.exports = router;

