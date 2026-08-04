const ShareLink = require('../../../models/ShareLink');
const permissionStore = require('../../../store/permissionStore');
const { pathExists, listDirectory } = require('../../../utils/webdav');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../../../store/metaPaths');

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

async function detectIsDirectory(normalizedPath) {
  try {
    await listDirectory(normalizedPath);
    return true;
  } catch (_) {
    try {
      const alt = normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath + '/';
      await listDirectory(alt);
      return true;
    } catch (_2) {
      return false;
    }
  }
}

async function createShareLink(filePath, userId, expiresInDays) {
  if (!filePath) {
    const error = new Error('pathRequired');
    error.status = 400;
    throw error;
  }

  const normalizedPath = normalizePath(filePath);

  if (isMetaPath(normalizedPath)) {
    const error = new Error('cannotAddShare');
    error.status = 403;
    throw error;
  }

  const exists = await pathExists(normalizedPath);
  if (!exists) {
    const error = new Error('fileNotFound');
    error.status = 404;
    throw error;
  }

  const isDirectory = await detectIsDirectory(normalizedPath);
  const expiresInDaysValue = validateExpiration(expiresInDays);

  const link = await ShareLink.create(normalizedPath, userId, expiresInDaysValue);
  await permissionStore.grantSharePermission(link.token, normalizedPath, isDirectory);

  return {
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
  };
}

async function listUserShareLinks(userId) {
  const links = await ShareLink.findByUserId(userId);
  return links.map(link => ({
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  }));
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

  return {
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  };
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

  return {
    token: updatedLink.token,
    filePath: updatedLink.filePath,
    createdAt: updatedLink.createdAt,
    expiresAt: updatedLink.expiresAt,
    downloadCount: updatedLink.downloadCount,
    isExpired: ShareLink.isExpired(updatedLink),
  };
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
