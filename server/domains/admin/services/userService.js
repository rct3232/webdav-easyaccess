'use strict';
const bcrypt = require('bcryptjs');
const {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const permissionStore = require('../../../store/permissionStore');
const PermissionRequest = require('../../../models/PermissionRequest');
const { sendApprovalEmail, sendRejectionEmail } = require('../../../utils/email');
const { createDirectory, pathExists } = require('../../../utils/webdav');
const { createError, validationError, notFoundError, conflictError } = require('../../../utils/errorHandler');
const { revokeAllUserTokens } = require('../../../domains/auth/service');

async function createAdminUser({ username, email, password, isAdmin }) {
  let createdUser = null;

  if (!username || !email || !password) {
    throw validationError(SERVER_ERROR_CODES.admin.createUserRequiredFields);
  }

  if (password.length < 6) {
    throw validationError(SERVER_ERROR_CODES.admin.passwordMinLength);
  }

  const existingUser = await User.findByUsername(username);
  if (existingUser) {
    throw validationError(SERVER_ERROR_CODES.admin.usernameTaken);
  }

  const existingEmail = await User.findByEmail(email);
  if (existingEmail) {
    throw validationError(SERVER_ERROR_CODES.admin.emailTaken);
  }

  const userFolder = `/${username}`;

  createdUser = await User.create(username, email, password, false);
  await User.updateStatus(createdUser.id, USER_STATUS.APPROVED);

  try {
    const folderExists = await pathExists(userFolder);
    if (!folderExists) {
      await createDirectory(userFolder);
    }

    const folderExistsAfter = await pathExists(userFolder);
    if (!folderExistsAfter) {
      throw createError(SERVER_ERROR_CODES.admin.userFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (folderError) {
    console.error('[Admin Create] Failed to check or create user folder:', folderError);
    await User.delete(createdUser.id);
    throw createError(SERVER_ERROR_CODES.admin.userFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  try {
    await permissionStore.grant(createdUser.id, userFolder, PERMISSIONS.ADMIN);

    const hasPermission = await permissionStore.checkPermission(createdUser.id, userFolder, PERMISSIONS.ADMIN);
    if (!hasPermission) {
      throw createError(SERVER_ERROR_CODES.admin.userPermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (permError) {
    console.error('[Admin Create] Failed to grant permissions:', permError);
    await User.delete(createdUser.id);
    throw createError(SERVER_ERROR_CODES.admin.userPermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  return {
    id: createdUser.id,
    username: createdUser.username,
    email: createdUser.email,
    status: USER_STATUS.APPROVED,
    is_admin: false,
  };
}

async function approvePendingUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.userNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (user.status !== USER_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.admin.notPending);
  }

  await User.updateStatus(userId, USER_STATUS.APPROVED);

  const userFolder = `/${user.username}`;
  try {
    const folderExists = await pathExists(userFolder);
    if (!folderExists) {
      await createDirectory(userFolder);
    }

    const folderExistsAfter = await pathExists(userFolder);
    if (!folderExistsAfter) {
      throw createError(SERVER_ERROR_CODES.admin.approveFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (folderError) {
    console.error(`[Admin] Failed to check or create user folder:`, folderError);
    await User.updateStatus(userId, USER_STATUS.PENDING);
    throw createError(SERVER_ERROR_CODES.admin.approveFolderFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  try {
    await permissionStore.grant(userId, `/${user.username}`, PERMISSIONS.ADMIN);

    const hasPermission = await permissionStore.checkPermission(userId, `/${user.username}`, PERMISSIONS.ADMIN);
    if (!hasPermission) {
      throw createError(SERVER_ERROR_CODES.admin.approvePermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (permError) {
    console.error(`[Admin] Failed to grant permissions:`, permError);
    await User.updateStatus(userId, USER_STATUS.PENDING);
    throw createError(SERVER_ERROR_CODES.admin.approvePermissionFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  try {
    await sendApprovalEmail(user.email, user.username);
  } catch (emailError) {
    console.error('[Admin] Failed to send approval email:', emailError);
  }

  return { id: user.id, username: user.username, email: user.email, status: USER_STATUS.APPROVED };
}

async function rejectPendingUser(userId, adminId) {
  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.rejectNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (user.status !== USER_STATUS.PENDING) {
    throw validationError(SERVER_ERROR_CODES.admin.notPendingReject);
  }

  try {
    await sendRejectionEmail(user.email, user.username);
  } catch (emailError) {
    console.error('[Admin] Failed to send rejection email:', emailError);
  }

  await PermissionRequest.deleteByRequesterId(userId);
  await PermissionRequest.rejectByOwnerId(userId, adminId);
  await permissionStore.revokeAllUserPermissions(userId);
  await permissionStore.deleteUserPermissionsFile(userId);
  await User.updateStatus(userId, USER_STATUS.REJECTED);

  return { id: user.id, username: user.username, email: user.email };
}

async function deleteUserCascade(userId, adminId) {
  if (userId === adminId) {
    throw validationError(SERVER_ERROR_CODES.admin.deleteSelf);
  }

  const user = await User.findById(userId);

  if (!user) {
    throw createError(SERVER_ERROR_CODES.admin.deleteNotFound, HTTP_STATUS.NOT_FOUND);
  }

  if (user.is_admin) {
    throw validationError(SERVER_ERROR_CODES.admin.deleteOtherAdmin);
  }

  await PermissionRequest.deleteByRequesterId(userId);
  await PermissionRequest.rejectByOwnerId(userId, adminId);
  await permissionStore.revokeAllUserPermissions(userId);
  await permissionStore.deleteUserPermissionsFile(userId);
  await User.delete(userId);

  return { id: user.id, username: user.username, email: user.email };
}

async function bulkUpdateUserPermissions(userId, permissionEntries) {
  if (!Array.isArray(permissionEntries)) {
    throw validationError(SERVER_ERROR_CODES.admin.invalidPermissionList);
  }

  await permissionStore.revokeAllUserPermissions(userId);

  for (const perm of permissionEntries) {
    if (perm.folderPath && perm.permission && PERMISSIONS.isValid(perm.permission)) {
      await permissionStore.grant(userId, perm.folderPath, perm.permission);
    }
  }

  return true;
}

async function listUsers() {
  const users = await User.findAll();
  return users.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email,
    created_at: u.created_at,
  }));
}

async function listApprovedUsers(requesterId) {
  const approved = await User.findByStatus(USER_STATUS.APPROVED);
  const rows = approved
    .filter(u => !u.is_admin)
    .map(u => ({ id: u.id, username: u.username, email: u.email }))
    .sort((a, b) => a.username.localeCompare(b.username));
  return rows.filter(user => user.id !== requesterId);
}

async function getUserById(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw notFoundError(SERVER_ERROR_CODES.auth.userNotFound);
  }
  return user;
}

async function updatePassword(userId, newPassword) {
  await User.updatePassword(parseInt(userId, 10), newPassword);
  revokeAllUserTokens(parseInt(userId, 10));
}

async function updateEmail(userId, newEmail) {
  const existingEmail = await User.findByEmail(newEmail);
  if (existingEmail && existingEmail.id !== parseInt(userId)) {
    throw conflictError(SERVER_ERROR_CODES.auth.emailTaken);
  }
  await User.updateEmail(userId, newEmail);
}

module.exports = {
  createAdminUser,
  approvePendingUser,
  rejectPendingUser,
  deleteUserCascade,
  bulkUpdateUserPermissions,
  listUsers,
  listApprovedUsers,
  getUserById,
  updatePassword,
  updateEmail,
};
