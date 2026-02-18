/**
 * Centralized error handling utilities for Express routes
 * Provides asyncHandler wrapper and error handler middleware
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

/**
 * Wraps async route handlers to automatically catch errors
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 * 
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 * @example
 * router.get('/users', asyncHandler(async (req, res) => {
 *   const users = await User.findAll();
 *   res.json(users);
 * }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Standard error response format.
 * When error.errorCode is set, returns { errorCode, params } for client i18n.
 * Otherwise returns legacy { error } for backward compatibility.
 * @param {Error} error - Error object (may have errorCode, params)
 * @param {Object} options - Additional options
 * @param {string} options.defaultErrorCode - Default i18n error code
 * @param {number} options.defaultStatus - Default HTTP status code
 * @returns {Object} Standardized error response
 */
function formatErrorResponse(error, options = {}) {
  const {
    defaultErrorCode = SERVER_ERROR_CODES.errorHandler.internalServerError,
    defaultStatus = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  } = options;

  const status = error.status || error.statusCode || defaultStatus;

  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const details = isDevelopment && error.stack ? error.stack : undefined;

  if (error.errorCode) {
    return {
      errorCode: error.errorCode,
      ...(error.params && Object.keys(error.params).length > 0 && { params: error.params }),
      ...(details && { details }),
    };
  }

  // No errorCode: return default error code so client can translate (optionally include reason for debugging)
  const params = error.message ? { reason: error.message } : undefined;
  return {
    errorCode: defaultErrorCode,
    ...(params && Object.keys(params).length > 0 && { params }),
    ...(details && { details }),
  };
}

/**
 * Log error with context
 * @param {Error} error - Error object
 * @param {Object} context - Additional context information
 * @param {string} context.method - HTTP method
 * @param {string} context.path - Request path
 * @param {Object} context.query - Query parameters
 * @param {Object} context.body - Request body
 * @param {number} context.user - User ID
 */
function logError(error, context = {}) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    ...context,
  };

  console.error('[Error]', JSON.stringify(errorInfo, null, 2));
}

/**
 * Express error handler middleware
 * Should be added after all routes: app.use(errorHandler)
 * 
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @example
 * // In server/index.js
 * app.use('/api', routes);
 * app.use(errorHandler); // Must be last
 */
function errorHandler(err, req, res, next) {
  // Log error with request context
  logError(err, {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    user: req.user?.id,
  });

  // Format error response
  const response = formatErrorResponse(err, {
    defaultErrorCode: SERVER_ERROR_CODES.errorHandler.internalServerError,
    defaultStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  });

  // Determine status code
  const status = err.status || err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // Send error response
  res.status(status).json(response);
}

/**
 * Create a custom error with status code.
 * @param {string} errorCode - i18n error code (e.g. SERVER_ERROR_CODES.auth.userNotFound)
 * @param {number} status - HTTP status code (default: 500)
 * @param {Object} [params] - Optional params for i18n interpolation
 * @returns {Error} Error object with status, errorCode, params
 * @example
 * throw createError(SERVER_ERROR_CODES.auth.userNotFound, 404);
 */
function createError(errorCode, status = HTTP_STATUS.INTERNAL_SERVER_ERROR, params = undefined) {
  const error = new Error(errorCode);
  error.status = status;
  error.errorCode = errorCode;
  if (params != null && Object.keys(params).length > 0) {
    error.params = params;
  }
  return error;
}

/**
 * Validation error (400)
 * @param {string} errorCode - i18n error code
 * @param {Object} [params] - Optional params for i18n
 * @returns {Error} Validation error
 */
function validationError(errorCode, params = undefined) {
  return createError(errorCode, 400, params);
}

/**
 * Unauthorized error (401)
 * @param {string} [errorCode] - i18n error code (default: utilsAuth token error)
 * @param {Object} [params] - Optional params for i18n
 * @returns {Error} Unauthorized error
 */
function unauthorizedError(errorCode = SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken, params = undefined) {
  return createError(errorCode, 401, params);
}

/**
 * Forbidden error (403)
 * @param {string} [errorCode] - i18n error code
 * @param {Object} [params] - Optional params for i18n
 * @returns {Error} Forbidden error
 */
function forbiddenError(errorCode = SERVER_ERROR_CODES.permissionsMiddleware.accessDenied, params = undefined) {
  return createError(errorCode, 403, params);
}

/**
 * Not found error (404)
 * @param {string} errorCode - i18n error code
 * @param {Object} [params] - Optional params for i18n
 * @returns {Error} Not found error
 */
function notFoundError(errorCode, params = undefined) {
  return createError(errorCode, 404, params);
}

/**
 * Conflict error (409)
 * @param {string} errorCode - i18n error code
 * @param {Object} [params] - Optional params for i18n
 * @returns {Error} Conflict error
 */
function conflictError(errorCode, params = undefined) {
  return createError(errorCode, 409, params);
}

module.exports = {
  asyncHandler,
  errorHandler,
  formatErrorResponse,
  logError,
  createError,
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
};
