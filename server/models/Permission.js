const permissionStore = require('../store/permissionStore');

class Permission {
  static async grant(userId, folderPath, permission) {
    return await permissionStore.grant(userId, folderPath, permission);
  }

  static async revoke(userId, folderPath) {
    return await permissionStore.revoke(userId, folderPath);
  }

  static async revokeAllUserPermissions(userId) {
    return await permissionStore.revokeAllUserPermissions(userId);
  }

  static async getUserPermissions(userId) {
    return await permissionStore.getUserPermissions(userId);
  }

  static async checkPermission(userId, folderPath, requiredPermission) {
    return await permissionStore.checkPermission(userId, folderPath, requiredPermission);
  }

  static async getFolderPermissions(folderPath) {
    return await permissionStore.getFolderPermissions(folderPath);
  }

  static async hasPermissionsInPath(folderPath) {
    return await permissionStore.hasPermissionsInPath(folderPath);
  }
}

module.exports = Permission;

