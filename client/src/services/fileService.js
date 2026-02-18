import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import i18n from '../i18n';
import { get, post, put } from './apiClient';
import {
  checkPermission as checkPermissionApi,
  grantPermission as grantPermissionApi,
  revokePermission as revokePermissionApi,
} from './permissionService';

const API_BASE = '/files';

function shareTokenHeaders(shareToken) {
  if (!shareToken) return {};
  return { 'X-Share-Token': shareToken };
}

export const listFiles = async (path = '/', options = {}) => {
  const { shareToken } = options;
  const response = await get(`${API_BASE}/list`, {
    params: { path, ...(shareToken && { shareToken }) },
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

/**
 * 여러 파일 경로에 대한 메타데이터(size, lastmod, mime) 조회. 빈 배열이면 [] 반환.
 * @param {string[]} paths - 파일 경로 배열
 * @returns {Promise<Array<{ path: string, size: number, lastmod: string|null, mime: string|null }>>}
 */
export const getFilesMetadata = async (paths = [], options = {}) => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return [];
  }
  const { shareToken } = options;
  const response = await post(`${API_BASE}/metadata`, { paths, ...(shareToken && { shareToken }) }, {
    headers: shareTokenHeaders(shareToken),
  });
  return Array.isArray(response.data) ? response.data : [];
};

/**
 * 파일 blob 조회 (미리보기 등)
 * @param {string} filePath - 파일 경로
 * @param {Object} options - { inline: boolean }
 * @returns {Promise<Blob>}
 */
export const getFileBlob = async (filePath, options = {}) => {
  const { shareToken, inline } = options;
  const params = { path: filePath };
  if (inline) params.inline = 'true';
  if (shareToken) params.shareToken = shareToken;
  const response = await get(`${API_BASE}/download`, {
    params,
    responseType: 'blob',
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

export const downloadFile = async (filePath) => {
  const response = await get(`${API_BASE}/download`, {
    params: { path: filePath },
    responseType: 'blob',
  });
  
  // Create download link
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filePath.split('/').pop());
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const uploadFileWithPath = async (file, targetPath = '/', relativePath = '', onConflict = 'error', signal = null) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', targetPath);
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

export const uploadMultipleFiles = async (files, targetPath = '/', onProgress, onConflict = 'error', options = {}) => {
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

      const result = await uploadFileWithPath(file, targetPath, relativePath, onConflict, signal);
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

      errors.push({
        file,
        relativePath: fileName,
        error: error.response?.data?.error || error.message,
      });

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: fileName,
          status: 'error',
          error: error.response?.data?.error || error.message,
        });
      }
    }
  }

  return { results, errors };
};

export const renameFile = async (oldPath, newName) => {
  const response = await put(`${API_BASE}/rename`, {
    oldPath,
    newName,
  });
  return response.data;
};

export const createFolder = async (folderPath) => {
  const response = await post('/folders/create', {
    path: folderPath,
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

export const downloadMultipleFiles = async (paths, onProgress, options = {}) => {
  const { shareToken } = options;
  const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let lastProgressEvent = null;
  let lastServerProgress = null;
  let pollTimer = null;

  const listOpts = shareToken ? { shareToken } : {};

  try {
    let totalSize = 0;
    try {
      for (const filePath of paths) {
        const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
        const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
        const files = await listFiles(parentPath, listOpts);
        const fileItem = files.find(item => item.basename === fileName);
        if (fileItem) {
          if (fileItem.type === 'directory') {
            totalSize += 1024 * 1024;
          } else if (fileItem.size) {
            totalSize += fileItem.size;
          }
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
      { paths, downloadId, ...(shareToken && { shareToken }) },
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
    
    // Optional: server may report skipped paths due to permission (URL-encoded JSON)
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
    if (onProgress) {
      onProgress({
        id: downloadId,
        type: 'download',
        status: 'error',
        progress: 0,
        total: 0,
        current: '',
        zipName: '',
        error: error.response?.data?.error || error.message,
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

/** Check effective permission for a path (folder or file). Delegates to unified permissionService. */
export const checkPermission = async (path) => {
  return checkPermissionApi(path);
};

/** Check effective permission for a file path. Delegates to unified permissionService. */
export const checkFilePermission = async (filePath) => {
  return checkPermissionApi(filePath);
};

/** Grant file-level permission. Delegates to unified permissionService (target: 'file'). */
export const grantFilePermission = async ({ userId, filePath, permission }) => {
  await grantPermissionApi({ userId, folderPath: filePath, permission, target: 'file' });
};

/** Revoke file-level permission. Delegates to unified permissionService (scope: 'pathOnly'). */
export const revokeFilePermission = async ({ userId, filePath }) => {
  await revokePermissionApi({ userId, folderPath: filePath, scope: 'pathOnly' });
};

/** Update file-level permission. Delegates to unified permissionService (target: 'file'). */
export const updateFilePermission = async ({ userId, filePath, permission }) => {
  await grantPermissionApi({ userId, folderPath: filePath, permission, target: 'file' });
};

/** List current user's file-level permissions. Re-exported from permissionService. */
export { listFilePermissions } from './permissionService';

export const requestThumbnailsBatch = async (paths, options = {}) => {
  const { shareToken } = options;
  const response = await post(`${API_BASE}/thumbnails/batch`, {
    paths,
    ...(shareToken && { shareToken }),
  }, {
    headers: shareTokenHeaders(shareToken),
  });
  return response.data;
};

/** Starts bulk delete job. Returns { jobId }. Poll with getBulkOperationStatus(jobId). */
export const batchDeleteFiles = async (paths) => {
  const response = await post(`${API_BASE}/batch-delete`, { paths });
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