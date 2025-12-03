const db = require('./database');
const bcrypt = require('bcryptjs');

class User {
  static async create(username, email, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`;
      db.getDb().run(sql, [username, email, hashedPassword], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, username, email });
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
      const sql = `SELECT id, username, email, created_at FROM users WHERE id = ?`;
      db.getDb().get(sql, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
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

