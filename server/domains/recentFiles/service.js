const recentFilesStore = require('../../store/recentFilesStore');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

async function getRecentFiles(userId) {
  return recentFilesStore.getUserRecentFiles(userId);
}

async function addRecentFile(userId, fileData) {
  if (!fileData.path) {
    throw new Error('pathRequired');
  }
  const normalizedPath = normalizePath(fileData.path);
  const file = {
    path: normalizedPath,
    name: fileData.name || fileData.basename || normalizedPath.split('/').pop(),
    type: fileData.type || 'file',
  };
  return recentFilesStore.addRecentFile(userId, file);
}

async function removeRecentFile(userId, filePath) {
  if (!filePath) {
    throw new Error('pathRequired');
  }
  const decodedPath = decodeURIComponent(filePath);
  const normalizedPath = normalizePath(decodedPath);
  return recentFilesStore.removeRecentFile(userId, normalizedPath);
}

async function clearRecentFiles(userId) {
  return recentFilesStore.clearRecentFiles(userId);
}

async function applyBulkMove(userId, moves) {
  if (!Array.isArray(moves)) {
    throw new Error('movesRequired');
  }
  return recentFilesStore.applyBulkMove(userId, moves);
}

async function removePaths(userId, filePaths = [], folderPaths = []) {
  if (!Array.isArray(filePaths) || !Array.isArray(folderPaths)) {
    throw new Error('pathsMustBeArrays');
  }
  return recentFilesStore.removePaths(userId, filePaths, folderPaths);
}

module.exports = {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  applyBulkMove,
  removePaths,
};
