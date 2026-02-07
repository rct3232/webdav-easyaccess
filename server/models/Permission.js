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

  static async deleteUserPermissionsFile(userId) {
    return await permissionStore.deleteUserPermissionsFile(userId);
  }

  static async getUserPermissions(userId) {
    return await permissionStore.getUserPermissions(userId);
  }

  static async checkPermission(userId, folderPath, requiredPermission) {
    return await permissionStore.checkPermission(userId, folderPath, requiredPermission);
  }

  static checkPermissionSync(doc, folderPath, requiredPermission) {
    return permissionStore.checkPermissionSync(doc, folderPath, requiredPermission);
  }

  static async getPermissionDoc(userId) {
    return await permissionStore.getPermissionDoc(userId);
  }

  static async checkPermissions(userId, paths, requiredPermission) {
    return await permissionStore.checkPermissions(userId, paths, requiredPermission);
  }

  static async getFolderPermissions(folderPath) {
    return await permissionStore.getFolderPermissions(folderPath);
  }

  static async hasPermissionsInPath(folderPath) {
    return await permissionStore.hasPermissionsInPath(folderPath);
  }

  static async rewritePermissionsForAllUsers(mappings, options) {
    return await permissionStore.rewritePermissionsForAllUsers(mappings, options);
  }

  static async revokePermissionsPrefixForAllUsers(prefixes) {
    return await permissionStore.revokePermissionsPrefixForAllUsers(prefixes);
  }
}

module.exports = Permission;

