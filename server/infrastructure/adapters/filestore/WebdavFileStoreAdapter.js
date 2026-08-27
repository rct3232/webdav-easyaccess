'use strict';

/**
 * Adapter that delegates file operations to the WebDAV utility module.
 *
 * @param {Object} webdav — Object containing WebDAV functions (from utils/webdav.js).
 * @returns {Object} FileStoreAdapter instance (see FileStoreAdapter.js typedef)
 */
function WebdavFileStoreAdapter(webdav) {
  if (!webdav) {
    throw new Error('WebdavFileStoreAdapter requires a webdav implementation');
  }

  return {
    listDirectory: (path = '/') => webdav.listDirectory(path),
    getFileContents: (filePath) => webdav.getFileContents(filePath),
    putFileContents: (path, buffer) => webdav.putFileContents(path, buffer),
    moveFile: (sourcePath, destinationPath, progressCallback, overwrite, options) =>
      webdav.moveFile(sourcePath, destinationPath, progressCallback, overwrite, options),
    copyFile: (sourcePath, destinationPath, progressCallback, overwrite, options) =>
      webdav.copyFile(sourcePath, destinationPath, progressCallback, overwrite, options),
    deleteFile: (path, options) => webdav.deleteFile(path, options),
    createDirectory: (path) => webdav.createDirectory(path),
    ensureDirectoryExists: (path) => webdav.ensureDirectoryExists(path),
    pathExists: (path) => webdav.pathExists(path),
    getFileMetadata: (filePath) => webdav.getFileMetadata(filePath),
  };
}

module.exports = WebdavFileStoreAdapter;
