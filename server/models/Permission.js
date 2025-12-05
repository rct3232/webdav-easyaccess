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
        SELECT u.id, u.username, u.email, u.is_admin, fp.permission 
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
      // 경로 정규화 (끝에 / 제거)
      const normalizePath = (p) => {
        if (!p || p === '/') return '/';
        return p.endsWith('/') ? p.slice(0, -1) : p;
      };
      
      const normalizedPath = normalizePath(folderPath);
      const normalizedPathWithSlash = normalizedPath === '/' ? '/' : normalizedPath + '/';
      
      // 정확히 해당 경로에 대한 권한만 검색 (상위 경로 제외)
      // 예: /test/folder -> /test/folder 또는 /test/folder/subfolder 만 찾음
      // /test/ 같은 상위 경로는 제외
      const sql = `
        SELECT u.id, u.username, u.email, u.is_admin, fp.folder_path, fp.permission 
        FROM folder_permissions fp
        JOIN users u ON fp.user_id = u.id
        WHERE (fp.folder_path = ? OR fp.folder_path = ? OR fp.folder_path LIKE ?)
      `;
      // 하위 경로만 검색 (상위 경로 제외)
      const likePattern = `${normalizedPathWithSlash}%`;
      
      db.getDb().all(sql, [normalizedPath, normalizedPathWithSlash, likePattern], (err, rows) => {
        if (err) reject(err);
        else {
          // 상위 경로 제외: 정확히 해당 경로이거나 하위 경로만 반환
          const filtered = rows.filter(row => {
            const rowPath = normalizePath(row.folder_path);
            // 정확히 같은 경로이거나 해당 경로의 하위 경로인 경우만
            return rowPath === normalizedPath || 
                   (rowPath.startsWith(normalizedPathWithSlash) && rowPath.length > normalizedPathWithSlash.length);
          });
          resolve(filtered);
        }
      });
    });
  }
}

module.exports = Permission;

