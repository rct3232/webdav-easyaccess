const crypto = require('crypto');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

// WebDAV paths (POSIX-style) for metadata storage.
// NOTE: These are remote WebDAV paths, not local filesystem paths.
// FsJSON-specific metadata paths were removed in Phase 7; only the lock
// path helper and shared normalization utilities remain.

const META_ROOT = '/.wea';

const LOCKS_DIR = `${META_ROOT}/locks`;
const lockPathByKey = (lockKey) => `${LOCKS_DIR}/${lockKey}.lock`;

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

module.exports = {
  lockPathByKey,
  sha256HexLower,
  normalizeWebdavPath,
  isMetaPath,
};
