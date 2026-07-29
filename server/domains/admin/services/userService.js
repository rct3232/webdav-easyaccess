'use strict';
const bcrypt = require('bcryptjs');
const {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const Permission = require('../../../models/Permission');
const PermissionRequest = require('../../../models/PermissionRequest');
const { sendApprovalEmail, sendRejectionEmail } = require('../../../utils/email');
const { createDirectory, pathExists } = require('../../../utils/webdav');
const { createError, validationError } = require('../../../utils/errorHandler');

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
    await Permission.grant(createdUser.id, userFolder, PERMISSIONS.ADMIN);

    const hasPermission = await Permission.checkPermission(createdUser.id, userFolder, PERMISSIONS.ADMIN);
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
    await Permission.grant(userId, `/${user.username}`, PERMISSIONS.ADMIN);

    const hasPermission = await Permission.checkPermission(userId, `/${user.username}`, PERMISSIONS.ADMIN);
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
  await Permission.revokeAllUserPermissions(userId);
  await Permission.deleteUserPermissionsFile(userId);
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
  await Permission.revokeAllUserPermissions(userId);
  await Permission.deleteUserPermissionsFile(userId);
  await User.delete(userId);

  return { id: user.id, username: user.username, email: user.email };
}

async function bulkUpdateUserPermissions(userId, permissionEntries) {
  if (!Array.isArray(permissionEntries)) {
    throw validationError(SERVER_ERROR_CODES.admin.invalidPermissionList);
  }

  await Permission.revokeAllUserPermissions(userId);

  for (const perm of permissionEntries) {
    if (perm.folderPath && perm.permission && PERMISSIONS.isValid(perm.permission)) {
      await Permission.grant(userId, perm.folderPath, perm.permission);
    }
  }

  return true;
}

module.exports = {
  createAdminUser,
  approvePendingUser,
  rejectPendingUser,
  deleteUserCascade,
  bulkUpdateUserPermissions,
};
