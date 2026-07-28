'use strict';

const WebdavFileStoreAdapter = require('./WebdavFileStoreAdapter');
const webdav = require('../../../utils/webdav');

/**
 * Creates a FileStoreAdapter wired to the default WebDAV backend.
 *
 * @returns {*} FileStoreAdapter instance (see FileStoreAdapter.js typedef)
 */
function createFileStoreAdapter() {
  return WebdavFileStoreAdapter(webdav);
}

module.exports = { createFileStoreAdapter };
