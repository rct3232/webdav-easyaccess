import {
  getUserPermissions as getUserPermissionsService,
  getFolderPermissions as getFolderPermissionsService,
  checkPermission as checkPermissionService,
  grantPermission as grantPermissionService,
  revokePermission as revokePermissionService,
} from './permissionService';

import {
  checkOwnerExists as checkOwnerExistsService,
  listOutboxPermissionRequests as listOutboxPermissionRequestsService,
  createPermissionRequest as createPermissionRequestService,
  cancelPermissionRequest as cancelPermissionRequestService,
  approvePermissionRequest as approvePermissionRequestService,
} from './permissionRequestService';

import { updateUserPermissions as updateUserPermissionsService } from './userService';

export const getUserPermissions = async (userId, options) => {
  return getUserPermissionsService(userId, options);
};

export const getFolderPermissions = async (path, includeSubfolders = false, filePath) => {
  return getFolderPermissionsService(path, includeSubfolders, filePath);
};

export const checkPermission = async (path) => {
  return checkPermissionService(path);
};

export const checkOwnerExists = async (path, { forFile } = {}) => {
  return checkOwnerExistsService(path, { forFile });
};

export const listOutboxPermissionRequests = async (params) => {
  return listOutboxPermissionRequestsService(params);
};

export const createPermissionRequest = async (payload) => {
  return createPermissionRequestService(payload);
};

export const cancelPermissionRequest = async (id) => {
  return cancelPermissionRequestService(id);
};

export const grantPermission = async ({ userId, folderPath, permission, target }) => {
  return grantPermissionService({ userId, folderPath, permission, target });
};

export const revokePermission = async ({ userId, folderPath, includeSubfolders, scope }) => {
  return revokePermissionService({ userId, folderPath, includeSubfolders, scope });
};

export const approvePermissionRequest = async (id) => {
  return approvePermissionRequestService(id);
};

export const updateUserPermissions = async (userId, permissions) => {
  return updateUserPermissionsService(userId, permissions);
};

const sharePermissionGateway = {
  getUserPermissions,
  getFolderPermissions,
  checkPermission,
  checkOwnerExists,
  listOutboxPermissionRequests,
  createPermissionRequest,
  cancelPermissionRequest,
  grantPermission,
  revokePermission,
  approvePermissionRequest,
  updateUserPermissions,
};

export default sharePermissionGateway;

