'use strict';

const S3BlobStore = require('./S3BlobStore');
const WebdavBlobStore = require('./WebdavBlobStore');
const WebdavFileStoreAdapter = require('../filestore/WebdavFileStoreAdapter');
const { normalizePath, getParentPath, getBasename } = require('@webdav-easyaccess/shared/pathUtils');

const SUPPORTED_TYPES = ['s3', 'webdav'];
const S3_REQUIRED_FIELDS = ['bucket', 'accessKey', 'secretKey'];
const WEBDAV_REQUIRED_FIELDS = ['url', 'username', 'password'];

function deriveDirection(fileStorageMode) {
  return fileStorageMode === 'webdav' ? 'webdav-to-s3' : 's3-to-webdav';
}

function destinationTypeForDirection(direction) {
  return direction === 'webdav-to-s3' ? 's3' : 'webdav';
}

let createClient = null;
function getCreateClient() {
  if (!createClient) {
    createClient = require('webdav').createClient;
  }
  return createClient;
}

function isMissing(value) {
  return value == null || String(value).trim() === '';
}

function assertValidType(destConfig) {
  if (isMissing(destConfig.type)) {
    throw new Error('Missing required destination field: type');
  }
  if (!SUPPORTED_TYPES.includes(destConfig.type)) {
    throw new Error(`Invalid destination type: ${destConfig.type}. Supported types: ${SUPPORTED_TYPES.join(', ')}`);
  }
}

function assertRequiredFields(type, destConfig) {
  const required = type === 's3' ? S3_REQUIRED_FIELDS : WEBDAV_REQUIRED_FIELDS;
  const missing = required.filter(field => isMissing(destConfig[field]));
  if (missing.length > 0) {
    throw new Error(`Missing required destination fields: ${missing.join(', ')}`);
  }
}

function pickField(destConfig, primary, aliases) {
  if (!isMissing(destConfig[primary])) {
    return destConfig[primary];
  }
  for (const alias of aliases) {
    if (!isMissing(destConfig[alias])) {
      return destConfig[alias];
    }
  }
  return undefined;
}

function buildS3BlobStore(destConfig) {
  const accessKey = pickField(destConfig, 'accessKey', ['accessKeyId']);
  const secretKey = pickField(destConfig, 'secretKey', ['secretAccessKey']);
  assertRequiredFields('s3', { ...destConfig, accessKey, secretKey });

  const config = {
    bucket: destConfig.bucket,
    region: destConfig.region || 'us-east-1',
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  };
  if (!isMissing(destConfig.endpoint)) {
    config.endpoint = destConfig.endpoint;
  }

  return {
    blobStore: new S3BlobStore(config),
    summary: buildS3Summary(config),
  };
}

function buildS3Summary(config) {
  const parts = [`bucket=${config.bucket}`, `region=${config.region}`];
  if (config.endpoint) {
    parts.push(`endpoint=${config.endpoint}`);
  }
  return `s3 destination (${parts.join(', ')})`;
}

function buildClientOptions(destConfig, authType) {
  const options = {
    username: destConfig.username,
    password: destConfig.password,
    headers: {
      'User-Agent': 'WebDAV-EasyAccess/1.0',
      'Accept-Charset': 'utf-8',
    },
  };
  if (authType !== 'auto') {
    options.authType = authType;
  }
  return options;
}

function getRequestPath(normalizedPath, baseUrl) {
  if (baseUrl.includes('/') && baseUrl.split('/').length > 3) {
    return normalizedPath === '/' ? '' : normalizedPath.substring(1);
  }
  return normalizedPath;
}

function isAlreadyExistsError(error) {
  if (!error) return false;
  const status = error.status || error.response?.status;
  if (status === 405 || status === 301 || status === 302 || status === 303) return true;
  return /already exists|method not allowed/i.test(String(error.message || ''));
}

async function ensureDirectoryExists(client, baseUrl, directoryPath) {
  const normalizedPath = normalizePath(directoryPath);
  const segments = normalizedPath.split('/').filter(Boolean);

  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`;
    const requestPath = getRequestPath(currentPath, baseUrl);
    try {
      await client.createDirectory(requestPath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }
      const status = error.status || error.response?.status;
      if (status === 409) {
        let exists = false;
        try {
          exists = await client.exists(requestPath);
        } catch (existsError) {
          exists = false;
        }
        if (exists) {
          continue;
        }
      }
      throw error;
    }
  }

  return { success: true };
}

function createDestWebdavModule(client, baseUrl) {
  return {
    listDirectory: async (path = '/') => {
      const requestPath = getRequestPath(normalizePath(path), baseUrl);
      const items = await client.getDirectoryContents(requestPath);
      return items.map(item => ({
        filename: item.filename,
        basename: item.basename,
        lastmod: item.lastmod,
        size: item.size,
        type: item.type,
        mime: item.mime,
      }));
    },
    getFileContents: (filePath) =>
      client.getFileContents(getRequestPath(normalizePath(filePath), baseUrl)),
    putFileContents: (path, buffer) =>
      client.putFileContents(getRequestPath(normalizePath(path), baseUrl), buffer),
    moveFile: (sourcePath, destinationPath, progressCallback, overwrite, options) =>
      client.moveFile(sourcePath, destinationPath, options),
    copyFile: (sourcePath, destinationPath, progressCallback, overwrite, options) =>
      client.copyFile(sourcePath, destinationPath, options),
    deleteFile: (path, options) =>
      client.deleteFile(getRequestPath(normalizePath(path), baseUrl), options),
    createDirectory: (path) => ensureDirectoryExists(client, baseUrl, path),
    ensureDirectoryExists: (path) => ensureDirectoryExists(client, baseUrl, path),
    pathExists: async (path) => {
      try {
        return await client.exists(getRequestPath(normalizePath(path), baseUrl));
      } catch (error) {
        return false;
      }
    },
    getFileMetadata: async (filePath) => {
      const normalizedPath = normalizePath(filePath);
      const parentPath = getParentPath(normalizedPath);
      const basename = getBasename(normalizedPath);
      const items = await client.getDirectoryContents(getRequestPath(parentPath, baseUrl));
      const item = items.find(entry => entry.basename === basename);
      if (!item) {
        const err = new Error(`File not found: ${filePath}`);
        err.status = 404;
        throw err;
      }
      return {
        size: item.size != null ? item.size : 0,
        lastmod: item.lastmod ?? null,
        mime: item.mime ?? null,
      };
    },
  };
}

function buildWebdavBlobStore(destConfig) {
  assertRequiredFields('webdav', destConfig);

  const authType = destConfig.authType || 'auto';
  const upstreamUrl = destConfig.upstreamUrl || '';
  const baseUrl = String(destConfig.url).trim().replace(/\/+$/, '');

  const client = getCreateClient()(baseUrl, buildClientOptions(destConfig, authType));
  client.upstreamUrl = upstreamUrl;

  const adapter = WebdavFileStoreAdapter(createDestWebdavModule(client, baseUrl));
  adapter.upstreamUrl = upstreamUrl;

  return {
    blobStore: new WebdavBlobStore(adapter),
    summary: buildWebdavSummary({ url: baseUrl, authType, upstreamUrl }),
  };
}

function buildWebdavSummary({ url, authType, upstreamUrl }) {
  const parts = [`url=${url}`, `authType=${authType}`];
  if (upstreamUrl) {
    parts.push(`upstreamUrl=${upstreamUrl}`);
  }
  return `webdav destination (${parts.join(', ')})`;
}

function buildDestBlobStore(destConfig) {
  assertValidType(destConfig);

  if (destConfig.type === 's3') {
    return buildS3BlobStore(destConfig);
  }
  return buildWebdavBlobStore(destConfig);
}

module.exports = { buildDestBlobStore, deriveDirection, destinationTypeForDirection };
