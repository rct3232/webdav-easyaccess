const settingsStore = require('../store/settingsStore');

class Settings {
  static async get(key) {
    return await settingsStore.get(key);
  }

  static async set(key, value) {
    return await settingsStore.set(key, value);
  }

  static async getAll() {
    return await settingsStore.getAll();
  }

  static async isRegistrationEnabled() {
    return await settingsStore.isRegistrationEnabled();
  }
}

module.exports = Settings;


