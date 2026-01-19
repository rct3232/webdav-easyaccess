const path = require('path');
const crypto = require('crypto');

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

const userMetaDirByUsername = (username) => `/${username}${META_ROOT}`;
const userPermissionsMirrorPathByUsername = (username) =>
  `${userMetaDirByUsername(username)}/permissions.json`;

function sha256HexLower(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function normalizeWebdavPath(p) {
  if (!p) return '/';
  const replaced = String(p).replace(/\\/g, '/');
  const normalized = replaced.replace(/\/+/g, '/');
  if (normalized === '') return '/';
  if (!normalized.startsWith('/')) return `/${normalized}`;
  return normalized;
}

function isMetaPath(webdavPath) {
  const normalized = normalizeWebdavPath(webdavPath);
  if (normalized === META_ROOT) return true;
  if (normalized.startsWith(`${META_ROOT}/`)) return true;
  // User-scoped meta dir: /{username}/.wea/...
  // We'll treat anything containing "/.wea/" as meta.
  return normalized.includes(`${META_ROOT}/`);
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
  userMetaDirByUsername,
  userPermissionsMirrorPathByUsername,
  sha256HexLower,
  normalizeWebdavPath,
  isMetaPath,
  basename,
};

