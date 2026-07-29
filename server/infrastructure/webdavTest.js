const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../utils/errorHandler');

let createClientPromise = null;
async function getCreateClient() {
  if (!createClientPromise) {
    createClientPromise = import('webdav').then(mod => mod.createClient);
  }
  return await createClientPromise;
}

async function getWebDAVClient() {
  const url = process.env.WEBDAV_URL?.trim();
  const username = process.env.WEBDAV_USERNAME;
  const password = process.env.WEBDAV_PASSWORD;
  if (!url || !username || !password) {
    throw createError(SERVER_ERROR_CODES.webdav.credentialsNotConfigured, HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
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
  return createClient(url, clientOptions);
}

async function testConnection() {
  const client = await getWebDAVClient();
  const baseUrl = process.env.WEBDAV_URL?.trim() || '';
  const testPaths = baseUrl.includes('/') && baseUrl.split('/').length > 3 ? ['', '/'] : ['/'];

  let lastError = null;
  for (const testPath of testPaths) {
    try {
      const items = await client.getDirectoryContents(testPath);
      return {
        success: true,
        messageCode: SERVER_MESSAGE_CODES.api.webdavTestOk,
        itemCount: items.length,
        testPath: testPath || '/',
      };
    } catch (err) {
      lastError = err;
    }
  }

  const error = lastError || createError(SERVER_ERROR_CODES.webdav.allConnectionAttemptsFailed, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  const status = error.status || error.statusCode || error.response?.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  if (error.errorCode) throw error;
  if (status === HTTP_STATUS.UNAUTHORIZED) throw createError(SERVER_ERROR_CODES.webdav.credentialsNotConfigured, status);
  if (status === HTTP_STATUS.NOT_FOUND) throw createError(SERVER_ERROR_CODES.webdav.cannotConnect, status);
  if (status === HTTP_STATUS.FORBIDDEN) throw createError(SERVER_ERROR_CODES.webdav.connectionRefused, status);
  throw createError(SERVER_ERROR_CODES.api.webdavTestFailed, status, { reason: error.message });
}

module.exports = { testConnection };
