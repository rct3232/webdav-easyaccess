const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../utils/auth');
const { asyncHandler } = require('../../utils/errorHandler');
const authService = require('./service');

function handleServiceError(res, error) {
  if (error.status && error.errorCode) {
    const body = { errorCode: error.errorCode };
    if (error.body) Object.assign(body, error.body);
    return res.status(error.status).json(body);
  }
  throw error;
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    try {
      const result = await authService.registerUser(req.body);
      res.status(HTTP_STATUS.CREATED).json({
        messageCode: SERVER_MESSAGE_CODES.auth.registerSuccess,
        status: result.status,
        user: result.user,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    try {
      const result = await authService.loginUser(req.body, req);
      if (result.retryAfterMs) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      }
      res.json({
        messageCode: SERVER_MESSAGE_CODES.auth.loginSuccess,
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
      });
    } catch (error) {
      if (error.retryAfterMs) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
      }
      handleServiceError(res, error);
    }
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    try {
      const result = await authService.refreshAccessToken(req.body?.refreshToken);
      res.json(result);
    } catch (error) {
      handleServiceError(res, error);
    }
  })
);

router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    try {
      const user = await authService.getAuthenticatedUser(req.user.id, req.user.token_version);
      res.json(user);
    } catch (error) {
      handleServiceError(res, error);
    }
  })
);

module.exports = router;
