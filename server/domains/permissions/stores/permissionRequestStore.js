'use strict';

/**
 * permissionRequestStore facade — delegates storage to
 * PermissionRequestRepository (docs/spec/server/store/repository-contract.md)
 * and keeps the domain validation / normalization contract here.
 */
const { PERMISSIONS, PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const storage = require('../../../store/storage');
const createPermissionRequestRepository = require('./repositories/PermissionRequestRepository');

// One repository per dialect; `getExecutor()` switches on the active backend.
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createPermissionRequestRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

function normalizePermission(p) {
  if (p === PERMISSIONS.READ || p === PERMISSIONS.WRITE) return p;
  return null;
}

function normalizeStatus(s) {
  return PERMISSION_REQUEST_STATUS.isValid(s) ? s : null;
}

async function createRequest({
  requesterId,
  requesterUsername,
  ownerId,
  ownerUsername,
  fileNodeId,
  requestedPermission,
  message = '',
}) {
  const perm = normalizePermission(requestedPermission);
  if (!perm) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidPermission, 400);
  }

  if (!fileNodeId || !Number.isInteger(fileNodeId)) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired, 400);
  }

  return getRepository().insertPendingRequest({
    requesterId,
    requesterUsername,
    ownerId,
    ownerUsername,
    fileNodeId,
    requestedPermission: perm,
    message,
  });
}

async function getById(id) {
  return getRepository().getById(id);
}

async function listInbox(ownerId, { status } = {}) {
  return getRepository().listByOwner(ownerId, status ? normalizeStatus(status) : null);
}

async function listOutbox(requesterId, { status } = {}) {
  return getRepository().listByRequester(requesterId, status ? normalizeStatus(status) : null);
}

async function updateStatus(id, { status, resolvedBy } = {}) {
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidStatus, 400);
  }
  return getRepository().updateStatusRow(id, nextStatus, resolvedBy);
}

async function deleteByRequesterId(userId) {
  return getRepository().deleteByRequesterId(userId);
}

async function rejectByOwnerId(userId, resolvedBy = null) {
  return getRepository().rejectPendingByOwnerId(userId, resolvedBy);
}

module.exports = {
  createRequest,
  getById,
  listInbox,
  listOutbox,
  updateStatus,
  deleteByRequesterId,
  rejectByOwnerId,
};
