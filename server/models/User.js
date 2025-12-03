const db = require('./database');
const bcrypt = require('bcryptjs');

class User {
  static async create(username, email, password, isAdmin = false) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const status = isAdmin ? 'approved' : 'pending';
    
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO users (username, email, password, status, is_admin) VALUES (?, ?, ?, ?, ?)`;
      db.getDb().run(sql, [username, email, hashedPassword, status, isAdmin ? 1 : 0], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, username, email, status, is_admin: isAdmin ? 1 : 0 });
        }
      });
    });
  }

  static async findByUsername(username) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM users WHERE username = ?`;
      db.getDb().get(sql, [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async findByEmail(email) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM users WHERE email = ?`;
      db.getDb().get(sql, [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT id, username, email, status, is_admin, created_at, updated_at FROM users WHERE id = ?`;
      db.getDb().get(sql, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async findAll() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT id, username, email, status, is_admin, created_at, updated_at FROM users ORDER BY created_at DESC`;
      db.getDb().all(sql, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async findByStatus(status) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT id, username, email, status, is_admin, created_at, updated_at FROM users WHERE status = ? ORDER BY created_at DESC`;
      db.getDb().all(sql, [status], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async updateStatus(userId, status) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      db.getDb().run(sql, [status, userId], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }

  static async updateEmail(userId, newEmail) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      db.getDb().run(sql, [newEmail, userId], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }

  static async delete(userId) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM users WHERE id = ?`;
      db.getDb().run(sql, [userId], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }

  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }

  static async updatePassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    return new Promise((resolve, reject) => {
      const sql = `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      db.getDb().run(sql, [hashedPassword, userId], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }
}

module.exports = User;

