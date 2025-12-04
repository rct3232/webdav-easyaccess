const { createClient } = require('webdav');
const path = require('path');

let webdavClient = null;
let cachedUrl = null;

function normalizePath(filePath) {
  let normalized = filePath.trim();
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  if (normalized.endsWith('/') && normalized !== '/') {
    normalized = normalized.slice(0, -1);
  }
  return normalized.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function getRequestPath(normalizedPath) {
  const baseUrl = process.env.WEBDAV_URL?.trim() || '';
  if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
    return normalizedPath === '/' ? '' : normalizedPath.substring(1);
  }
  return normalizedPath;
}

function getWebDAVClient() {
  let url = process.env.WEBDAV_URL;
  const username = process.env.WEBDAV_USERNAME;
  const password = process.env.WEBDAV_PASSWORD;

  if (!url || !username || !password) {
    throw new Error('WebDAV credentials not configured in .env file');
  }

  url = url.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  if (webdavClient && cachedUrl !== url) {
    webdavClient = null;
    cachedUrl = null;
  }

  if (!webdavClient) {
    const authType = process.env.WEBDAV_AUTH_TYPE || 'auto';
    const clientOptions = {
      username,
      password,
      headers: {
        'User-Agent': 'WebDAV-EasyAccess/1.0',
        'Accept-Charset': 'utf-8',
      },
    };

    if (authType !== 'auto') {
      clientOptions.authType = authType;
    }

    webdavClient = createClient(url, clientOptions);
    cachedUrl = url;
  }

  return webdavClient;
}

function resetWebDAVClient() {
  webdavClient = null;
  cachedUrl = null;
  console.log('WebDAV client reset');
}

async function listDirectory(path = '/') {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath);
    const items = await client.getDirectoryContents(requestPath);
    return items.map(item => ({
      filename: item.filename,
      basename: item.basename,
      lastmod: item.lastmod,
      size: item.size,
      type: item.type,
      mime: item.mime,
    }));
  } catch (error) {
    if (error.status === 401 || error.response?.status === 401) {
      throw new Error(`WebDAV authentication failed. Check credentials in .env file. Original: ${error.message}`);
    }
    throw new Error(`Failed to list directory: ${error.message}`);
  }
}

async function getFileContents(filePath) {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(filePath);
    const requestPath = getRequestPath(normalizedPath);
    const buffer = await client.getFileContents(requestPath);
    return buffer;
  } catch (error) {
    throw new Error(`Failed to get file contents: ${error.message}`);
  }
}

async function putFileContents(path, buffer) {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath);
    await client.putFileContents(requestPath, buffer);
    return { success: true };
  } catch (error) {
    if (error.status === 404 || error.response?.status === 404) {
      throw new Error(`Path not found: ${path}. Please ensure the parent directory exists.`);
    } else if (error.status === 403 || error.response?.status === 403) {
      throw new Error(`Permission denied: Cannot upload to ${path}`);
    } else if (error.status === 409 || error.response?.status === 409) {
      throw new Error(`Conflict: File may already exist or parent directory is missing: ${path}`);
    } else if (error.status === 500 || error.response?.status === 500) {
      throw new Error(`WebDAV server error. Check server configuration and path format. Original: ${error.message}`);
    } else if (error.message.includes('ECONNREFUSED')) {
      throw new Error(`Connection refused. Check WebDAV server URL and network connection. Original: ${error.message}`);
    }
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

async function deleteFile(path) {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    let isDirectory = false;
    
    try {
      const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/';
      const items = await client.getDirectoryContents(getRequestPath(parentPath));
      const item = items.find(i => {
        const itemPath = i.filename || i.basename;
        return itemPath === normalizedPath || itemPath === normalizedPath + '/' || itemPath + '/' === normalizedPath;
      });
      if (item) {
        isDirectory = item.type === 'directory';
      }
    } catch (err) {
      // Ignore error, continue
    }
    
    let deletePath = normalizedPath;
    if (isDirectory && !deletePath.endsWith('/')) {
      deletePath = deletePath + '/';
    }
    
    try {
      await client.deleteFile(getRequestPath(deletePath));
      return { success: true };
    } catch (firstError) {
      if (isDirectory) {
        const alternatePath = deletePath.endsWith('/') ? deletePath.slice(0, -1) : deletePath + '/';
        try {
          await client.deleteFile(getRequestPath(alternatePath));
          return { success: true };
        } catch (secondError) {
          throw firstError;
        }
      } else {
        throw firstError;
      }
    }
  } catch (error) {
    if (error.status === 404 || error.response?.status === 404) {
      throw new Error(`File or folder not found: ${path}`);
    } else if (error.status === 403 || error.response?.status === 403) {
      throw new Error(`Permission denied: Cannot delete ${path}`);
    } else if (error.status === 409 || error.response?.status === 409) {
      throw new Error(`Directory not empty or conflict: ${path}`);
    } else if (error.message.includes('ECONNREFUSED')) {
      throw new Error(`Connection refused. Check WebDAV server URL and network connection. Original: ${error.message}`);
    }
    throw new Error(`Failed to delete: ${error.message}`);
  }
}

async function moveFile(sourcePath, destinationPath, progressCallback) {
  const client = getWebDAVClient();
  try {
    const normalizedSource = normalizePath(sourcePath);
    const normalizedDest = normalizePath(destinationPath);
    
    let isDirectory = false;
    try {
      await client.getDirectoryContents(getRequestPath(normalizedSource));
      isDirectory = true;
    } catch (dirError) {
      isDirectory = false;
    }
    
    if (isDirectory) {
      try {
        await createDirectory(normalizedDest);
      } catch (createError) {
        if (!createError.message.includes('already exists')) {
          throw createError;
        }
      }
      
      const sourceItems = await listDirectory(normalizedSource);
      for (const item of sourceItems) {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        await moveFile(sourceItemPath, destItemPath);
      }
      
      await deleteFile(normalizedSource);
      return { success: true };
    } else {
      let fileSize = 0;
      try {
        const parentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf('/')) || '/';
        const fileName = normalizedSource.substring(normalizedSource.lastIndexOf('/') + 1);
        const items = await listDirectory(parentPath);
        const fileItem = items.find(item => item.basename === fileName);
        if (fileItem && fileItem.size) {
          fileSize = fileItem.size;
        }
      } catch (err) {
        // Ignore error
      }

      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'downloading', progress: 0, total: fileSize });
      }
      const buffer = await getFileContents(normalizedSource);
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'downloading', progress: buffer.length, total: fileSize });
      }
      
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'uploading', progress: buffer.length, total: fileSize });
      }
      await putFileContents(normalizedDest, buffer);
      
      await deleteFile(normalizedSource);
      
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'completed', progress: fileSize, total: fileSize });
      }
      
      return { success: true };
    }
  } catch (error) {
    if (error.message.includes('does not exist') || error.message.includes('already exists')) {
      throw error;
    }
    if (error.status === 502 || error.response?.status === 502) {
      throw new Error('WebDAV server is not responding. Check if server is running and accessible.');
    }
    if (error.message.includes('ECONNREFUSED')) {
      throw new Error('Cannot connect to WebDAV server. Check WEBDAV_URL in .env file.');
    }
    throw new Error(`Failed to move file: ${error.message}`);
  }
}

async function copyFile(sourcePath, destinationPath, progressCallback) {
  const client = getWebDAVClient();
  try {
    const normalizedSource = normalizePath(sourcePath);
    const normalizedDest = normalizePath(destinationPath);
    
    let isDirectory = false;
    try {
      await client.getDirectoryContents(getRequestPath(normalizedSource));
      isDirectory = true;
    } catch (dirError) {
      isDirectory = false;
    }
    
    if (isDirectory) {
      try {
        await createDirectory(normalizedDest);
      } catch (createError) {
        if (!createError.message.includes('already exists')) {
          throw createError;
        }
      }
      
      const sourceItems = await listDirectory(normalizedSource);
      for (const item of sourceItems) {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        await copyFile(sourceItemPath, destItemPath);
      }
      
      return { success: true };
    } else {
      let fileSize = 0;
      try {
        const parentPath = normalizedSource.substring(0, normalizedSource.lastIndexOf('/')) || '/';
        const fileName = normalizedSource.substring(normalizedSource.lastIndexOf('/') + 1);
        const items = await listDirectory(parentPath);
        const fileItem = items.find(item => item.basename === fileName);
        if (fileItem && fileItem.size) {
          fileSize = fileItem.size;
        }
      } catch (err) {
        // Ignore error
      }

      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'downloading', progress: 0, total: fileSize });
      }
      const buffer = await getFileContents(normalizedSource);
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'downloading', progress: buffer.length, total: fileSize });
      }
      
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'uploading', progress: buffer.length, total: fileSize });
      }
      await putFileContents(normalizedDest, buffer);
      
      if (progressCallback && fileSize > 0) {
        progressCallback({ stage: 'completed', progress: fileSize, total: fileSize });
      }
      
      return { success: true };
    }
  } catch (error) {
    if (error.message.includes('does not exist') || error.message.includes('already exists')) {
      throw error;
    }
    if (error.status === 502 || error.response?.status === 502) {
      throw new Error('WebDAV server is not responding. Check if server is running and accessible.');
    }
    if (error.message.includes('ECONNREFUSED')) {
      throw new Error('Cannot connect to WebDAV server. Check WEBDAV_URL in .env file.');
    }
    throw new Error(`Failed to copy file: ${error.message}`);
  }
}

async function createDirectory(path) {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    await client.createDirectory(getRequestPath(normalizedPath));
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message}`);
  }
}

function isImageFile(filename) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return imageExtensions.includes(ext);
}

function isVideoFile(filename) {
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return videoExtensions.includes(ext);
}

async function testConnection() {
  try {
    const client = getWebDAVClient();
    const baseUrl = process.env.WEBDAV_URL?.trim() || '';
    const testPaths = baseUrl.includes('/') && baseUrl.split('/').length > 3 ? ['', '/'] : ['/'];
    
    let lastError = null;
    for (const testPath of testPaths) {
      try {
        const items = await client.getDirectoryContents(testPath);
        return { 
          success: true, 
          message: `WebDAV connection successful (path: "${testPath || '/'}")`,
          itemCount: items.length,
          testPath: testPath || '/'
        };
      } catch (err) {
        lastError = err;
      }
    }
    
    throw lastError || new Error('All connection attempts failed');
  } catch (error) {
    const status = error.status || error.response?.status;
    let message = `WebDAV connection failed: ${error.message}`;
    
    if (status === 401) {
      message = `WebDAV authentication failed. Verify credentials in .env file.`;
    } else if (status === 404) {
      message = 'WebDAV path not found. Check WEBDAV_URL in .env file.';
    } else if (status === 403) {
      message = 'WebDAV access forbidden. Check permissions.';
    }
    
    return { 
      success: false, 
      message,
      status,
      error: error.message,
    };
  }
}

async function pathExists(path) {
  const client = getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    try {
      const exists = await client.exists(getRequestPath(normalizedPath));
      return exists;
    } catch (existsError) {
      try {
        const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/';
        const filename = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
        const items = await client.getDirectoryContents(getRequestPath(parentDir));
        return items.some(item => item.basename === filename);
      } catch (listError) {
        return false;
      }
    }
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getWebDAVClient,
  resetWebDAVClient,
  listDirectory,
  getFileContents,
  putFileContents,
  deleteFile,
  moveFile,
  copyFile,
  createDirectory,
  pathExists,
  isImageFile,
  isVideoFile,
  testConnection,
};
