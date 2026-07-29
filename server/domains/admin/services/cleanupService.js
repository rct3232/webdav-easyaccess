'use strict';
const User = require('../../../models/User');
const storage = require('../../../store/storage');
const metaPaths = require('../../../store/metaPaths');

async function cleanupOrphanedData() {
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

  const { listDir, deletePath, exists } = storage;
  const {
    PERMISSIONS_USERS_DIR,
    userPermissionsPathByUserId,
    USERS_DIR,
    USERS_INDEX_PATH,
    userPathByUsername,
    EMAIL_INDEX_DIR,
    emailIndexPathByEmailHash,
    basename: pathBasename,
  } = metaPaths;

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
      const { readFile, writeFile, exists: storageExists, ensureDir } = storage;
      const { META_ROOT } = metaPaths;

      await withLock('permission_requests', async () => {
        // Ensure directory exists
        await ensureDir(META_ROOT);

        if (!(await storageExists(PERMISSION_REQUESTS_PATH))) {
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

  return results;
}

module.exports = { cleanupOrphanedData };
