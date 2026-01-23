/**
 * Middleware to normalize path parameters
 * Automatically normalizes path parameters in query, body, and params
 */

const { normalizePath } = require('../utils/pathUtils');

/**
 * Middleware to normalize path parameters
 * Normalizes paths in req.query.path, req.body.path, req.body.sourcePath, req.body.destinationPath
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function normalizePathParam(req, res, next) {
  // Normalize query path
  if (req.query.path) {
    req.query.path = normalizePath(req.query.path);
  }
  
  // Normalize body path
  if (req.body.path) {
    req.body.path = normalizePath(req.body.path);
  }
  
  // Normalize source and destination paths
  if (req.body.sourcePath) {
    req.body.sourcePath = normalizePath(req.body.sourcePath);
  }
  
  if (req.body.destinationPath) {
    req.body.destinationPath = normalizePath(req.body.destinationPath);
  }
  
  // Normalize oldPath (for rename operations)
  if (req.body.oldPath) {
    req.body.oldPath = normalizePath(req.body.oldPath);
  }
  
  // Normalize folderPath (for permission operations)
  if (req.body.folderPath) {
    req.body.folderPath = normalizePath(req.body.folderPath);
  }
  
  if (req.query.folderPath) {
    req.query.folderPath = normalizePath(req.query.folderPath);
  }
  
  next();
}

module.exports = normalizePathParam;
