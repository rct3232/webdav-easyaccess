const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../utils/auth');

// Get all users (admin only - simplified for now)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(
      users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        created_at: u.created_at,
      }))
    );
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get approved users for sharing (available to all authenticated users)
router.get('/approved', authenticateToken, async (req, res) => {
  try {
    const approved = await User.findByStatus('approved');
    const rows = approved
      .filter(u => !u.is_admin)
      .map(u => ({ id: u.id, username: u.username, email: u.email }))
      .sort((a, b) => a.username.localeCompare(b.username));
    // 현재 사용자는 제외
    const filtered = rows.filter(user => user.id !== req.user.id);
    res.json(filtered);
  } catch (error) {
    console.error('Get approved users error:', error);
    res.status(500).json({ error: 'Failed to get approved users' });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update password
router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    if (parseInt(req.params.id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    await User.updatePassword(req.params.id, password);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Update email
router.put('/:id/email', authenticateToken, async (req, res) => {
  try {
    if (parseInt(req.params.id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail && existingEmail.id !== req.user.id) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    await User.updateEmail(req.params.id, email);
    res.json({ message: 'Email updated successfully' });
  } catch (error) {
    console.error('Update email error:', error);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

// Get user permissions (admin can view any user's permissions, users can view their own)
router.get('/:id/permissions', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const requestingUser = await User.findById(req.user.id);
    
    if (!requestingUser) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // 관리자는 모든 사용자의 권한을 볼 수 있고, 일반 사용자는 자신의 권한만 볼 수 있음
    if (!requestingUser.is_admin && userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const Permission = require('../models/Permission');
    const permissions = await Permission.getUserPermissions(userId);
    res.json(permissions);
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(500).json({ error: '사용자 권한을 불러오는데 실패했습니다.' });
  }
});

// Update user permissions (bulk) - admin can update any user's permissions, users can update their own (with restrictions)
router.put('/:id/permissions', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { permissions } = req.body; // Array of { folderPath, permission: 'read' | 'write' }
    
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: '권한 목록이 올바르지 않습니다.' });
    }
    
    const requestingUser = await User.findById(req.user.id);
    if (!requestingUser) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // 관리자는 모든 사용자의 권한을 수정할 수 있고, 일반 사용자는 자신의 권한만 수정할 수 있음
    // 하지만 일반 사용자가 자신의 권한을 수정하는 것은 제한적이므로 (보안상), 관리자만 허용
    if (!requestingUser.is_admin) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }
    
    const Permission = require('../models/Permission');
    
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

