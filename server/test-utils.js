/**
 * Test utility functions for creating test data and managing test database
 */

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

/**
 * Create an in-memory SQLite database for testing
 * @returns {Promise<sqlite3.Database>} Database instance
 */
function createTestDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

/**
 * Initialize database schema for testing
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
function initializeTestSchema(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          is_admin INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Folder permissions table
      db.run(`
        CREATE TABLE IF NOT EXISTS folder_permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          folder_path TEXT NOT NULL,
          permission TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, folder_path),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Settings table
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Create a test user
 * @param {sqlite3.Database} db - Database instance
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user
 */
async function createTestUser(db, userData = {}) {
  const {
    username = 'testuser',
    email = 'test@example.com',
    password = 'password123',
    isAdmin = false,
    status = 'approved'
  } = userData;

  const hashedPassword = await bcrypt.hash(password, 10);

  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO users (username, email, password, status, is_admin) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [username, email, hashedPassword, status, isAdmin ? 1 : 0], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({
          id: this.lastID,
          username,
          email,
          status,
          is_admin: isAdmin ? 1 : 0
        });
      }
    });
  });
}

/**
 * Create a test JWT token
 * @param {Object} user - User object
 * @returns {string} JWT token
 */
function createTestToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Grant permission to a user
 * @param {sqlite3.Database} db - Database instance
 * @param {number} userId - User ID
 * @param {string} folderPath - Folder path
 * @param {string} permission - Permission type (read/write)
 * @returns {Promise<Object>}
 */
function grantTestPermission(db, userId, folderPath, permission = 'read') {
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR REPLACE INTO folder_permissions (user_id, folder_path, permission) VALUES (?, ?, ?)`;
    db.run(sql, [userId, folderPath, permission], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, userId, folderPath, permission });
      }
    });
  });
}

/**
 * Clean up database (delete all records)
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
function cleanupTestDatabase(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM folder_permissions');
      db.run('DELETE FROM users');
      db.run('DELETE FROM settings', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Close database connection
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
function closeTestDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  createTestDatabase,
  initializeTestSchema,
  createTestUser,
  createTestToken,
  grantTestPermission,
  cleanupTestDatabase,
  closeTestDatabase
};

