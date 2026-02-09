/**
 * Shared package entry. Prefer subpath imports: @webdav-easyaccess/shared/pathUtils, etc.
 */
module.exports = {
  ...require('./pathUtils'),
  ...require('./constants'),
  ...require('./fileTypes'),
  ...require('./validation'),
};
