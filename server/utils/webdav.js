const path = require('path');
const { normalizePath } = require('./pathUtils');
const { asyncLimit } = require('./asyncUtils');

const clientCache = new Map();

let createClientPromise = null;
async function getCreateClient() {
  if (!createClientPromise) {
    createClientPromise = import('webdav').then(mod => mod.createClient);
  }
  return await createClientPromise;
}

function logWebdavError(context, error, extra = {}) {
  const status = error?.status || error?.response?.status;
  const code = error?.code;
  const message = error?.message;
  const details = {
    status,
    code,
    message,
    ...extra,
  };
  console.error(`[WebDAV] ${context}`, details);
}

function getRequestPath(normalizedPath, baseUrlOverride = null) {
  const baseUrl = baseUrlOverride?.trim?.() || process.env.WEBDAV_URL?.trim() || '';
  if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
    return normalizedPath === '/' ? '' : normalizedPath.substring(1);
  }
  return normalizedPath;
}

/**
 * Build an absolute Destination URL safe for HTTP headers.
 *
 * Node rejects non-Latin1 characters in header values (ERR_INVALID_CHAR),
 * so we must ensure the URL is ASCII/percent-encoded.
 *
 * @param {string} destBase - Absolute base URL (may include a path prefix like /webdav)
 * @param {string} normalizedDest - WebDAV destination path (absolute, normalized)
 * @returns {string} Absolute, percent-encoded URL string
 */
function buildDestinationAbsoluteUrl(destBase, normalizedDest) {
  const base = (destBase || '').trim();
  const destNormalized = normalizePath(normalizedDest);

  // If base is missing, fall back to a best-effort encoded request path.
  if (!base) {
    const rp = getRequestPath(destNormalized);
    return encodeURI(rp).replace(/\?/g, '%3F').replace(/#/g, '%23');
  }

  const destRequestPath = getRequestPath(destNormalized, base);

  try {
    const u = new URL(base);
    // Ensure we do not accidentally preserve any query/fragment in the base URL.
    u.search = '';
    u.hash = '';

    const destPart = destRequestPath ? destRequestPath.replace(/^\//, '') : '';
    const basePathname = u.pathname || '/';
    u.pathname = path.posix.join(basePathname, destPart);
    return u.toString();
  } catch (e) {
    // Best-effort fallback if base is not a valid absolute URL.
    const destBaseTrimmed = base.endsWith('/') ? base.slice(0, -1) : base;
    const abs = destBaseTrimmed
      ? `${destBaseTrimmed}${destRequestPath.startsWith('/') ? '' : '/'}${destRequestPath}`
      : destRequestPath;
    return encodeURI(abs).replace(/\?/g, '%3F').replace(/#/g, '%23');
  }
}

async function getWebDAVClient(baseUrlOverride = null) {
  let url = baseUrlOverride || process.env.WEBDAV_URL;
  const username = process.env.WEBDAV_USERNAME;
  const password = process.env.WEBDAV_PASSWORD;

  if (!url || !username || !password) {
    throw new Error('WebDAV credentials not configured in .env file');
  }

  url = url.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  if (!clientCache.has(url)) {
    const createClient = await getCreateClient();
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

    const client = createClient(url, clientOptions);
    clientCache.set(url, client);
  }

  return clientCache.get(url);
}

function resetWebDAVClient() {
  clientCache.clear();
  console.log('WebDAV client reset');
}

async function moveFileStreamed(sourcePath, destinationPath, progressCallback) {
  const client = await getWebDAVClient(); // fallback uses default base URL
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
      await asyncLimit(5, sourceItems, async (item) => {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        await moveFileStreamed(sourceItemPath, destItemPath);
      });
      
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
    logWebdavError('MOVE fallback(stream) failed', error, { sourcePath, destinationPath });
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

async function copyFileStreamed(sourcePath, destinationPath, progressCallback) {
  const client = await getWebDAVClient(); // fallback uses default base URL
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
      await asyncLimit(5, sourceItems, async (item) => {
        const sourceItemPath = item.filename || `${normalizedSource}/${item.basename}`;
        const destItemPath = `${normalizedDest}/${item.basename}`;
        await copyFileStreamed(sourceItemPath, destItemPath);
      });
      
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
    logWebdavError('COPY fallback(stream) failed', error, { sourcePath, destinationPath });
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

async function listDirectory(path = '/') {
  const client = await getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath);
    const items = await client.getDirectoryContents(requestPath);
    // WebDAV 클라이언트가 반환하는 항목들을 정규화하여 반환
    // basename만 사용하여 직접 자식만 표시되도록 보장
    return items.map(item => ({
      filename: item.filename,
      basename: item.basename,
      lastmod: item.lastmod,
      size: item.size,
      type: item.type,
      mime: item.mime,
    })).filter(item => {
      // basename만 있는 항목만 반환 (직접 자식만)
      // filename이 있더라도 실제로는 basename으로 경로를 구성하므로 필터링 불필요
      return item.basename && item.basename.trim() !== '';
    });
  } catch (error) {
    const status = error.status || error.response?.status;
    if (status === 401 || status === 403) {
      const err = new Error(`WebDAV authentication failed. Check credentials in .env file. Original: ${error.message}`);
      err.status = status;
      throw err;
    }
    if (status === 404) {
      const err = new Error(`Directory not found: ${path}`);
      err.status = 404;
      throw err;
    }
    const err = new Error(`Failed to list directory: ${error.message}`);
    err.status = status || 500;
    throw err;
  }
}

async function getFileContents(filePath) {
  const client = await getWebDAVClient();
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
  const client = await getWebDAVClient();
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

/**
 * PUT file contents with advanced options (headers, overwrite, etc).
 * This is required for conditional requests like If-None-Match: *.
 *
 * @param {string} path
 * @param {Buffer|string|import("stream").Readable} buffer
 * @param {object} options - Passed through to webdav client's putFileContents
 * @returns {Promise<{success: true}>}
 */
async function putFileContentsAdvanced(path, buffer, options = {}) {
  const client = await getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath);
    await client.putFileContents(requestPath, buffer, options);
    return { success: true };
  } catch (error) {
    // Preserve status codes for callers that need to branch on 412/409/etc
    throw error;
  }
}

/**
 * Perform a custom WebDAV request using the configured client.
 * @param {string} path
 * @param {object} requestOptions
 * @param {string|null} baseUrlOverride
 * @returns {Promise<any>}
 */
async function customRequest(path, requestOptions, baseUrlOverride = null) {
  const client = await getWebDAVClient(baseUrlOverride);
  const normalizedPath = normalizePath(path);
  const requestPath = getRequestPath(normalizedPath, baseUrlOverride);
  return client.customRequest(requestPath, requestOptions);
}

async function deleteFile(path) {
  const client = await getWebDAVClient();
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

async function moveFile(sourcePath, destinationPath, progressCallback, overwrite = false) {
  const sourceBase = process.env.WEBDAV_URL?.trim();
  const destBase = process.env.WEBDAV_UPSTREAM_URL?.trim() || sourceBase;
  const client = await getWebDAVClient(sourceBase);
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDest = normalizePath(destinationPath);

  if (normalizedSource === normalizedDest) {
    return { success: true };
  }

  const destRequestPath = getRequestPath(normalizedDest, destBase);
  const destBaseTrimmed = destBase?.endsWith('/') ? destBase.slice(0, -1) : destBase;
  const destAbsoluteRaw = destBaseTrimmed
    ? `${destBaseTrimmed}${destRequestPath.startsWith('/') ? '' : '/'}${destRequestPath}`
    : destRequestPath;
  const destAbsolute = buildDestinationAbsoluteUrl(destBase, normalizedDest);

  try {
    const sourceRequestPath = getRequestPath(normalizedSource);
    await client.customRequest(sourceRequestPath, {
      method: 'MOVE',
      headers: {
        Destination: destAbsolute,
        Overwrite: overwrite ? 'T' : 'F',
      },
      retry: false,
    });
    if (progressCallback) {
      progressCallback({ stage: 'completed', progress: 1, total: 1 });
    }
    return { success: true };
  } catch (error) {
    logWebdavError('MOVE failed (will fallback)', error, {
      sourcePath: sourcePath,
      destinationPath: destinationPath,
      destinationAbsolute: destAbsolute,
      destinationAbsoluteRaw: destAbsoluteRaw,
      sourceBase,
      destBase,
    });
    // If destination already exists or source missing, surface immediately
    const status = error?.status || error?.response?.status;
    if (status === 409 && !overwrite) {
      throw new Error(`Destination already exists: ${destinationPath}`);
    }
    if (status === 404) {
      throw new Error(`Source not found: ${sourcePath}`);
    }
    // Fallback to streaming move
    return await moveFileStreamed(sourcePath, destinationPath, progressCallback);
  }
}

async function copyFile(sourcePath, destinationPath, progressCallback, overwrite = false) {
  const sourceBase = process.env.WEBDAV_URL?.trim();
  const destBase = process.env.WEBDAV_UPSTREAM_URL?.trim() || sourceBase;
  const client = await getWebDAVClient(sourceBase);
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDest = normalizePath(destinationPath);

  if (normalizedSource === normalizedDest) {
    return { success: true };
  }

  const destRequestPath = getRequestPath(normalizedDest, destBase);
  const destBaseTrimmed = destBase?.endsWith('/') ? destBase.slice(0, -1) : destBase;
  const destAbsoluteRaw = destBaseTrimmed
    ? `${destBaseTrimmed}${destRequestPath.startsWith('/') ? '' : '/'}${destRequestPath}`
    : destRequestPath;
  const destAbsolute = buildDestinationAbsoluteUrl(destBase, normalizedDest);

  try {
    const sourceRequestPath = getRequestPath(normalizedSource);
    await client.customRequest(sourceRequestPath, {
      method: 'COPY',
      headers: {
        Destination: destAbsolute,
        Overwrite: overwrite ? 'T' : 'F',
        Depth: 'infinity',
      },
      retry: false,
    });
    if (progressCallback) {
      progressCallback({ stage: 'completed', progress: 1, total: 1 });
    }
    return { success: true };
  } catch (error) {
    logWebdavError('COPY failed (will fallback)', error, {
      sourcePath: sourcePath,
      destinationPath: destinationPath,
      destinationAbsolute: destAbsolute,
      destinationAbsoluteRaw: destAbsoluteRaw,
      sourceBase,
      destBase,
    });
    const status = error?.status || error?.response?.status;
    if (status === 409 && !overwrite) {
      throw new Error(`Destination already exists: ${destinationPath}`);
    }
    if (status === 404) {
      throw new Error(`Source not found: ${sourcePath}`);
    }
    return await copyFileStreamed(sourcePath, destinationPath, progressCallback);
  }
}

async function createDirectory(path) {
  const client = await getWebDAVClient();
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
    const client = await getWebDAVClient();
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
  const client = await getWebDAVClient();
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
  getRequestPath,
  buildDestinationAbsoluteUrl,
  resetWebDAVClient,
  listDirectory,
  getFileContents,
  putFileContents,
  putFileContentsAdvanced,
  customRequest,
  deleteFile,
  moveFile,
  copyFile,
  createDirectory,
  pathExists,
  isImageFile,
  isVideoFile,
  testConnection,
};
