const express = require('express');
const router = express.Router();
const {
  HTTP_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get folder list for admin (single level)
router.get('/folders/list', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { listDirectory } = require('../../../utils/webdav');
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

// Ensure home-owner admin for all users
router.post('/permissions/ensure-home-owner-admin', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { ensureHomeOwnerAdminForAllUsers } = require('../../../utils/ensureHomeOwnerAdmin');
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

  const { listDir, deletePath, exists } = require('../../../store/storage');
  const {
    PERMISSIONS_USERS_DIR,
    userPermissionsPathByUserId,
    USERS_DIR,
    USERS_INDEX_PATH,
    userPathByUsername,
    EMAIL_INDEX_DIR,
    emailIndexPathByEmailHash,
    basename: pathBasename,
  } = require('../../../store/metaPaths');

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
      const { PERMISSION_REQUESTS_PATH } = require('../../../domains/permissions/stores/permissionRequestStore');
      const { withLock } = require('../../../store/locks');
      const { readFile, writeFile, exists, ensureDir } = require('../../../store/storage');
      const { META_ROOT } = require('../../../store/metaPaths');

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