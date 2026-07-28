/**
 * Permission rank utilities.
 *
 * Permissions are ordered from lowest to highest authority:
 *   READ (0) < WRITE (1) < ADMIN (2)
 *
 * A higher-rank permission implicitly grants all lower ranks.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

/**
 * Returns the numeric rank of a permission level.
 * -1 is returned for unknown values.
 */
function getPermissionRank(permission) {
  return PERMISSIONS.ALL.indexOf(permission);
}

/**
 * Checks whether `actual` meets or exceeds `required`.
 */
function meetsRank(actual, required) {
  if (!actual || !required) return false;
  return getPermissionRank(actual) >= getPermissionRank(required);
}

module.exports = {
  getPermissionRank,
  meetsRank,
};
