/* eslint-disable no-console -- WebDAV client reset diagnostic */
const path = require('path');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath, getParentPath, getBasename } = require('@webdav-easyaccess/shared/pathUtils');
const { asyncLimit } = require('./asyncUtils');
const { createError } = require('./errorHandler');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const { createCacheAdapter } = require('../infrastructure/adapters/cache');
const { getSharedResolver } = require('../infrastructure/configResolver');
const clientCache = createCacheAdapter();

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

function getRequestPath(normalizedPath, baseUrlOverride = null, options = {}) {
  const path = options?.isDirectory
    ? normalizePath(normalizedPath, { isDirectory: true })
    : normalizedPath;
  const baseUrl = baseUrlOverride?.trim?.() || process.env.WEBDAV_URL?.trim() || '';
  if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
    return path === '/' ? '' : path.substring(1);
  }
  return path;
}

/**
 * Build an absolute Destination URL safe for HTTP headers.
 *
 * Node rejects non-Latin1 characters in header values (ERR_INVALID_CHAR),
 * so we must ensure the URL is ASCII/percent-encoded.
 *
 * @param {string} destBase - Absolute base URL (may include a path prefix like /webdav)
 * @param {string} normalizedDest - WebDAV destination path (absolute, normalized)
 * @param {object} [options] - Optional settings
 * @param {boolean} [options.isDirectory] - If true, ensure destination path ends with /
 * @returns {string} Absolute, percent-encoded URL string
 */
function buildDestinationAbsoluteUrl(destBase, normalizedDest, options = {}) {
  const base = (destBase || '').trim();
  const destNormalized = options?.isDirectory
    ? normalizePath(normalizedDest, { isDirectory: true })
    : normalizePath(normalizedDest);

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
    throw createError(SERVER_ERROR_CODES.webdav.credentialsNotConfigured, HTTP_STATUS.SERVICE_UNAVAILABLE);
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

      await deleteFile(normalizedSource, { isDirectory: true });
      return { success: true };
    } else {
      let fileSize = 0;
      try {
        const parentPath = getParentPath(normalizedSource);
        const fileName = getBasename(normalizedSource);
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

      await deleteFile(normalizedSource, { isDirectory: false });

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
    if (error.status === HTTP_STATUS.BAD_GATEWAY || error.response?.status === HTTP_STATUS.BAD_GATEWAY) {
      throw createError(SERVER_ERROR_CODES.webdav.serverNotResponding, HTTP_STATUS.BAD_GATEWAY);
    }
    if (error.message.includes('ECONNREFUSED')) {
      throw createError(SERVER_ERROR_CODES.webdav.cannotConnect, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
    throw createError(SERVER_ERROR_CODES.webdav.operationFailed, error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
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
        const parentPath = getParentPath(normalizedSource);
        const fileName = getBasename(normalizedSource);
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
    if (error.status === HTTP_STATUS.BAD_GATEWAY || error.response?.status === HTTP_STATUS.BAD_GATEWAY) {
      throw createError(SERVER_ERROR_CODES.webdav.serverNotResponding, HTTP_STATUS.BAD_GATEWAY);
    }
    if (error.message.includes('ECONNREFUSED')) {
      throw createError(SERVER_ERROR_CODES.webdav.cannotConnect, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
    throw createError(SERVER_ERROR_CODES.webdav.operationFailed, error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
  }
}

async function listDirectory(path = '/') {
  const client = await getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath);
    const items = await client.getDirectoryContents(requestPath);
    // Normalize items returned by the WebDAV client
    // Use only basename to ensure direct children are displayed
    return items.map(item => ({
      filename: item.filename,
      basename: item.basename,
      lastmod: item.lastmod,
      size: item.size,
      type: item.type,
      mime: item.mime,
    })).filter(item => {
      // Return only items with a basename (direct children only)
      // Even if filename exists, the path is constructed from basename, so no filtering needed
      return item.basename && item.basename.trim() !== '';
    });
  } catch (error) {
    const status = error.status || error.response?.status;
    if (status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN) {
      const err = new Error(`WebDAV authentication failed. Check credentials in .env file. Original: ${error.message}`);
      err.status = status;
      throw err;
    }
    if (status === HTTP_STATUS.NOT_FOUND) {
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
    throw createError(SERVER_ERROR_CODES.webdav.operationFailed, error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
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
    if (error.status === HTTP_STATUS.NOT_FOUND || error.response?.status === HTTP_STATUS.NOT_FOUND) {
      throw createError(SERVER_ERROR_CODES.webdav.pathNotFound, HTTP_STATUS.NOT_FOUND, { path });
    } else if (error.status === HTTP_STATUS.FORBIDDEN || error.response?.status === HTTP_STATUS.FORBIDDEN) {
      throw createError(SERVER_ERROR_CODES.webdav.permissionDeniedUpload, HTTP_STATUS.FORBIDDEN, { path });
    } else if (error.status === HTTP_STATUS.CONFLICT || error.response?.status === HTTP_STATUS.CONFLICT) {
      throw createError(SERVER_ERROR_CODES.webdav.conflictUpload, HTTP_STATUS.CONFLICT, { path });
    } else if (error.status === HTTP_STATUS.INTERNAL_SERVER_ERROR || error.response?.status === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      throw createError(SERVER_ERROR_CODES.webdav.operationFailed, HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
    } else if (error.message.includes('ECONNREFUSED')) {
      throw createError(SERVER_ERROR_CODES.webdav.connectionRefused, HTTP_STATUS.SERVICE_UNAVAILABLE, { reason: error.message });
    }
    throw createError(SERVER_ERROR_CODES.webdav.uploadFailed, error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
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

async function deleteFile(path, options = {}) {
  const client = await getWebDAVClient();
  try {
    const normalizedPath = normalizePath(path);
    const requestPath = getRequestPath(normalizedPath, null, options);
    await client.deleteFile(requestPath);
    return { success: true };
  } catch (error) {
    if (error.status === HTTP_STATUS.NOT_FOUND || error.response?.status === HTTP_STATUS.NOT_FOUND) {
      throw createError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound, HTTP_STATUS.NOT_FOUND, { path });
    } else if (error.status === HTTP_STATUS.FORBIDDEN || error.response?.status === HTTP_STATUS.FORBIDDEN) {
      throw createError(SERVER_ERROR_CODES.webdav.permissionDeniedDelete, HTTP_STATUS.FORBIDDEN, { path });
    } else if (error.status === HTTP_STATUS.CONFLICT || error.response?.status === HTTP_STATUS.CONFLICT) {
      throw createError(SERVER_ERROR_CODES.webdav.dirNotEmptyOrConflict, HTTP_STATUS.CONFLICT, { path });
    } else if (error.message.includes('ECONNREFUSED')) {
      throw createError(SERVER_ERROR_CODES.webdav.connectionRefused, HTTP_STATUS.SERVICE_UNAVAILABLE, { reason: error.message });
    }
    throw createError(SERVER_ERROR_CODES.webdav.deleteFailed, error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
  }
}

async function moveFile(sourcePath, destinationPath, progressCallback, overwrite = false, options = {}) {
  const sourceBase = process.env.WEBDAV_URL?.trim();
  // WEBDAV_UPSTREAM_URL is T2 (hot): resolved lazily per operation so DB
  // changes apply immediately without a restart.
  const upstreamUrl = await getSharedResolver().getConfig('WEBDAV_UPSTREAM_URL');
  const destBase = upstreamUrl?.trim() || sourceBase;
  const client = await getWebDAVClient(sourceBase);
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDest = normalizePath(destinationPath);

  if (normalizedSource === normalizedDest) {
    return { success: true };
  }

  const sourceRequestPath = getRequestPath(normalizedSource, sourceBase, options);
  const destAbsolute = buildDestinationAbsoluteUrl(destBase, normalizedDest, options);
  const destRequestPath = getRequestPath(normalizedDest, destBase, options);
  const destBaseTrimmed = destBase?.endsWith('/') ? destBase.slice(0, -1) : destBase;
  const destAbsoluteRaw = destBaseTrimmed
    ? `${destBaseTrimmed}${destRequestPath.startsWith('/') ? '' : '/'}${destRequestPath}`
    : destRequestPath;

  try {
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
      sourcePath,
      destinationPath,
      destinationAbsolute: destAbsolute,
      destinationAbsoluteRaw: destAbsoluteRaw,
      sourceBase,
      destBase,
    });
    const status = error?.status || error?.response?.status;
    if (status === HTTP_STATUS.CONFLICT && !overwrite) {
      throw createError(SERVER_ERROR_CODES.webdav.destinationExists, HTTP_STATUS.CONFLICT, { path: destinationPath });
    }
    if (status === HTTP_STATUS.NOT_FOUND) {
      throw createError(SERVER_ERROR_CODES.webdav.sourceNotFound, HTTP_STATUS.NOT_FOUND, { path: sourcePath });
    }
    return await moveFileStreamed(sourcePath, destinationPath, progressCallback);
  }
}

async function copyFile(sourcePath, destinationPath, progressCallback, overwrite = false, options = {}) {
  const sourceBase = process.env.WEBDAV_URL?.trim();
  const upstreamUrl = await getSharedResolver().getConfig('WEBDAV_UPSTREAM_URL');
  const destBase = upstreamUrl?.trim() || sourceBase;
  const client = await getWebDAVClient(sourceBase);
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDest = normalizePath(destinationPath);

  if (normalizedSource === normalizedDest) {
    return { success: true };
  }

  const sourceRequestPath = getRequestPath(normalizedSource, sourceBase, options);
  const destAbsolute = buildDestinationAbsoluteUrl(destBase, normalizedDest, options);
  const destRequestPath = getRequestPath(normalizedDest, destBase, options);
  const destBaseTrimmed = destBase?.endsWith('/') ? destBase.slice(0, -1) : destBase;
  const destAbsoluteRaw = destBaseTrimmed
    ? `${destBaseTrimmed}${destRequestPath.startsWith('/') ? '' : '/'}${destRequestPath}`
    : destRequestPath;

  try {
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
    if (status === HTTP_STATUS.CONFLICT && !overwrite) {
      throw createError(SERVER_ERROR_CODES.webdav.destinationExists, HTTP_STATUS.CONFLICT, { path: destinationPath });
    }
    if (status === HTTP_STATUS.NOT_FOUND) {
      throw createError(SERVER_ERROR_CODES.webdav.sourceNotFound, HTTP_STATUS.NOT_FOUND, { path: sourcePath });
    }
    return await copyFileStreamed(sourcePath, destinationPath, progressCallback);
  }
}

/**
 * Classify a WebDAV MKCOL failure as "resource already exists" so directory
 * creation can be idempotent. Different servers report existing collections
 * differently (405 Method Not Allowed, 301/302/303 redirects, or a message
 * containing "already exists").
 */
function isAlreadyExistsError(error) {
  if (!error) return false;
  const status = error.status || error.response?.status;
  // 405 is the most common "collection already exists" response across
  // WebDAV servers (bytemark, Apache mod_dav, SabreDAV). Redirects are
  // typically followed by the server to the existing resource.
  if (status === 405 || status === 301 || status === 302 || status === 303) {
    return true;
  }
  return /already exists|method not allowed/i.test(String(error.message || ''));
}

/**
 * Ensure a directory exists on the WebDAV server by issuing MKCOL for every
 * missing path segment from root to deepest, tolerating already-existing
 * collections.
 *
 * Root → deepest recursion is required because many WebDAV servers (bytemark
 * included) reject MKCOL with 409 Conflict when the parent collection is
 * missing. A 409 is therefore disambiguated with an existence probe before
 * being treated as a real failure.
 *
 * @param {string} directoryPath - Absolute WebDAV path to ensure exists.
 * @returns {Promise<{success: true}>}
 */
async function ensureDirectoryExists(directoryPath) {
  const client = await getWebDAVClient();
  const normalizedPath = normalizePath(directoryPath);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { success: true };
  }

  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`;
    const requestPath = getRequestPath(currentPath);
    try {
      await client.createDirectory(requestPath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }
      const status = error.status || error.response?.status;
      if (status === HTTP_STATUS.CONFLICT) {
        let exists = false;
        try {
          exists = await client.exists(requestPath);
        } catch (existsError) {
          // fall through and surface the original MKCOL failure
        }
        if (exists) {
          continue;
        }
      }
      throw createError(SERVER_ERROR_CODES.webdav.createDirFailed, status || HTTP_STATUS.INTERNAL_SERVER_ERROR, { reason: error.message });
    }
  }

  return { success: true };
}

/**
 * Create a directory, ensuring all missing parent segments are created too.
 * Idempotent: succeeds when the collection already exists.
 */
async function createDirectory(path) {
  return ensureDirectoryExists(path);
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
        const parentDir = getParentPath(normalizedPath);
        const filename = getBasename(normalizedPath);
        const items = await client.getDirectoryContents(getRequestPath(parentDir));
        const resolved = items.some(item => item.basename === filename);
        return resolved;
      } catch (listError) {
        return false;
      }
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Get metadata (size, lastmod, mime) for a single file via parent directory listing.
 * @param {string} filePath - Normalized file path
 * @returns {Promise<{ size: number, lastmod: string|null, mime: string|null }>}
 * @throws when file not found or listing fails
 */
async function getFileMetadata(filePath) {
  const normalizedPath = normalizePath(filePath);
  const parentPath = getParentPath(normalizedPath);
  const basename = getBasename(normalizedPath);
  const items = await listDirectory(parentPath);
  const item = items.find((i) => i.basename === basename);
  if (!item) {
    const err = new Error(`File not found: ${filePath}`);
    err.status = HTTP_STATUS.NOT_FOUND;
    throw err;
  }
  return {
    size: item.size != null ? item.size : 0,
    lastmod: item.lastmod ?? null,
    mime: item.mime ?? null,
  };
}

/**
 * Get recursive statistics (file count and total size) for a folder.
 * @param {string} folderPath - Normalized folder path
 * @param {typeof listDirectory} [listDir] - Optional listDirectory implementation (for tests).
 * @returns {Promise<{ fileCount: number, totalSize: number }>}
 */
async function getRecursiveFolderStats(folderPath, listDir = listDirectory) {
  const normalizedPath = normalizePath(folderPath);
  let fileCount = 0;
  let totalSize = 0;

  async function walk(currentPath) {
    const items = await listDir(currentPath);
    for (const item of items) {
      if (item.type === 'directory') {
        await walk(item.filename || `${currentPath}/${item.basename}`);
      } else {
        fileCount++;
        totalSize += item.size || 0;
      }
    }
  }

  await walk(normalizedPath);
  return { fileCount, totalSize };
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
  ensureDirectoryExists,
  pathExists,
  getFileMetadata,
  getRecursiveFolderStats,
};

// Re-export for backward compatibility
const { testConnection } = require('../infrastructure/webdavTest');
const { isImageFile, isVideoFile } = require('./fileTypes');
module.exports.testConnection = testConnection;
module.exports.isImageFile = isImageFile;
module.exports.isVideoFile = isVideoFile;
