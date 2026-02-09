const path = require('path');
const crypto = require('crypto');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

// WebDAV paths (POSIX-style) for metadata storage.
// NOTE: These are remote WebDAV paths, not local filesystem paths.

const META_ROOT = '/.wea';

const SETTINGS_PATH = `${META_ROOT}/settings.json`;

const USERS_DIR = `${META_ROOT}/users`;
const USERS_INDEX_PATH = `${USERS_DIR}/_index.json`;
const userPathByUsername = (username) => `${USERS_DIR}/${username}.json`;

const EMAIL_INDEX_DIR = `${META_ROOT}/index/email`;
const emailIndexPathByEmailHash = (emailHash) => `${EMAIL_INDEX_DIR}/${emailHash}.txt`;

const LOCKS_DIR = `${META_ROOT}/locks`;
const lockPathByKey = (lockKey) => `${LOCKS_DIR}/${lockKey}.lock`;

const PERMISSIONS_DIR = `${META_ROOT}/permissions`;
const PERMISSIONS_USERS_DIR = `${PERMISSIONS_DIR}/users`;
const userPermissionsPathByUserId = (userId) => `${PERMISSIONS_USERS_DIR}/${userId}.json`;

function sha256HexLower(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function normalizeWebdavPath(p) {
  return normalizePath(p);
}

function isMetaPath(webdavPath) {
  const normalized = normalizeWebdavPath(webdavPath);
  if (normalized === META_ROOT) return true;
  if (normalized.startsWith(`${META_ROOT}/`)) return true;
  return false;
}

function basename(webdavPath) {
  const normalized = normalizeWebdavPath(webdavPath);
  return path.posix.basename(normalized);
}

module.exports = {
  META_ROOT,
  SETTINGS_PATH,
  USERS_DIR,
  USERS_INDEX_PATH,
  userPathByUsername,
  EMAIL_INDEX_DIR,
  emailIndexPathByEmailHash,
  LOCKS_DIR,
  lockPathByKey,
  PERMISSIONS_DIR,
  PERMISSIONS_USERS_DIR,
  userPermissionsPathByUserId,
  sha256HexLower,
  normalizeWebdavPath,
  isMetaPath,
  basename,
};

