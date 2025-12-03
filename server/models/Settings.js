const db = require('./database');

class Settings {
  static async get(key) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT value FROM settings WHERE key = ?`;
      db.getDb().get(sql, [key], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.value : null);
      });
    });
  }

  static async set(key, value) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
      db.getDb().run(sql, [key, value], function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  }

  static async getAll() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT key, value, updated_at FROM settings`;
      db.getDb().all(sql, [], (err, rows) => {
        if (err) reject(err);
        else {
          const settings = {};
          rows.forEach(row => {
            settings[row.key] = row.value;
          });
          resolve(settings);
        }
      });
    });
  }

  static async isRegistrationEnabled() {
    const value = await this.get('registration_enabled');
    return value === 'true';
  }
}

module.exports = Settings;


