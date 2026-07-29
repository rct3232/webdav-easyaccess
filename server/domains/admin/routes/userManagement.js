'use strict';
const express = require('express');
const router = express.Router();
const {
  HTTP_STATUS,
  USER_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const {
  createAdminUser,
  approvePendingUser,
  rejectPendingUser,
  deleteUserCascade,
  bulkUpdateUserPermissions,
} = require('../services/userService');

const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

router.get('/users/pending', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const users = await User.findByStatus(USER_STATUS.PENDING);
  res.json(users);
}));

router.get('/users', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const users = await User.findAll();
  res.json(users);
}));

router.post('/users', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  const user = await createAdminUser({ username, email, password });
  res.status(HTTP_STATUS.CREATED).json({
    messageCode: SERVER_MESSAGE_CODES.admin.userAdded,
    user,
  });
}));

router.post('/users/:id/approve', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = await approvePendingUser(userId);
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.userApproved,
    user,
  });
}));

router.post('/users/:id/reject', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = await rejectPendingUser(userId, req.user.id);
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.userRejected,
    user,
  });
}));

router.delete('/users/:id', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = await deleteUserCascade(userId, req.user.id);
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.userDeleted,
    user,
  });
}));

router.put('/users/:id/permissions', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const { permissions } = req.body;
  await bulkUpdateUserPermissions(userId, permissions);
  res.json({ messageCode: SERVER_MESSAGE_CODES.admin.permissionUpdated });
}));

module.exports = router;
