const permissionRequestStore = require('../store/permissionRequestStore');

class PermissionRequest {
  static async ensureFile() {
    return await permissionRequestStore.ensurePermissionRequestsFile();
  }

  static async create(payload) {
    return await permissionRequestStore.createRequest(payload);
  }

  static async findById(id) {
    return await permissionRequestStore.getById(id);
  }

  static async listInbox(ownerId, opts) {
    return await permissionRequestStore.listInbox(ownerId, opts);
  }

  static async listOutbox(requesterId, opts) {
    return await permissionRequestStore.listOutbox(requesterId, opts);
  }

  static async updateStatus(id, opts) {
    return await permissionRequestStore.updateStatus(id, opts);
  }

  static async deleteByRequesterId(userId) {
    return await permissionRequestStore.deleteByRequesterId(userId);
  }

  static async rejectByOwnerId(userId, resolvedBy = null) {
    return await permissionRequestStore.rejectByOwnerId(userId, resolvedBy);
  }
}

module.exports = PermissionRequest;

