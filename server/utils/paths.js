const path = require('path');

/**
 * Get the project root directory (parent of server/)
 * This function works from any file in the server/ directory structure
 * @returns {string} Absolute path to project root
 */
function getProjectRoot() {
  // __dirname is the directory where this file (paths.js) is located
  // Since this file is at server/utils/paths.js, we need to go up 2 levels
  // server/utils/ -> server/ -> project root
  const projectRoot = path.resolve(__dirname, '../..');
  return projectRoot;
}

/**
 * Get the data directory path (project root/data)
 * @returns {string} Absolute path to data directory
 */
function getDataDir() {
  return path.resolve(path.join(getProjectRoot(), 'data'));
}

/**
 * Get the thumbnail directory path (project root/data/thumbnails)
 * @returns {string} Absolute path to thumbnail directory
 */
function getThumbnailDir() {
  return path.resolve(path.join(getDataDir(), 'thumbnails'));
}

/**
 * Get the database file path (project root/data/database.sqlite)
 * @returns {string} Absolute path to database file
 */
function getDatabasePath() {
  return path.resolve(path.join(getDataDir(), 'database.sqlite'));
}

module.exports = {
  getProjectRoot,
  getDataDir,
  getThumbnailDir,
  getDatabasePath,
};

