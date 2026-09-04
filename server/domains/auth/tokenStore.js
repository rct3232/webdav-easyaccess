const crypto = require('crypto');
const { createCacheAdapter } = require('../../infrastructure/adapters/cache');
const userStore = require('../../store/userStore');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// REFRESH_TOKEN_EXPIRES_IN_DAYS is DB-only (registry dbOnly): the TTL is
// resolved through the shared config resolver (DB row → built-in default 7) at
// issue time so admin/DB edits apply without a restart. There is no module-load
// snapshot of process.env.
function refreshTokenTtlMs() {
  const { getSharedResolver } = require('../../infrastructure/configResolver');
  const raw = Number(getSharedResolver().getConfigSync('REFRESH_TOKEN_EXPIRES_IN_DAYS'));
  const days = Number.isFinite(raw) && raw > 0 ? raw : 7;
  return days * MS_PER_DAY;
}

let _cache = null;

function _getCache() {
  if (!_cache) {
    _cache = createCacheAdapter();
  }
  return _cache;
}

function setCacheAdapter(adapter) {
  _cache = adapter;
}

function generateRefreshTokenId() {
  return crypto.randomBytes(32).toString('hex');
}

function addRefreshToken(tokenId, userId) {
  _getCache().set(`refresh:${tokenId}`, { userId }, refreshTokenTtlMs());
}

async function validateRefreshToken(tokenId) {
  if (!tokenId || typeof tokenId !== 'string') return null;
  const entry = _getCache().get(`refresh:${tokenId}`);
  if (!entry) return null;
  const user = await userStore.findById(entry.userId);
  if (!user) {
    _getCache().delete(`refresh:${tokenId}`);
    return null;
  }
  return user;
}

function deleteRefreshToken(tokenId) {
  _getCache().delete(`refresh:${tokenId}`);
}

function deleteAllRefreshTokensForUser(userId) {
  const cache = _getCache();
  for (const [key, entry] of cache.entries()) {
    if (key.startsWith('refresh:') && entry.userId === userId) {
      cache.delete(key);
    }
  }
}

module.exports = {
  refreshTokenTtlMs,
  setCacheAdapter,
  generateRefreshTokenId,
  addRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokensForUser,
};
