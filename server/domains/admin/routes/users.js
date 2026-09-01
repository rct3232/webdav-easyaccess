'use strict';
const express = require('express');
const router = express.Router();
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const {
  asyncHandler,
  notFoundError,
  forbiddenError,
  validationError,
} = require('../../../utils/errorHandler');
const User = require('../../../models/User');
const {
  listUsers,
  listApprovedUsers,
  getUserById,
  updatePassword,
  updateEmail,
} = require('../services/userService');

router.get(
  '/',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const users = await listUsers();
    res.json(users);
  })
);

router.get(
  '/approved',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const approved = await listApprovedUsers(req.user.id);
    res.json(approved);
  })
);

router.get(
  '/:id',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.params.id);
    res.json(user);
  })
);

router.put(
  '/:id/password',
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (parseInt(req.params.id) !== req.user.id) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }

    const { password } = req.body;
    if (!password) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    await updatePassword(req.params.id, password);
    res.json({ messageCode: SERVER_MESSAGE_CODES.users.passwordUpdated });
  })
);

router.put(
  '/:id/email',
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (parseInt(req.params.id) !== req.user.id) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }

    const { email } = req.body;
    if (!email) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    await updateEmail(req.params.id, email);
    res.json({ messageCode: SERVER_MESSAGE_CODES.users.emailUpdated });
  })
);

router.put(
  '/:id/permissions',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      throw validationError(SERVER_ERROR_CODES.admin.invalidPermissionList);
    }

    const requestingUser = await User.findById(req.user.id);
    if (!requestingUser) {
      throw notFoundError(SERVER_ERROR_CODES.auth.userNotFound);
    }

    if (!requestingUser.is_admin) {
      throw forbiddenError(SERVER_ERROR_CODES.admin.adminRequired);
    }

    const permissionStore = require('../../../store/permissionStore');
    await permissionStore.revokeAllUserPermissions(userId);

    for (const perm of permissions) {
      if (perm.folderPath && perm.permission) {
        await permissionStore.grant(userId, perm.folderPath, perm.permission);
      }
    }

    res.json({ messageCode: SERVER_MESSAGE_CODES.users.permissionUpdated });
  })
);

module.exports = router;
