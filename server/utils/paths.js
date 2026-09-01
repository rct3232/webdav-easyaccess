const path = require('path');

function getProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function getDataDir() {
  return path.resolve(path.join(getProjectRoot(), 'data'));
}

function getThumbnailDir() {
  return path.resolve(path.join(getDataDir(), 'thumbnails'));
}

function getDatabasePath() {
  return path.resolve(path.join(getDataDir(), 'database.sqlite'));
}

module.exports = {
  getProjectRoot,
  getDataDir,
  getThumbnailDir,
  getDatabasePath,
};
