const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const { getDatabasePath } = require('../utils/paths');
const DB_PATH = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : getDatabasePath();

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const dbDir = path.dirname(DB_PATH);
      
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      if (!path.isAbsolute(DB_PATH)) {
        return reject(new Error(`DB_PATH must be absolute path, got: ${DB_PATH}`));
      }
      
      const normalizedPath = DB_PATH.replace(/\\/g, '/');
      if (normalizedPath.includes('/server/data/')) {
        return reject(new Error(`DB_PATH must be in project root/data/, not server/data/: ${DB_PATH}`));
      }

          this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          this.createTables()
            .then(() => this.initDefaultAdmin())
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Users table (service accounts)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Folder permissions table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS folder_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            folder_path TEXT NOT NULL,
            permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, folder_path)
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Create index for faster lookups
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_folder_permissions_user ON folder_permissions(user_id)`, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Last operation - resolve when this completes
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_folder_permissions_path ON folder_permissions(folder_path)`, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('Database tables created');
            resolve();
          }
        });
      });
    });
  }

  async initDefaultAdmin() {
    const User = require('./User');
    const Permission = require('./Permission');
    
    try {
      // Check if admin user already exists
      const existingAdmin = await User.findByUsername('admin');
      
      if (!existingAdmin) {
        // Create default admin account
        const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin';
        const adminUser = await User.create('admin', 'admin@webdav.local', defaultPassword);
        
        // Grant admin permission to root folder
        await Permission.grant(adminUser.id, '/', 'admin');
        
        console.log('Default admin account created:');
        console.log('  Username: admin');
        console.log('  Password: ' + defaultPassword);
        console.log('  ⚠️  Please change the default password after first login!');
      }
    } catch (error) {
      console.error('Error initializing default admin:', error);
      // Don't reject - allow server to start even if admin creation fails
    }
  }

  getDb() {
    return this.db;
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new Database();

