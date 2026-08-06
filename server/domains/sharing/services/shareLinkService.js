const ShareLink = require('../../../models/ShareLink');
const permissionStore = require('../../../store/permissionStore');
const { getFileType } = require('@webdav-easyaccess/shared/fileTypes');

function validateExpiration(expiresInDays) {
  if (expiresInDays === null || expiresInDays === undefined) {
    return undefined;
  }
  const days = parseInt(expiresInDays, 10);
  if (isNaN(days) || days < 0) {
    const error = new Error('invalidExpiration');
    error.status = 400;
    throw error;
  }
  return days;
}

function validateNodeId(fileNodeId) {
  if (fileNodeId === null || fileNodeId === undefined || !Number.isFinite(Number(fileNodeId))) {
    const error = new Error('pathRequired');
    error.status = 400;
    throw error;
  }
  return Number(fileNodeId);
}

async function getFileNodeService() {
  const { getComposition } = require('../../../service/composition');
  return getComposition().fileNodeService;
}

function toLinkResponse(link, node) {
  const fileName = node ? node.name : null;
  return {
    token: link.token,
    nodeId: link.nodeId != null ? Number(link.nodeId) : (link.fileNodeId != null ? Number(link.fileNodeId) : null),
    fileName,
    fileType: fileName ? getFileType(fileName) : null,
    isDirectory: node ? node.type === 'directory' : null,
    displayPath: null,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  };
}

async function createShareLink(fileNodeId, userId, expiresInDays) {
  const nodeId = validateNodeId(fileNodeId);
  const fileNodeService = await getFileNodeService();

  const node = await fileNodeService.getNode(nodeId);
  if (!node) {
    const error = new Error('fileNotFound');
    error.status = 404;
    throw error;
  }

  const expiresInDaysValue = validateExpiration(expiresInDays);

  const link = await ShareLink.create(nodeId, userId, expiresInDaysValue);
  await permissionStore.grantSharePermission(link.token, nodeId);

  const displayPath = await fileNodeService.getNodePath(nodeId);
  return {
    ...toLinkResponse(link, node),
    displayPath,
  };
}

async function listUserShareLinks(userId) {
  const links = await ShareLink.findByUserId(userId);
  const fileNodeService = await getFileNodeService();
  const results = [];
  for (const link of links) {
    const node = await fileNodeService.getNode(link.nodeId);
    const displayPath = node ? await fileNodeService.getNodePath(node.id) : null;
    results.push({ ...toLinkResponse(link, node), displayPath });
  }
  return results;
}

async function getShareLinkInfo(token, userId) {
  const link = await ShareLink.findByToken(token);
  if (!link) {
    const error = new Error('shareLinkNotFound');
    error.status = 404;
    throw error;
  }

  if (link.createdBy !== userId) {
    const error = new Error('accessDenied');
    error.status = 403;
    throw error;
  }

  const fileNodeService = await getFileNodeService();
  const node = await fileNodeService.getNode(link.nodeId);
  const displayPath = node ? await fileNodeService.getNodePath(node.id) : null;
  return { ...toLinkResponse(link, node), displayPath };
}

async function updateShareLink(token, expiresInDays, userId) {
  const link = await ShareLink.findByToken(token);
  if (!link) {
    const error = new Error('shareLinkNotFound');
    error.status = 404;
    throw error;
  }

  if (link.createdBy !== userId) {
    const error = new Error('accessDenied');
    error.status = 403;
    throw error;
  }

  const updates = {};
  if (expiresInDays !== undefined) {
    if (expiresInDays === null) {
      updates.expiresAt = null;
    } else {
      const days = parseInt(expiresInDays, 10);
      if (isNaN(days) || days < 0) {
        const error = new Error('invalidExpiration');
        error.status = 400;
        throw error;
      }
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);
      updates.expiresAt = expiryDate.toISOString();
    }
  }

  const updatedLink = await ShareLink.update(token, updates);

  const fileNodeService = await getFileNodeService();
  const node = await fileNodeService.getNode(updatedLink.nodeId);
  const displayPath = node ? await fileNodeService.getNodePath(node.id) : null;
  return { ...toLinkResponse(updatedLink, node), displayPath };
}

async function deleteShareLink(token, userId) {
  const link = await ShareLink.findByToken(token);
  if (!link) {
    const error = new Error('shareLinkNotFound');
    error.status = 404;
    throw error;
  }

  if (link.createdBy !== userId) {
    const error = new Error('accessDenied');
    error.status = 403;
    throw error;
  }

  await ShareLink.delete(token);
  await permissionStore.revokeSharePermission(token);
}

module.exports = {
  createShareLink,
  listUserShareLinks,
  getShareLinkInfo,
  updateShareLink,
  deleteShareLink,
};
