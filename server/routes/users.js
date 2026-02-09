const express = require('express');
const router = express.Router();
const { PERMISSIONS, USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const User = require('../models/User');
const { authenticateToken, deleteAllRefreshTokensForUser } = require('../utils/auth');
const { asyncHandler, notFoundError, forbiddenError, validationError, conflictError } = require('../utils/errorHandler');

// Get all users (admin only - simplified for now)
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const users = await User.findAll();
  res.json(
    users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      created_at: u.created_at,
    }))
  );
}));

// Get approved users for sharing (available to all authenticated users)
router.get('/approved', authenticateToken, asyncHandler(async (req, res) => {
  const approved = await User.findByStatus('approved');
  const rows = approved
    .filter(u => !u.is_admin)
    .map(u => ({ id: u.id, username: u.username, email: u.email }))
    .sort((a, b) => a.username.localeCompare(b.username));
  // 현재 사용자는 제외
  const filtered = rows.filter(user => user.id !== req.user.id);
  res.json(filtered);
}));

// Get user by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw notFoundError('User not found');
  }
  res.json(user);
}));

// Update password
router.put('/:id/password', authenticateToken, asyncHandler(async (req, res) => {
  if (parseInt(req.params.id) !== req.user.id) {
    throw forbiddenError('Forbidden');
  }

  const { password } = req.body;
  if (!password) {
    throw validationError('Password is required');
  }

  const userId = parseInt(req.params.id, 10);
  await User.updatePassword(userId, password);
  deleteAllRefreshTokensForUser(userId);
  res.json({ message: 'Password updated successfully' });
}));

// Update email
router.put('/:id/email', authenticateToken, asyncHandler(async (req, res) => {
  if (parseInt(req.params.id) !== req.user.id) {
    throw forbiddenError('Forbidden');
  }

  const { email } = req.body;
  if (!email) {
    throw validationError('Email is required');
  }

  const existingEmail = await User.findByEmail(email);
  if (existingEmail && existingEmail.id !== req.user.id) {
    throw conflictError('Email already exists');
  }

  await User.updateEmail(req.params.id, email);
  res.json({ message: 'Email updated successfully' });
}));

// Get user permissions (admin can view any user's permissions, users can view their own)
router.get('/:id/permissions', authenticateToken, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const requestingUser = await User.findById(req.user.id);
  
  if (!requestingUser) {
    throw notFoundError('User not found');
  }
  
  // 관리자는 모든 사용자의 권한을 볼 수 있고, 일반 사용자는 자신의 권한만 볼 수 있음
  if (!requestingUser.is_admin && userId !== req.user.id) {
    throw forbiddenError('Access denied');
  }
  
  const Permission = require('../models/Permission');
  const permissions = await Permission.getUserPermissions(userId);
  res.json(permissions);
}));

// Update user permissions (bulk) - admin can update any user's permissions, users can update their own (with restrictions)
router.put('/:id/permissions', authenticateToken, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const { permissions } = req.body; // Array of { folderPath, permission: 'read' | 'write' }
  
  if (!Array.isArray(permissions)) {
    throw validationError('권한 목록이 올바르지 않습니다.');
  }
  
  const requestingUser = await User.findById(req.user.id);
  if (!requestingUser) {
    throw notFoundError('User not found');
  }
  
  // 관리자는 모든 사용자의 권한을 수정할 수 있고, 일반 사용자는 자신의 권한만 수정할 수 있음
  // 하지만 일반 사용자가 자신의 권한을 수정하는 것은 제한적이므로 (보안상), 관리자만 허용
  if (!requestingUser.is_admin) {
    throw forbiddenError('Access denied. Admin permission required');
  }
  
  const Permission = require('../models/Permission');
  
  // Revoke all existing permissions first
  await Permission.revokeAllUserPermissions(userId);
  
  // Grant new permissions
  for (const perm of permissions) {
    if (perm.folderPath && perm.permission && PERMISSIONS.isValid(perm.permission)) {
      await Permission.grant(userId, perm.folderPath, perm.permission);
    }
  }
  
  res.json({ message: '권한이 업데이트되었습니다.' });
}));

module.exports = router;

