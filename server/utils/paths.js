const path = require('path');

function getProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function getDataDir() {
  return path.resolve(path.join(getProjectRoot(), 'data'));
}

module.exports = {
  getProjectRoot,
  getDataDir,
};
