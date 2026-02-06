const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Settings = require('../models/Settings');
const {
  generateToken,
  authenticateToken,
  generateRefreshTokenId,
  addRefreshToken,
  validateRefreshToken,
  deleteAllRefreshTokensForUser,
  REFRESH_TOKEN_EXPIRES_IN_DAYS,
} = require('../utils/auth');
const { sendRegistrationPendingEmail } = require('../utils/email');
const { ensureDefaultAdmin, ensureDirs } = require('../store/bootstrap');

// Simple in-memory login rate limiter (best-effort, per-process).
// Configure via env:
// - LOGIN_RATE_LIMIT_WINDOW_MS (default: 900000 = 15m)
// - LOGIN_RATE_LIMIT_MAX (default: 20)
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10);
const loginAttempts = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || '';
}

function loginKey(req, username) {
  // Key by IP to avoid bypass by rotating usernames.
  return `${getClientIp(req)}`;
}

function checkLoginRateLimit(req, username) {
  const key = loginKey(req, username);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) return { ok: true, key };
  if (entry.count >= LOGIN_RATE_LIMIT_MAX) {
    return { ok: false, key, retryAfterMs: entry.resetAt - now };
  }
  return { ok: true, key };
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

router.post('/register', async (req, res) => {
  let createdUser = null;
  
  try {
    const registrationEnabled = await Settings.isRegistrationEnabled();
    if (!registrationEnabled) {
      return res.status(403).json({ error: '현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해주세요.' });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '사용자명, 이메일, 비밀번호를 모두 입력해주세요.' });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    // Note: WebDAV folder existence check removed - will be handled during approval

    createdUser = await User.create(username, email, password, false);

    try {
      await sendRegistrationPendingEmail(email, username);
    } catch (emailError) {
      if (createdUser && createdUser.id) {
        await User.delete(createdUser.id);
      }
      return res.status(500).json({ 
        error: '이메일 발송에 실패했습니다. 관리자에게 문의해주세요.' 
      });
    }

    res.status(201).json({
      message: '회원가입이 완료되었습니다. 관리자 승인을 기다려주세요.',
      status: 'pending',
      user: { id: createdUser.id, username: createdUser.username, email: createdUser.email, status: createdUser.status },
    });
  } catch (error) {
    if (createdUser && createdUser.id) {
      try {
        await User.delete(createdUser.id);
      } catch (deleteError) {
        // Ignore delete error
      }
    }
    res.status(500).json({ error: '회원가입 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '사용자명과 비밀번호를 입력해주세요.' });
    }

    const limit = checkLoginRateLimit(req, username);
    if (!limit.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 0) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: '로그인 시도 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.',
      });
    }

    // Admin 계정이 없으면 자동 복구 (/.wea 삭제 등으로 인한 복구)
    if (username === 'admin') {
      const adminExists = await User.findByUsername('admin');
      if (!adminExists) {
        try {
          // 필요한 디렉토리 재생성
          await ensureDirs();
          // Admin 계정 재생성
          await ensureDefaultAdmin();
        } catch (recoveryError) {
          console.error('[Auth] Failed to auto-recreate admin account:', recoveryError);
          // 복구 실패해도 계속 진행 (기존 로직대로 처리)
        }
      }
    }

    const user = await User.findByUsername(username);
    if (!user) {
      recordLoginFailure(limit.key);
      return res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    const isValid = await User.verifyPassword(user, password);
    if (!isValid) {
      recordLoginFailure(limit.key);
      return res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (user.status === 'pending') {
      recordLoginFailure(limit.key);
      return res.status(403).json({ 
        error: '계정 승인 대기 중',
        status: 'pending',
        message: '계정이 관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.'
      });
    }

    if (user.status === 'rejected') {
      recordLoginFailure(limit.key);
      return res.status(403).json({ 
        error: '계정 가입 거절됨',
        status: 'rejected',
        message: '계정 가입이 거절되었습니다. 관리자에게 문의해주세요.'
      });
    }

    const token = generateToken(user);
    const refreshTokenId = generateRefreshTokenId();
    const refreshExpiresAt = Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
    addRefreshToken(refreshTokenId, user.id, refreshExpiresAt);
    clearLoginFailures(limit.key);

    res.json({
      message: '로그인 성공',
      token,
      refreshToken: refreshTokenId,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: '로그인 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const user = await validateRefreshToken(refreshToken);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    const token = generateToken(user);
    return res.json({ token });
  } catch (error) {
    res.status(500).json({ error: '토큰 갱신 중 문제가 발생했습니다.' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: '사용자 정보를 불러오는 중 문제가 발생했습니다.' });
  }
});

module.exports = router;

