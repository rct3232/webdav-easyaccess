import { get, post, put, del } from './apiClient';

const API_BASE = '/files';

export const listFiles = async (path = '/') => {
  const response = await get(`${API_BASE}/list`, {
    params: { path },
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

export const uploadFile = async (file, path = '/', signal = null, onConflict = 'error') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);
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

export const uploadFileWithPath = async (file, targetPath = '/', relativePath = '', onConflict = 'error') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', targetPath);
  if (relativePath) {
    formData.append('relativePath', relativePath);
  }
  if (onConflict) {
    formData.append('onConflict', onConflict);
  }

  const response = await post(`${API_BASE}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const uploadMultipleFiles = async (files, targetPath = '/', onProgress, onConflict = 'error') => {
  const results = [];
  const errors = [];
  
  for (let i = 0; i < files.length; i++) {
    const { file, relativePath } = files[i];
    
    try {
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: relativePath || file.name,
          status: 'uploading',
        });
      }
      
      const result = await uploadFileWithPath(file, targetPath, relativePath, onConflict);
      results.push({ file, result, success: true });
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: relativePath || file.name,
          status: 'success',
        });
      }
    } catch (error) {
      // 409 Conflict는 중복 파일로 인한 정상적인 거부이므로 에러로 로깅하지 않음
      const isDuplicate = error.response?.status === 409;
      if (!isDuplicate) {
        console.error(`Failed to upload ${relativePath || file.name}:`, error);
      }
      
      errors.push({ 
        file, 
        relativePath: relativePath || file.name,
        error: error.response?.data?.error || error.message 
      });
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: files.length,
          currentFile: relativePath || file.name,
          status: 'error',
          error: error.response?.data?.error || error.message,
        });
      }
    }
  }
  
  return { results, errors };
};

export const deleteFile = async (filePath) => {
  const response = await del(`${API_BASE}/delete`, {
    params: { path: filePath },
  });
  return response.data;
};

export const renameFile = async (oldPath, newName) => {
  const response = await put(`${API_BASE}/rename`, {
    oldPath,
    newName,
  });
  return response.data;
};

const getFileSize = async (filePath) => {
  try {
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    const files = await listFiles(parentPath);
    const fileItem = files.find(item => item.basename === fileName);
    return fileItem?.size || 0;
  } catch (err) {
    return 0;
  }
};

const pollOperationProgress = async (operationId, fileSize, onProgress) => {
  const pollProgress = async () => {
    try {
      const progressResponse = await get(`/files/operation-progress/${operationId}`);
      const progress = progressResponse.data;
      
      onProgress({
        stage: progress.stage,
        progress: progress.progress,
        total: progress.total,
        percentage: progress.percentage,
      });
      
      if (progress.stage !== 'completed' && progress.stage !== 'error') {
        setTimeout(pollProgress, 100);
      }
    } catch (err) {
      if (onProgress) {
        onProgress({
          stage: 'completed',
          progress: fileSize,
          total: fileSize,
          percentage: 100,
        });
      }
    }
  };
  
  setTimeout(pollProgress, 50);
};

export const moveFile = async (sourcePath, destinationPath, onProgress, onConflict = 'error') => {
  const fileSize = await getFileSize(sourcePath);

  if (onProgress && fileSize > 0) {
    onProgress({
      stage: 'downloading',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });
  }
  
  const response = await put(`${API_BASE}/move`, {
    sourcePath,
    destinationPath,
    onConflict,
  });
  
  const operationId = response.data.operationId;
  
  if (onProgress && operationId && fileSize > 0) {
    pollOperationProgress(operationId, fileSize, onProgress);
  } else if (onProgress && fileSize > 0) {
    onProgress({
      stage: 'completed',
      progress: fileSize,
      total: fileSize,
      percentage: 100,
    });
  }
  
  return response.data;
};

export const copyFile = async (sourcePath, destinationPath, onProgress, onConflict = 'error') => {
  const fileSize = await getFileSize(sourcePath);

  if (onProgress && fileSize > 0) {
    onProgress({
      stage: 'downloading',
      progress: 0,
      total: fileSize,
      percentage: 0,
    });
  }
  
  const response = await post(`${API_BASE}/copy`, {
    sourcePath,
    destinationPath,
    onConflict,
  });
  
  const operationId = response.data.operationId;
  
  if (onProgress && operationId && fileSize > 0) {
    pollOperationProgress(operationId, fileSize, onProgress);
  } else if (onProgress && fileSize > 0) {
    onProgress({
      stage: 'completed',
      progress: fileSize,
      total: fileSize,
      percentage: 100,
    });
  }
  
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

export const checkConflicts = async (operations) => {
  const response = await post(`${API_BASE}/check-conflicts`, {
    operations,
  });
  return response.data.conflicts;
};

export const downloadMultipleFiles = async (paths, onProgress) => {
  const downloadId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  let lastProgressEvent = null;
  
  try {
    let totalSize = 0;
    try {
      for (const filePath of paths) {
        const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
        const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
        const files = await listFiles(parentPath);
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
    
    const response = await post(
      '/files/download-multiple',
      { paths },
      {
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          lastProgressEvent = progressEvent;
          if (onProgress) {
            const loaded = progressEvent.loaded || 0;
            const total = progressEvent.total || totalSize || 0;
            const percentage = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
            
            onProgress({
              id: downloadId,
              type: 'download',
              status: 'downloading',
              progress: loaded,
              total: total,
              percentage: percentage,
              current: `다운로드 중 (${Math.round(percentage)}%)`,
              zipName: '',
            });
          }
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
        current: '완료',
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
  }
};

export const getDownloadProgress = async (downloadId) => {
  const response = await get(`/files/download-progress/${downloadId}`);
  return response.data;
};

export const checkPermission = async (folderPath) => {
  const response = await get('/permissions/check', {
    params: { path: folderPath },
  });
  return response.data;
};

export const requestThumbnailsBatch = async (paths) => {
  const response = await post(`${API_BASE}/thumbnails/batch`, {
    paths,
  });
  return response.data;
};

export const batchDeleteFiles = async (paths) => {
  const response = await post(`${API_BASE}/batch-delete`, {
    paths,
  });
  return response.data;
};

export const batchMoveFiles = async (moves, onConflict = 'error') => {
  const response = await post(`${API_BASE}/batch-move`, {
    moves,
    onConflict,
  });
  return response.data;
};

export const batchCopyFiles = async (copies, onConflict = 'error') => {
  const response = await post(`${API_BASE}/batch-copy`, {
    copies,
    onConflict,
  });
  return response.data;
};