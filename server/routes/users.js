const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../utils/auth');

// Get all users (admin only - simplified for now)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = require('../models/database').getDb();
    const sql = `SELECT id, username, email, created_at FROM users`;
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch users' });
      }
      res.json(rows);
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update password
router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    // Only allow users to update their own password
    if (parseInt(req.params.id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    await User.updatePassword(req.params.id, password);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

module.exports = router;

