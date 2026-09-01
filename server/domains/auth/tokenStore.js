const crypto = require('crypto');
const { createCacheAdapter } = require('../../infrastructure/adapters/cache');
const userStore = require('../../store/userStore');

const REFRESH_TOKEN_EXPIRES_IN_DAYS =
  parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10) || 7;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;

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
  _getCache().set(`refresh:${tokenId}`, { userId }, REFRESH_TOKEN_TTL_MS);
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
  REFRESH_TOKEN_EXPIRES_IN_DAYS,
  setCacheAdapter,
  generateRefreshTokenId,
  addRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokensForUser,
};
