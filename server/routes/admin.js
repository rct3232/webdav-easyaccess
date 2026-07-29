const express = require('express');
const router = express.Router();
const {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../models/User');
const Permission = require('../models/Permission');
const PermissionRequest = require('../models/PermissionRequest');
const Settings = require('../models/Settings');
const { authenticateToken } = require('../utils/auth');
const { sendApprovalEmail, sendRejectionEmail } = require('../utils/email');
const { createDirectory } = require('../utils/webdav');
const { asyncHandler, createError, validationError } = require('../utils/errorHandler');

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get settings
router.get('/settings', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const settings = await Settings.getAll();
  res.json(settings);
}));

// Update settings
router.put('/settings', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { registration_enabled } = req.body;

  if (registration_enabled !== undefined) {
    await Settings.set('registration_enabled', String(registration_enabled));
  }

  const settings = await Settings.getAll();
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.settingsSaved,
    settings,
  });
}));

// Get all pending users
router.get('/users/pending', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const users = await User.findByStatus(USER_STATUS.PENDING);
  res.json(users);
}));

// Get all users with status
router.get('/users', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const users = await User.findAll();
  res.json(users);
}));

// Create user (admin only)
router.post('/users', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { pathExists } = require('../utils/webdav');
  let createdUser = null;

  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    throw validationError(SERVER_ERROR_CODES.admin.createUserRequiredFields);
  }

  if (password.length < 6) {
    throw validationError(SERVER_ERROR_CODES.admin.passwordMinLength);
  }

  // Check if user already exists
  const existingUser = await User.findByUsername(username);
  if (existingUser) {
    throw validationError(SERVER_ERROR_CODES.admin.usernameTaken);
  }

  const existingEmail = await User.findByEmail(email);
  if (existingEmail) {
    throw validationError(SERVER_ERROR_CODES.admin.emailTaken);
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
      throw createError(SERVER_ERROR_CODES.admin.userFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (folderError) {
    console.error('[Admin Create] Failed to check or create user folder:', folderError);
    // Rollback user creation
    await User.delete(createdUser.id);
    throw createError(SERVER_ERROR_CODES.admin.userFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  // Grant permissions
  try {
    await Permission.grant(createdUser.id, userFolder, PERMISSIONS.ADMIN);

    // Verify permissions were granted successfully
    const hasPermission = await Permission.checkPermission(createdUser.id, userFolder, PERMISSIONS.ADMIN);
    if (!hasPermission) {
      throw createError(SERVER_ERROR_CODES.admin.userPermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (permError) {
    console.error('[Admin Create] Failed to grant permissions:', permError);
    // Rollback user creation - permissions are essential
    await User.delete(createdUser.id);
    throw createError(SERVER_ERROR_CODES.admin.userPermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  res.status(HTTP_STATUS.CREATED).json({
    messageCode: SERVER_MESSAGE_CODES.admin.userAdded,
    user: {
      id: createdUser.id,
      username: createdUser.username,
      email: createdUser.email,
      status: USER_STATUS.APPROVED,
      is_admin: false
    }
  });
}));

// Approve user
router.post('/users/:id/approve', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.userNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (user.status !== USER_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.admin.notPending);
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
      throw createError(SERVER_ERROR_CODES.admin.approveFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (folderError) {
    console.error(`[Admin] Failed to check or create user folder:`, folderError);
    // Rollback approval
    await User.updateStatus(userId, USER_STATUS.PENDING);
    throw createError(SERVER_ERROR_CODES.admin.approveFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  // Grant permissions
  try {
    await Permission.grant(userId, `/${user.username}`, PERMISSIONS.ADMIN);

    // Verify permissions were granted successfully
    const hasPermission = await Permission.checkPermission(userId, `/${user.username}`, PERMISSIONS.ADMIN);
    if (!hasPermission) {
      throw createError(SERVER_ERROR_CODES.admin.approvePermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (permError) {
    console.error(`[Admin] Failed to grant permissions:`, permError);
    // Rollback approval - permissions are essential
    await User.updateStatus(userId, USER_STATUS.PENDING);
    throw createError(SERVER_ERROR_CODES.admin.approvePermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  // Send approval email
  try {
    await sendApprovalEmail(user.email, user.username);
  } catch (emailError) {
    console.error('[Admin] Failed to send approval email:', emailError);
    // Continue anyway - user is approved
  }

  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.userApproved,
    user: { id: user.id, username: user.username, email: user.email, status: USER_STATUS.APPROVED }
  });
}));

// Reject user
router.post('/users/:id/reject', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.rejectNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (user.status !== USER_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.admin.notPendingReject);
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

  // Reject user status
  await User.updateStatus(userId, USER_STATUS.REJECTED);

  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.userRejected,
    user: { id: user.id, username: user.username, email: user.email },
  });
}));

// Delete user
router.delete('/users/:id', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const adminId = req.user.id;

  // Prevent admin from deleting themselves
  if (userId === adminId) {
    throw validationError(SERVER_ERROR_CODES.admin.deleteSelf);
  }

  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.deleteNotFound, HTTP_STATUS.NOT_FOUND);
  }

  // Prevent deleting other admin accounts
  if (user.is_admin) {
    throw validationError(SERVER_ERROR_CODES.admin.deleteOtherAdmin);
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
    messageCode: SERVER_MESSAGE_CODES.admin.userDeleted,
    user: { id: user.id, username: user.username, email: user.email },
  });
}));

// Get folder list for admin (single level)
router.get('/folders/list', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
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
}));

// Update user permissions (bulk)
router.put('/users/:id/permissions', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const { permissions } = req.body; // Array of { folderPath, permission: 'read' | 'write' }

  if (!Array.isArray(permissions)) {
    throw validationError(SERVER_ERROR_CODES.admin.invalidPermissionList);
  }

  // Revoke all existing permissions first
  await Permission.revokeAllUserPermissions(userId);

  // Grant new permissions
  for (const perm of permissions) {
    if (perm.folderPath && perm.permission && PERMISSIONS.isValid(perm.permission)) {
      await Permission.grant(userId, perm.folderPath, perm.permission);
    }
  }

  res.json({ messageCode: SERVER_MESSAGE_CODES.admin.permissionUpdated });
}));

// Ensure home-owner admin for all users
router.post('/permissions/ensure-home-owner-admin', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { ensureHomeOwnerAdminForAllUsers } = require('../utils/ensureHomeOwnerAdmin');
  const result = await ensureHomeOwnerAdminForAllUsers();
  res.json({ success: true, ...result });
}));

// Clean up orphaned data
router.post('/cleanup/orphaned', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
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

  // 1. Clean up orphaned permission files
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

  // 2. Clean up orphaned user metadata files
  {
    try {
      const entries = await listDir(USERS_DIR);
      const indexBasename = pathBasename(USERS_INDEX_PATH);

      for (const ent of entries) {
        if (!ent.basename || !ent.basename.endsWith('.json')) continue;
        if (ent.basename === indexBasename) continue; // skip _index.json

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

  // 3. Clean up orphaned email index files
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

  // 4. Clean up orphaned permission request entries
  {
    try {
      const { PERMISSION_REQUESTS_PATH } = require('../domains/permissions/stores/permissionRequestStore');
      const { withLock } = require('../store/locks');
      const { readFile, writeFile, exists, ensureDir } = require('../store/storage');
      const { META_ROOT } = require('../store/metaPaths');

      await withLock('permission_requests', async () => {
        // Ensure directory exists
        await ensureDir(META_ROOT);

        if (!(await exists(PERMISSION_REQUESTS_PATH))) {
          return; // skip if file doesn't exist
        }

        // Read file
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
          return; // skip if format is invalid
        }

        const originalCount = doc.requests.length;

        // Keep only requests referencing valid user IDs
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
    messageCode: SERVER_MESSAGE_CODES.admin.orphanCleanupDone,
    results,
  });
}));

module.exports = router;

