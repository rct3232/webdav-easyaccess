/**
 * Ensure home-owner admin: for each user, upgrade or grant admin on paths under their home.
 * Used on server startup (once) and via admin "permission cleanup" button.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const User = require('../models/User');
const Permission = require('../models/Permission');
const { isOwnerPath } = require('./permissionPolicy');
const { listDirectory } = require('../utils/webdav');

/**
 * Ensure every user has admin on all paths under their home.
 * - Action 1: Upgrade existing permission entries (read/write -> admin) for home paths.
 * - Action 2: List first-level dirs under each user's home and grant admin where missing.
 * @returns {{ updatedUsers: number, upgradedPaths: number, grantedPaths: number, errors: string[] }}
 */
async function ensureHomeOwnerAdminForAllUsers() {
  const result = {
    updatedUsers: 0,
    upgradedPaths: 0,
    grantedPaths: 0,
    errors: [],
  };

  let users = [];
  try {
    users = await User.findAll();
  } catch (err) {
    result.errors.push(`Failed to load users: ${err.message}`);
    return result;
  }

  const nonAdminUsers = users.filter((u) => !u.is_admin);
  const userSet = new Set();

  for (const user of nonAdminUsers) {
    if (!user.id || !user.username) continue;

    try {
      // Action 1: upgrade existing entries under home to admin
      const doc = await Permission.getPermissionDoc(user.id);
      const perms = doc?.permissions || {};
      for (const [folderPath, permission] of Object.entries(perms)) {
        if (!isOwnerPath(user, folderPath)) continue;
        if (permission === PERMISSIONS.ADMIN) continue;
        try {
          await Permission.grant(user.id, folderPath, PERMISSIONS.ADMIN);
          result.upgradedPaths += 1;
          userSet.add(user.id);
        } catch (grantErr) {
          result.errors.push(`Upgrade ${user.username} ${folderPath}: ${grantErr.message}`);
        }
      }

      // Action 2: list first-level dirs under home and grant admin where missing
      const homePath = normalizePath(`/${user.username}`, { isDirectory: true });
      let items = [];
      try {
        items = await listDirectory(homePath);
      } catch (listErr) {
        result.errors.push(`List ${homePath}: ${listErr.message}`);
        continue;
      }

      for (const item of items || []) {
        if (!item?.basename || item.type !== 'directory') continue;
        const dirPath = homePath === '/' ? `/${item.basename}` : `${homePath.replace(/\/$/, '')}/${item.basename}`;
        const normalizedDir = normalizePath(dirPath);
        let hasAdmin = false;
        try {
          hasAdmin = await Permission.checkPermission(user.id, normalizedDir, PERMISSIONS.ADMIN);
        } catch (checkErr) {
          result.errors.push(`Check ${user.username} ${normalizedDir}: ${checkErr.message}`);
          continue;
        }
        if (hasAdmin) continue;
        try {
          await Permission.grant(user.id, normalizedDir, PERMISSIONS.ADMIN);
          result.grantedPaths += 1;
          userSet.add(user.id);
        } catch (grantErr) {
          result.errors.push(`Grant ${user.username} ${normalizedDir}: ${grantErr.message}`);
        }
      }
    } catch (err) {
      result.errors.push(`User ${user.username}: ${err.message}`);
    }
  }

  result.updatedUsers = userSet.size;
  return result;
}

module.exports = {
  ensureHomeOwnerAdminForAllUsers,
};
