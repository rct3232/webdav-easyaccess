import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { getContentType } from '@webdav-easyaccess/shared/fileTypes';
import i18n from '../i18n';
import { get, post, put } from './apiClient';
import {
  checkPermission as checkPermissionApi,
  grantPermission as grantPermissionApi,
  revokePermission as revokePermissionApi,
} from './permissionService';

const API_BASE = '/files';

/** @returns {boolean} True when running on iOS (iPhone/iPad). */
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function shareTokenHeaders(shareToken) {
  if (!shareToken) return {};
  return { 'X-Share-Token': shareToken };
}

export const listFiles = async (nodeId, options = {}) => {
  const { shareToken } = options;
  const params = nodeId != null ? { nodeId } : {};
  if (shareToken) params.shareToken = shareToken;
  const response = await get(`${API_BASE}/list`, {
    params,
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

/**
 * Fetch metadata (size, lastmod, mime) for nodeIds. Returns [] for empty input.
 * @param {number[]} nodeIds - nodeId array
 * @returns {Promise<Array<{ nodeId: number, size: number, lastmod: string|null, mime: string|null }>>}
 */
export const getFilesMetadata = async (nodeIds = [], options = {}) => {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return [];
  }
  const { shareToken } = options;
  const response = await post(`${API_BASE}/metadata`, { nodeIds, ...(shareToken && { shareToken }) }, {
    headers: shareTokenHeaders(shareToken),
  });
  return Array.isArray(response.data) ? response.data : [];
};

/**
 * Fetch file blob (preview, etc.)
 * @param {number} nodeId - File nodeId
 * @param {Object} options - { inline: boolean }
 * @returns {Promise<Blob>}
 */
export const getFileBlob = async (nodeId, options = {}) => {
  const { shareToken, inline, signal } = options;
  const params = { nodeId };
  if (inline) params.inline = 'true';
  if (shareToken) params.shareToken = shareToken;
  const response = await get(`${API_BASE}/download`, {
    params,
    responseType: 'blob',
    headers: shareTokenHeaders(shareToken),
    signal,
  });
  return response.data;
};

/**
 * Get a streaming URL for video preview suitable for <video src>.
 * Uses a short-lived server-issued ticket (no JWT in query params).
 * @param {number} nodeId
 * @param {object} [options]
 * @param {string} [options.shareToken]
 * @returns {Promise<string>} URL path (same-origin) to use as media src
 */
export const getVideoPreviewStreamUrl = async (nodeId, options = {}) => {
  const { shareToken } = options;
  const response = await post(`${API_BASE}/preview-ticket`, { nodeId, ...(shareToken && { shareToken }) }, {
    headers: shareTokenHeaders(shareToken),
  });
  const ticket = response?.data?.ticket;
  if (!ticket) {
    throw new Error('No preview ticket in response');
  }
  const params = new URLSearchParams({ nodeId: String(nodeId), ticket });
  return `/api${API_BASE}/preview-stream?${params.toString()}`;
};

/**
 * Download a single file. On iOS + image, uses share sheet or inline open so the user can save to Photos.
 * @param {number} nodeId - nodeId of the file.
 * @param {Object} [options] - Optional. fileName, mimeType, isMobile, shareToken.
 */
export const downloadFile = async (nodeId, options = {}) => {
  const fileName = options.fileName ?? '';
  const mimeType = options.mimeType ?? getContentType(fileName);
  const shareToken = options.shareToken;
  const ios = isIOS();

  const fetchBlob = () =>
    get(`${API_BASE}/download`, {
      params: { nodeId, ...(shareToken && { shareToken }) },
      responseType: 'blob',
      headers: shareToken ? { 'X-Share-Token': shareToken } : {},
    });

  const triggerDefaultDownload = (blob) => {
    const url = window.URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  if (ios) {
    const response = await fetchBlob();
    const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
    const file = new File([blob], fileName, { type: mimeType });
    let canShare = false;
    if (typeof navigator?.canShare === 'function') {
      try {
        canShare = navigator.canShare({ files: [file] });
      } catch {
        /* ignore */
      }
    }

    if (canShare) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // Fallback to default download
      }
    }
    const typedBlob = blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: mimeType });
    const iosUrl = window.URL.createObjectURL(typedBlob);
    const iosLink = document.createElement('a');
    iosLink.href = iosUrl;
    iosLink.setAttribute('download', fileName);
    document.body.appendChild(iosLink);
    iosLink.click();
    iosLink.remove();
    // iOS Safari shows a "View / Download" confirmation dialog before starting the download.
    // Revoking the blob URL synchronously (as triggerDefaultDownload does) invalidates the URL
    // before the user can confirm, causing the download to silently fail.
    // Defer cleanup: revoke when the page regains visibility after the dialog is dismissed.
    const revokeIosUrl = () => window.URL.revokeObjectURL(iosUrl);
    document.addEventListener('visibilitychange', revokeIosUrl, { once: true });
    return;
  }

  const response = await fetchBlob();
  triggerDefaultDownload(response.data);
};

export const uploadFile = async (file, parentNodeId, relativePath = '', onConflict = 'error', signal = null) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('parentNodeId', String(parentNodeId));
  if (relativePath) {
    formData.append('relativePath', relativePath);
  }
  if (onConflict) {
    formData.append('onConflict', onConflict);
  }

  const config = {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  };
  if (signal) {
    config.signal = signal;
  }

  const response = await post(`${API_BASE}/upload`, formData, config);
  return response.data;
};

export const uploadMultipleFiles = async (files, parentNodeId, onProgress, onConflict = 'error', options = {}) => {
  const results = [];
  const errors = [];
  const { getSignalForFile } = options;

  for (let i = 0; i < files.length; i++) {
    const { file, relativePath } = files[i];
    const fileName = relativePath || file.name;
    const signal = getSignalForFile?.(fileName);

    if (signal?.aborted) {
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: fileName,
          status: 'cancelled',
        });
      }
      continue;
    }

    try {
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: fileName,
          status: 'uploading',
        });
      }

      const result = await uploadFile(file, parentNodeId, relativePath, onConflict, signal);
      const skipped = result?.skipped === true;
      results.push({ file, result, success: true, skipped });

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: fileName,
          status: skipped ? 'skipped' : 'success',
        });
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: files.length,
            currentFile: fileName,
            status: 'cancelled',
          });
        }
        continue;
      }

      const isDuplicate = error.response?.status === HTTP_STATUS.CONFLICT;
      if (!isDuplicate) {
        console.error(`Failed to upload ${fileName}:`, error);
      }

      const errData = error.response?.data || {};
      errors.push({
        file,
        relativePath: fileName,
        ...errData,
        error: errData.error || error.message,
      });

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: fileName,
          status: 'error',
          ...errData,
          error: errData.error || error.message,
        });
      }
    }
  }

  return { results, errors };
};

export const renameFile = async (nodeId, newName) => {
  const response = await put(`${API_BASE}/rename`, {
    nodeId,
    newName,
  });
  return response.data;
};

export const createFolder = async (parentNodeId, name) => {
  const response = await post('/folders/create', {
    parentNodeId,
    name,
  });
  return response.data;
};

/**
 * Recursive folder stats (file count, total size).
 * @param {number} nodeId - Folder nodeId
 * @returns {Promise<{ fileCount: number, totalSize: number }>}
 */
export const getFolderStats = async (nodeId) => {
  const response = await get('/folders/stats', {
    params: { nodeId },
  });
  return response.data;
};

export const getWebDAVInfo = async () => {
  const response = await get('/webdav/info');
  return response.data;
};

export const checkConflicts = async (operations, options = {}) => {
  const { limit = true } = options;
  const response = await post(`${API_BASE}/check-conflicts`, {
    operations,
    limit,
  });
  return response.data.conflicts;
};

function serverProgressToPercent(server) {
  if (!server || !server.status) return 0;
  if (server.status === 'preparing') return 0;
  if (server.status === 'completed') return 100;
  if (server.status === 'error') return 0;
  if (server.status === 'downloading' && server.total > 0) {
    return (server.progress / server.total) * 100;
  }
  return 0;
}

export const downloadMultipleFiles = async (nodeIds, onProgress, options = {}) => {
  const { shareToken } = options;
  const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let lastProgressEvent = null;
  let lastServerProgress = null;
  let pollTimer = null;

  const listOpts = shareToken ? { shareToken } : {};

  try {
    let totalSize = 0;
    try {
      const metadataList = await getFilesMetadata(nodeIds, listOpts);
      for (const meta of metadataList) {
        if (meta.size) {
          totalSize += meta.size;
        } else {
          totalSize += 1024 * 1024;
        }
      }
    } catch (err) {
      // Ignore error
    }

    const pushProgress = (server, loaded, total) => {
      if (!onProgress) return;
      const byteTotal = total || totalSize || 0;
      const bytePercent = byteTotal > 0 ? Math.min(100, (loaded / byteTotal) * 100) : 0;
      const serverPercent = serverProgressToPercent(server);
      const combined = Math.min(100, 0.5 * serverPercent + 0.5 * bytePercent);
      const currentFromServer = server?.current;
      const zipNameFromServer = server?.zipName || '';
      const status = server?.status === 'preparing' ? 'preparing' : 'downloading';
      const currentLabel = status === 'preparing' ? i18n.t('fileManager.downloadPreparing') : (currentFromServer ? `${currentFromServer} · ${Math.round(combined)}%` : i18n.t('fileManager.downloadingPercent', { percent: Math.round(combined) }));
      onProgress({
        id: downloadId,
        type: 'download',
        status,
        progress: loaded,
        total: byteTotal,
        percentage: combined,
        current: currentLabel,
        zipName: zipNameFromServer,
      });
    };

    pollTimer = setInterval(async () => {
      try {
        const data = await getDownloadProgress(downloadId, listOpts);
        lastServerProgress = data;
        pushProgress(data, lastProgressEvent?.loaded ?? 0, lastProgressEvent?.total || totalSize);
      } catch (e) {
        // 404 or network error: keep lastServerProgress unchanged
      }
    }, 400);

    const response = await post(
      '/files/download-multiple',
      { nodeIds, downloadId, ...(shareToken && { shareToken }) },
      {
        responseType: 'blob',
        headers: shareTokenHeaders(shareToken),
        onDownloadProgress: (progressEvent) => {
          lastProgressEvent = progressEvent;
          const loaded = progressEvent.loaded || 0;
          const total = progressEvent.total || totalSize || 0;
          pushProgress(lastServerProgress, loaded, total);
        },
      }
    );

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;

    const contentDisposition = response.headers['content-disposition'];
    let filename = 'download.zip';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename\*?=['"]?([^'";]+)/);
      if (filenameMatch) {
        filename = decodeURIComponent(filenameMatch[1]);
      } else {
        const simpleMatch = contentDisposition.match(/filename=['"]?([^'";]+)/);
        if (simpleMatch) {
          filename = simpleMatch[1];
        }
      }
    }

    // Optional: server may report skipped nodeIds due to permission (URL-encoded JSON)
    const skippedCountHeader = response.headers['x-wea-skipped-count'];
    const skippedHeader = response.headers['x-wea-skipped'];
    let skippedInfo = null;
    let skippedCount = 0;
    try {
      if (skippedCountHeader) skippedCount = parseInt(skippedCountHeader, 10) || 0;
      if (skippedHeader) {
        skippedInfo = JSON.parse(decodeURIComponent(skippedHeader));
      }
    } catch (e) {
      // ignore
    }

    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    if (onProgress) {
      const total = lastProgressEvent?.total || totalSize || 0;
      onProgress({
        id: downloadId,
        type: 'download',
        status: 'completed',
        progress: total,
        total: total,
        percentage: 100,
        current: i18n.t('fileManager.pullRefreshDone'),
        zipName: filename,
        skippedCount,
        skippedInfo,
      });
    }

    return { success: true, downloadId, filename, skippedCount, skippedInfo };
  } catch (error) {
    console.error('Download multiple files error:', error);
    const errData = error.response?.data || {};
    if (onProgress) {
      onProgress({
        id: downloadId,
        type: 'download',
        status: 'error',
        progress: 0,
        total: 0,
        current: '',
        zipName: '',
        ...errData,
        error: errData.error || error.message,
      });
    }
    throw error;
  } finally {
    if (pollTimer) clearInterval(pollTimer);
  }
};

export const getDownloadProgress = async (downloadId, options = {}) => {
  const { shareToken } = options;
  const response = await get(`/files/download-progress/${downloadId}`, {
    params: shareToken ? { shareToken } : {},
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

/** Check effective permission for a node (folder or file). Delegates to unified permissionService. */
export const checkPermission = async (nodeId) => {
  return checkPermissionApi(nodeId);
};

/** Check effective permission for a file node. Delegates to unified permissionService. */
export const checkFilePermission = async (fileNodeId) => {
  return checkPermissionApi(fileNodeId);
};

/** Grant file-level permission. Delegates to unified permissionService (target: 'file'). */
export const grantFilePermission = async ({ userId, fileNodeId, permission }) => {
  await grantPermissionApi({ userId, nodeId: fileNodeId, permission, target: 'file' });
};

/** Revoke file-level permission. Delegates to unified permissionService (scope: 'pathOnly'). */
export const revokeFilePermission = async ({ userId, fileNodeId }) => {
  await revokePermissionApi({ userId, nodeId: fileNodeId, scope: 'pathOnly' });
};

/** Update file-level permission. Delegates to unified permissionService (target: 'file'). */
export const updateFilePermission = async ({ userId, fileNodeId, permission }) => {
  await grantPermissionApi({ userId, nodeId: fileNodeId, permission, target: 'file' });
};

/** List current user's file-level permissions. Re-exported from permissionService. */
export { listFilePermissions } from './permissionService';

export const requestThumbnailsBatch = async (nodeIds, options = {}) => {
  const { shareToken } = options;
  const response = await post(`${API_BASE}/thumbnails/batch`, {
    nodeIds,
    ...(shareToken && { shareToken }),
  }, {
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

/** Starts bulk delete job. Returns { jobId }. Poll with getBulkOperationStatus(jobId). */
export const batchDeleteFiles = async (nodeIds) => {
  const response = await post(`${API_BASE}/batch-delete`, { nodeIds });
  return response.data;
};

/** Starts bulk move job. Returns { jobId }. Poll with getBulkOperationStatus(jobId). */
export const batchMoveFiles = async (moves, onConflict = 'error') => {
  const response = await post(`${API_BASE}/batch-move`, { moves, onConflict });
  return response.data;
};

/** Starts bulk copy job. Returns { jobId }. Poll with getBulkOperationStatus(jobId). */
export const batchCopyFiles = async (copies, onConflict = 'error') => {
  const response = await post(`${API_BASE}/batch-copy`, { copies, onConflict });
  return response.data;
};

/** Poll bulk operation status. Returns { status, progress, total, results, errorMessage }. */
export const getBulkOperationStatus = async (jobId) => {
  const response = await get(`${API_BASE}/bulk-operation/${encodeURIComponent(jobId)}`);
  return response.data;
};

/** Request cancellation of a bulk operation. */
export const cancelBulkOperation = async (jobId) => {
  const response = await post(`${API_BASE}/bulk-operation/${encodeURIComponent(jobId)}/cancel`);
  return response.data;
};