const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Settings = require('../models/Settings');
const { generateToken, authenticateToken } = require('../utils/auth');
const { sendRegistrationPendingEmail } = require('../utils/email');
const { pathExists } = require('../utils/webdav');

// Register
router.post('/register', async (req, res) => {
  let createdUser = null;
  
  try {
    // Check if registration is enabled
    const registrationEnabled = await Settings.isRegistrationEnabled();
    if (!registrationEnabled) {
      console.log('[Registration] Registration is disabled');
      return res.status(403).json({ error: '현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해주세요.' });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '사용자명, 이메일, 비밀번호를 모두 입력해주세요.' });
    }

    // Check if user already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    // Check if folder with same name already exists in WebDAV
    const userFolder = `/${username}`;
    console.log('[Registration] Checking if folder exists:', userFolder);
    try {
      const folderExists = await pathExists(userFolder);
      console.log('[Registration] Folder exists?', folderExists);
      if (folderExists) {
        console.log('[Registration] Folder already exists, rejecting registration');
        return res.status(400).json({ 
          error: '이미 사용 중인 사용자명입니다. 관리자에게 문의해주세요.' 
        });
      }
      console.log('[Registration] Folder does not exist, proceeding with registration');
    } catch (error) {
      console.error('WebDAV folder check error:', error);
      return res.status(500).json({ 
        error: '회원가입 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' 
      });
    }

    // Create user
    createdUser = await User.create(username, email, password, false);
    console.log('[Registration] User created:', createdUser.id);

    // Send email - if this fails, rollback user creation
    try {
      await sendRegistrationPendingEmail(email, username);
      console.log('[Registration] Email sent successfully');
    } catch (emailError) {
      console.error('[Registration] Email send failed:', emailError);
      // Rollback: delete the created user
      if (createdUser && createdUser.id) {
        await User.delete(createdUser.id);
        console.log('[Registration] User deleted due to email failure');
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
    console.error('Registration error:', error);
    // If user was created but something else failed, try to delete
    if (createdUser && createdUser.id) {
      try {
        await User.delete(createdUser.id);
        console.log('[Registration] User deleted due to error');
      } catch (deleteError) {
        console.error('[Registration] Failed to delete user after error:', deleteError);
      }
    }
    res.status(500).json({ error: '회원가입 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '사용자명과 비밀번호를 입력해주세요.' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    const isValid = await User.verifyPassword(user, password);
    if (!isValid) {
      return res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ 
        error: '계정 승인 대기 중',
        status: 'pending',
        message: '계정이 관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ 
        error: '계정 가입 거절됨',
        status: 'rejected',
        message: '계정 가입이 거절되었습니다. 관리자에게 문의해주세요.'
      });
    }

    const token = generateToken(user);

    res.json({
      message: '로그인 성공',
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        is_admin: user.is_admin,
        status: user.status
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: '로그인 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: '사용자 정보를 불러오는 중 문제가 발생했습니다.' });
  }
});

module.exports = router;

