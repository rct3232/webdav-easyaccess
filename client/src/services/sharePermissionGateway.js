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

export const getFolderPermissions = async (nodeId, fileNodeId) => {
  return getFolderPermissionsService(nodeId, fileNodeId);
};

export const checkPermission = async (nodeId) => {
  return checkPermissionService(nodeId);
};

export const checkOwnerExists = async (nodeId) => {
  return checkOwnerExistsService(nodeId);
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

export const grantPermission = async ({ userId, nodeId, permission, target }) => {
  return grantPermissionService({ userId, nodeId, permission, target });
};

export const revokePermission = async ({ userId, nodeId, scope }) => {
  return revokePermissionService({ userId, nodeId, scope });
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

