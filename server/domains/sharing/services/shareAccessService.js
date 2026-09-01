const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { getFileType, getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const ShareLink = require('../../../models/ShareLink');
const permissionStore = require('../../../store/permissionStore');
const User = require('../../../models/User');
const { meetsRank } = require('../../permissions/policy/permissionRank');
const { isOwnerNode } = require('../../permissions/policy/ownerNodeResolver');

function getServices() {
  const { getComposition } = require('../../../service/composition');
  return getComposition();
}

async function getFileNode(link) {
  const nodeId = link.nodeId != null ? Number(link.nodeId) : Number(link.fileNodeId);
  if (!Number.isFinite(nodeId)) return null;
  const { fileNodeService } = getServices();
  return fileNodeService.getNode(nodeId);
}

/**
 * Resolve the shared node id for a link, or null when the node no longer exists.
 */
async function getShareNodeId(link) {
  const node = await getFileNode(link);
  return node ? Number(node.id) : null;
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
  const node = await getFileNode(link);
  if (!node) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  const { fileNodeService } = getServices();
  const displayPath = await fileNodeService.getNodePath(node.id);
  const fileName = node.name;
  const fileType = getFileType(fileName);

  return {
    data: {
      token: link.token,
      nodeId: Number(node.id),
      fileName,
      fileType,
      isDirectory: node.type === 'directory',
      displayPath,
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

  const shareNodeId = await getShareNodeId(result.link);
  if (shareNodeId === null) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  const { fileNodeService } = getServices();
  const descendantIds = await fileNodeService.getDescendantIds(shareNodeId);
  const nodeIdsToCheck = [shareNodeId, ...descendantIds];

  let hasSufficientPermission = true;
  let firstMissingNodeId = null;

  for (const nodeId of nodeIdsToCheck) {
    const effective = await permissionStore.getEffectivePermission(userId, nodeId);
    if (!effective || !meetsRank(effective, PERMISSIONS.READ)) {
      hasSufficientPermission = false;
      firstMissingNodeId = nodeId;
      break;
    }
  }

  return {
    data: {
      hasSufficientPermission,
      ...(hasSufficientPermission ? {} : { nodeId: firstMissingNodeId ?? shareNodeId }),
    },
  };
}

async function addToMyPermissions(token, userId) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const shareNodeId = await getShareNodeId(link);
  if (shareNodeId === null) {
    return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
  }

  const createdBy = link.createdBy;
  if (!createdBy) {
    return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
  }

  const creatorUser = await User.findById(createdBy);
  if (!creatorUser) {
    return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
  }

  const isAdmin = Boolean(creatorUser.is_admin);
  const isOwner = await isOwnerNode(createdBy, shareNodeId);
  if (!isAdmin && !isOwner) {
    const hasAdmin = await permissionStore.checkPermission(
      createdBy,
      shareNodeId,
      PERMISSIONS.ADMIN
    );
    if (!hasAdmin) {
      return { error: 'forbidden', status: HTTP_STATUS.FORBIDDEN, code: 'cannotAddShare' };
    }
  }

  const node = await getFileNode(link);
  const effective = await permissionStore.getEffectivePermission(userId, shareNodeId);
  if (!effective || !meetsRank(effective, PERMISSIONS.READ)) {
    if (node && node.type === 'file') {
      await permissionStore.grantFilePermission(userId, shareNodeId, PERMISSIONS.READ);
    } else {
      await permissionStore.grant(userId, shareNodeId, PERMISSIONS.READ);
    }
  }

  return { data: { messageCode: 'addedToShared' } };
}

async function previewFile(token) {
  const result = await resolveShareLink(token);
  if (result.error) return result;

  const { link } = result;
  const node = await getFileNode(link);
  if (!node) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  try {
    const { blobStorageService } = getServices();
    const buffer = await blobStorageService.downloadBlob(node.id);
    if (!buffer) {
      return {
        error: 'previewFail',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        code: 'previewFail',
      };
    }
    const fileName = node.name;
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
  const node = await getFileNode(link);
  if (!node) {
    return { error: 'notFound', status: HTTP_STATUS.NOT_FOUND, code: 'fileNotFound' };
  }

  try {
    const { blobStorageService } = getServices();
    const buffer = await blobStorageService.downloadBlob(node.id);
    if (!buffer) {
      return {
        error: 'downloadFail',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        code: 'downloadFail',
      };
    }

    await ShareLink.incrementDownloadCount(token);

    return {
      data: {
        buffer,
        fileName: node.name,
      },
    };
  } catch (error) {
    return {
      error: 'downloadFail',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: 'downloadFail',
    };
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
