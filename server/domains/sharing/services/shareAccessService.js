const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { getFileType, getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const ShareLink = require('../../../models/ShareLink');
const permissionStore = require('../../../store/permissionStore');
const User = require('../../../models/User');
const { pathExists, listDirectory, getFileContents } = require('../../../utils/webdav');
const { meetsRank } = require('../../permissions/policy/permissionRank');

async function collectPathsUnderSharePath(rootPath) {
  let items;
  try {
    items = await listDirectory(rootPath);
  } catch (_) {
    return [rootPath];
  }
  const paths = [rootPath];
  const prefix = rootPath === '/' ? '' : rootPath;
  for (const item of items) {
    if (!item.basename || item.basename.trim() === '') continue;
    const childPath = prefix ? `${prefix}/${item.basename}` : `/${item.basename}`;
    paths.push(childPath);
    const sub = await collectPathsUnderSharePath(childPath);
    for (let i = 1; i < sub.length; i++) paths.push(sub[i]);
  }
  return paths;
}

async function collectDirectoryPathsUnderSharePath(rootPath) {
  let items;
  try {
    items = await listDirectory(rootPath);
  } catch (_) {
    return [];
  }
  const paths = [rootPath];
  const prefix = rootPath === '/' ? '' : rootPath;
  for (const item of items) {
    if (!item.basename || item.basename.trim() === '') continue;
    const childPath = prefix ? `${prefix}/${item.basename}` : `/${item.basename}`;
    const sub = await collectDirectoryPathsUnderSharePath(childPath);
    if (sub.length > 0) {
      paths.push(childPath);
      for (let i = 1; i < sub.length; i++) paths.push(sub[i]);
    }
  }
  return paths;
}

async function resolveShareLink(token) {
  const link = await ShareLink.findByToken(token);
  if (!link) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'shareLinkNotFound' };
  }
  if (ShareLink.isExpired(link)) {
    return { error: 'expired', status: HTTP_STATUS.GONE, code: 'shareLinkExpired' };
  }
  return { link };
}

async function getShareLinkMetadata(token) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  const fileName = link.filePath.split('/').pop();
  const fileType = getFileType(fileName);

  let isDirectory = false;
  try {
    const shareDoc = await permissionStore.getSharePermissionDoc(token);
    if (shareDoc) {
      isDirectory = Boolean(shareDoc.isDirectory);
    }
  } catch (_) {}

  return {
    data: {
      token: link.token,
      filePath: link.filePath,
      fileName,
      fileType,
      isDirectory,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      downloadCount: link.downloadCount,
      isExpired: ShareLink.isExpired(link),
    },
  };
}

async function checkUserSharePermission(token, userId) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const folderPath = normalizePath(result.link.filePath);
  const pathsToCheck = await collectPathsUnderSharePath(folderPath);

  let hasSufficientPermission = true;
  let firstMissingPath = null;

  for (const p of pathsToCheck) {
    const effective = await permissionStore.getEffectivePermission(userId, p);
    if (!effective || !meetsRank(effective, PERMISSIONS.READ)) {
      hasSufficientPermission = false;
      firstMissingPath = p;
      break;
    }
  }

  return {
    data: {
      hasSufficientPermission,
      ...(hasSufficientPermission ? {} : { path: firstMissingPath ?? folderPath }),
    },
  };
}

async function addToMyPermissions(token, userId) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const folderPath = normalizePath(link.filePath);
  const createdBy = link.createdBy;
  if (!createdBy) {
    return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
  }

  const creatorUser = await User.findById(createdBy);
  if (!creatorUser) {
    return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
  }

  const isAdmin = Boolean(creatorUser.is_admin);
  const isOwner = folderPath === `/${creatorUser.username}` || folderPath.startsWith(`/${creatorUser.username}/`);
  if (!isAdmin && !isOwner) {
    const hasAdmin = await permissionStore.checkPermission(createdBy, folderPath, PERMISSIONS.ADMIN);
    if (!hasAdmin) {
      return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
    }
  }

  const dirPaths = await collectDirectoryPathsUnderSharePath(folderPath);
  const pathsToGrant = dirPaths.length > 0 ? dirPaths : [folderPath];
  for (const p of pathsToGrant) {
    const effective = await permissionStore.getEffectivePermission(userId, p);
    if (effective && meetsRank(effective, PERMISSIONS.READ)) continue;
    await permissionStore.grant(userId, p, PERMISSIONS.READ);
  }

  return { data: { messageCode: 'addedToShared' } };
}

async function previewFile(token) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  try {
    const buffer = await getFileContents(link.filePath);
    const fileName = link.filePath.split('/').pop();
    const contentType = getContentType(fileName);

    return {
      data: {
        buffer,
        fileName,
        contentType,
      },
    };
  } catch (error) {
    return { error: 'previewFail', status: HTTP_STATUS.INTERNAL_SERVER_ERROR, code: 'previewFail' };
  }
}

async function downloadFile(token) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  try {
    const buffer = await getFileContents(link.filePath);
    const fileName = link.filePath.split('/').pop();

    await ShareLink.incrementDownloadCount(token);

    return {
      data: {
        buffer,
        fileName,
      },
    };
  } catch (error) {
    return { error: 'downloadFail', status: HTTP_STATUS.INTERNAL_SERVER_ERROR, code: 'downloadFail' };
  }
}

module.exports = {
  resolveShareLink,
  getShareLinkMetadata,
  checkUserSharePermission,
  addToMyPermissions,
  previewFile,
  downloadFile,
};
