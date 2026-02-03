const jwt = require('jsonwebtoken');
const userStore = require('../store/userStore');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30m';

// Fail fast in production if JWT_SECRET is not configured.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

function generateToken(user) {
  const tokenVersion = Number.isInteger(user?.token_version) ? user.token_version : 0;
  return jwt.sign(
    { id: user.id, username: user.username, token_version: tokenVersion },
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
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  try {
    // Server-side token invalidation via token_version.
    const user = await userStore.findById(decoded.id);
    if (!user) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    const current = Number.isInteger(user.token_version) ? user.token_version : 0;
    const claimed = Number.isInteger(decoded.token_version) ? decoded.token_version : 0;
    if (claimed !== current) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    
    // Generate new token to extend expiration (sliding window)
    // This ensures token expiration is reset on every authenticated request
    const newToken = generateToken(user);
    res.setHeader('X-New-Token', newToken);
    
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
};

