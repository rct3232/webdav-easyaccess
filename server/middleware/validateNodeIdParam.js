'use strict';

const { validationError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

/**
 * Parse a nodeId value into a positive integer.
 * Throws a validation error if the value is missing, non-numeric, or <= 0.
 *
 * @param {*} value - Raw node ID value (string or number)
 * @param {string} fieldName - Field name for error context (default 'nodeId')
 * @returns {number} Parsed positive integer
 */
function parseNodeId(value, _fieldName = 'nodeId') {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }
  return parsed;
}

/**
 * Express middleware factory to validate a nodeId parameter.
 * Checks req.body[field] then req.query[field]. Sets req.nodeId on success.
 *
 * @param {string} field - Parameter name (default 'nodeId')
 * @returns {Function} Express middleware
 */
function validateNodeIdParam(field = 'nodeId') {
  return (req, res, next) => {
    const raw = req.body?.[field] ?? req.query?.[field];
    if (raw === undefined || raw === '') {
      return validationError(SERVER_ERROR_CODES.files.invalidPath)(req, res);
    }
    try {
      req.nodeId = parseNodeId(raw, field);
    } catch (err) {
      return next(err);
    }
    return next();
  };
}

module.exports = {
  parseNodeId,
  validateNodeIdParam,
};
