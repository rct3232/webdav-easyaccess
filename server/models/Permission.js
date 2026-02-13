const permissionStore = require('../store/permissionStore');

class Permission {
  static async grant(userId, folderPath, permission, options) {
    return await permissionStore.grant(userId, folderPath, permission, options);
  }

  static async revoke(userId, folderPath, options) {
    return await permissionStore.revoke(userId, folderPath, options);
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

  static async getFolderPermissions(folderPath, filePath) {
    return await permissionStore.getFolderPermissions(folderPath, filePath);
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

  static async getFilePermission(userId, filePath) {
    return await permissionStore.getFilePermission(userId, filePath);
  }

  static async getEffectivePermission(userId, path) {
    return await permissionStore.getEffectivePermission(userId, path);
  }

  static async grantFile(userId, filePath, permission) {
    return await permissionStore.grant(userId, filePath, permission, { target: 'file' });
  }

  static async revokeFile(userId, filePath) {
    return await permissionStore.revoke(userId, filePath, { scope: 'pathOnly' });
  }

  static async getUserFilePermissions(userId) {
    return await permissionStore.getUserFilePermissions(userId);
  }

  static checkFilePermissionSync(doc, filePath, requiredPermission) {
    return permissionStore.checkFilePermissionSync(doc, filePath, requiredPermission);
  }

  static async getPathEffectivePermission(userId, folderPath) {
    return await permissionStore.getPathEffectivePermission(userId, folderPath);
  }
}

module.exports = Permission;

