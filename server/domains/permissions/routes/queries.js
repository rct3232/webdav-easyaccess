const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const PermissionFacade = require('../services/permissionFacade');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { meetsRank } = require('../policy/permissionRank');
const requireUser = require('../../../middleware/requireUser');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { asyncHandler, validationError } = require('../../../utils/errorHandler');

// Check current user's effective permission for a path (folder or file; file-level overrides path)
router.get('/check', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const pathParam = req.query.path;
  if (pathParam === undefined || pathParam === null || String(pathParam).trim() === '') {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }
  let path = normalizePath(pathParam);

 const effective = await PermissionFacade.getEffectivePermission(req.user.id, path);
   const filePerm = await PermissionFacade.getFilePermission(req.user.id, path);
  const hasRead = effective ? meetsRank(effective, PERMISSIONS.READ) : false;
  const hasWrite = effective ? meetsRank(effective, PERMISSIONS.WRITE) : false;
  const source = filePerm != null ? 'file' : 'path';

  res.json({
    path,
    hasRead,
    hasWrite,
    source,
  });
}));

module.exports = router;
