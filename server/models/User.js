const bcrypt = require('bcryptjs');
const userStore = require('../store/userStore');

class User {
  static async create(username, email, password, isAdmin = false) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userObj = await userStore.createUser({
      username,
      email,
      passwordHash: hashedPassword,
      isAdmin,
    });
    return {
      id: userObj.id,
      username: userObj.username,
      email: userObj.email,
      status: userObj.status,
      is_admin: userObj.is_admin,
    };
  }

  static async findByUsername(username) {
    return await userStore.findByUsername(username);
  }

  static async findByEmail(email) {
    return await userStore.findByEmail(email);
  }

  static async findById(id) {
    const u = await userStore.findById(id);
    if (!u) return undefined;
    // Do not expose password hash here
    // Match previous behavior (no password field)
    // eslint-disable-next-line no-unused-vars
    const { password, ...rest } = u;
    return rest;
  }

  static async findAll() {
    const users = await userStore.findAll();
    return users.map((u) => {
      // eslint-disable-next-line no-unused-vars
      const { password, ...rest } = u;
      return rest;
    });
  }

  static async findByStatus(status) {
    const users = await userStore.findByStatus(status);
    return users.map((u) => {
      // eslint-disable-next-line no-unused-vars
      const { password, ...rest } = u;
      return rest;
    });
  }

  static async updateStatus(userId, status) {
    return await userStore.updateStatus(userId, status);
  }

  static async updateEmail(userId, newEmail) {
    return await userStore.updateEmail(userId, newEmail);
  }

  static async delete(userId) {
    return await userStore.deleteUser(userId);
  }

  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }

  static async updatePassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return await userStore.updatePassword(userId, hashedPassword);
  }
}

module.exports = User;
