/**
 * Owner path detection logic extracted from middleware/permissions and utils/permissionPolicy.
 */
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const User = require('../../../models/User');

/**
 * Returns the root folder path for a user (e.g. "/alice").
 */
function userRootPath(user) {
  if (!user || !user.username) return null;
  return `/${user.username}`;
}

/**
 * Check if targetPath falls under the owner's home directory.
 * Safe prefix match: true if path equals "/{username}" or starts with "/{username}/".
 */
function isOwnerPath(user, targetPath) {
  const root = userRootPath(user);
  if (!root) return false;
  const normalized = normalizePath(targetPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

/**
 * Get the userId of the home directory owner for a path.
 */
async function getHomeOwnerUserIdForPath(folderPath) {
  const normalized = normalizePath(folderPath);
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const username = segments[0];
  const user = await User.findByUsername(username);
  return user ? user.id : null;
}

module.exports = {
  userRootPath,
  isOwnerPath,
  getHomeOwnerUserIdForPath,
};
