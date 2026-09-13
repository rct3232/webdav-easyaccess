'use strict';
const express = require('express');
const router = express.Router();
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, forbiddenError, validationError } = require('../../../utils/errorHandler');
const { listApprovedUsers, updatePassword, updateEmail } = require('../services/userService');

router.get(
  '/approved',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const approved = await listApprovedUsers(req.user.id);
    res.json(approved);
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

module.exports = router;
