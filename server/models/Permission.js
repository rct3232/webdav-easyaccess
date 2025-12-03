const db = require('./database');

class Permission {
  static async grant(userId, folderPath, permission) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT OR REPLACE INTO folder_permissions (user_id, folder_path, permission) VALUES (?, ?, ?)`;
      db.getDb().run(sql, [userId, folderPath, permission], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, userId, folderPath, permission });
      });
    });
  }

  static async revoke(userId, folderPath) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM folder_permissions WHERE user_id = ? AND folder_path = ?`;
      db.getDb().run(sql, [userId, folderPath], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }

  static async revokeAllUserPermissions(userId) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM folder_permissions WHERE user_id = ?`;
      db.getDb().run(sql, [userId], function(err) {
        if (err) reject(err);
        else resolve({ success: true, deletedCount: this.changes });
      });
    });
  }

  static async getUserPermissions(userId) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT folder_path, permission FROM folder_permissions WHERE user_id = ?`;
      db.getDb().all(sql, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async checkPermission(userId, folderPath, requiredPermission) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT permission FROM folder_permissions WHERE user_id = ? AND folder_path = ?`;
      db.getDb().get(sql, [userId, folderPath], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(false);
        } else {
          const permissions = ['read', 'write', 'admin'];
          const userPermission = permissions.indexOf(row.permission);
          const required = permissions.indexOf(requiredPermission);
          resolve(userPermission >= required);
        }
      });
    });
  }

  static async getFolderPermissions(folderPath) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT u.id, u.username, u.email, fp.permission 
        FROM folder_permissions fp
        JOIN users u ON fp.user_id = u.id
        WHERE fp.folder_path = ?
      `;
      db.getDb().all(sql, [folderPath], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async hasPermissionsInPath(folderPath) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT u.id, u.username, u.email, fp.folder_path, fp.permission 
        FROM folder_permissions fp
        JOIN users u ON fp.user_id = u.id
        WHERE fp.folder_path = ? OR fp.folder_path LIKE ?
      `;
      const likePattern = folderPath.endsWith('/') ? `${folderPath}%` : `${folderPath}/%`;
      db.getDb().all(sql, [folderPath, likePattern], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

module.exports = Permission;

