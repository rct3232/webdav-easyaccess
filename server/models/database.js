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
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            is_admin INTEGER DEFAULT 0,
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

        // Settings table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_folder_permissions_path ON folder_permissions(folder_path)`, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Add status and is_admin columns if they don't exist (migration)
        this.db.run(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'approved'`, (err) => {
          // Ignore error if column already exists
        });

        this.db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, (err) => {
          // Ignore error if column already exists
          
          // Initialize default settings
          this.db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_enabled', 'false')`, (err) => {
            if (err) {
              console.error('Failed to initialize settings:', err);
            }
            console.log('Database tables created');
            resolve();
          });
        });
      });
    });
  }

  async initDefaultAdmin() {
    const User = require('./User');
    const Permission = require('./Permission');
    
    try {
      const existingAdmin = await User.findByUsername('admin');
      
      if (!existingAdmin) {
        const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin';
        const adminUser = await User.create('admin', 'admin@webdav.local', defaultPassword, true);
        await Permission.grant(adminUser.id, '/', 'admin');
        
        console.log('Default admin account created:');
        console.log('  Username: admin');
        console.log('  Password: ' + defaultPassword);
        console.log('  ⚠️  Please change the default password after first login!');
      } else {
        // Update existing admin account to ensure is_admin is set
        await new Promise((resolve, reject) => {
          this.db.run(
            `UPDATE users SET is_admin = 1, status = 'approved' WHERE username = 'admin'`,
            (err) => {
              if (err) {
                console.error('Failed to update admin account:', err);
                reject(err);
              } else {
                console.log('Admin account updated with is_admin flag');
                resolve();
              }
            }
          );
        });
      }

      // Migrate all existing users to have approved status
      await new Promise((resolve, reject) => {
        this.db.run(
          `UPDATE users SET status = 'approved' WHERE status IS NULL OR status = ''`,
          (err) => {
            if (err) {
              console.error('Failed to migrate user statuses:', err);
              reject(err);
            } else {
              console.log('Migrated existing users to approved status');
              resolve();
            }
          }
        );
      });

      // Ensure all approved users have permissions to their own folders
      const allUsers = await User.findAll();
      console.log(`Found ${allUsers.length} users to check permissions`);
      
      for (const user of allUsers) {
        console.log(`Checking user: ${user.username}, status: ${user.status}, is_admin: ${user.is_admin}`);
        
        if (user.status === 'approved' && !user.is_admin) {
          const userFolder = `/${user.username}`;
          const existingPermission = await Permission.getUserPermissions(user.id);
          const hasOwnFolderPermission = existingPermission.some(p => p.folder_path === userFolder);
          
          console.log(`User ${user.username}: has permission for ${userFolder}? ${hasOwnFolderPermission}`);
          
          if (!hasOwnFolderPermission) {
            try {
              await Permission.grant(user.id, userFolder, 'admin');
              console.log(`✓ Granted permission to ${user.username} for folder ${userFolder}`);
            } catch (e) {
              console.error(`Failed to grant permission to ${user.username}:`, e.message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error initializing default admin:', error);
      console.error('Error stack:', error.stack);
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

