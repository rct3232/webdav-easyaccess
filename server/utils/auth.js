const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const userStore = require('../store/userStore');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30m';
// Refresh token lifetime in days (in-memory store; server restart invalidates all)
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10) || 7;

// In-memory refresh token store: tokenId -> { userId, expiresAt }
const refreshTokensStore = new Map();

function generateRefreshTokenId() {
  return crypto.randomBytes(32).toString('hex');
}

function addRefreshToken(tokenId, userId, expiresAtMs) {
  refreshTokensStore.set(tokenId, { userId, expiresAt: expiresAtMs });
}

async function validateRefreshToken(tokenId) {
  if (!tokenId || typeof tokenId !== 'string') return null;
  const entry = refreshTokensStore.get(tokenId);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) refreshTokensStore.delete(tokenId);
    return null;
  }
  const user = await userStore.findById(entry.userId);
  if (!user) {
    refreshTokensStore.delete(tokenId);
    return null;
  }
  return user;
}

function deleteRefreshToken(tokenId) {
  refreshTokensStore.delete(tokenId);
}

function deleteAllRefreshTokensForUser(userId) {
  for (const [id, entry] of refreshTokensStore.entries()) {
    if (entry.userId === userId) refreshTokensStore.delete(id);
  }
}

// Fail fast in production if JWT_SECRET is not configured.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

function generateToken(user) {
  const tokenVersion = Number.isInteger(user?.token_version) ? user.token_version : 0;
  const isAdmin = user?.is_admin ? 1 : 0;
  return jwt.sign(
    { id: user.id, username: user.username, token_version: tokenVersion, is_admin: isAdmin },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Invalid or expired token' });
  }

  // Stateless: no userStore/cache; token_version checked at refresh time
  req.user = decoded;
  req.user.full = {
    id: decoded.id,
    username: decoded.username,
    is_admin: decoded.is_admin ? 1 : 0,
  };
  return next();
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  generateRefreshTokenId,
  addRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokensForUser,
  REFRESH_TOKEN_EXPIRES_IN_DAYS,
};

