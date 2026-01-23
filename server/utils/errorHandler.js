/**
 * Centralized error handling utilities for Express routes
 * Provides asyncHandler wrapper and error handler middleware
 */

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
 * Standard error response format
 * @param {Error} error - Error object
 * @param {Object} options - Additional options
 * @param {string} options.defaultMessage - Default error message
 * @param {number} options.defaultStatus - Default HTTP status code
 * @returns {Object} Standardized error response
 * @property {string} error - Error message
 * @property {string} [details] - Error details (development only)
 */
function formatErrorResponse(error, options = {}) {
  const {
    defaultMessage = 'An error occurred',
    defaultStatus = 500,
  } = options;

  const status = error.status || error.statusCode || defaultStatus;
  const message = error.message || defaultMessage;

  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const details = isDevelopment && error.stack ? error.stack : undefined;

  return {
    error: message,
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
    defaultMessage: 'Internal server error',
    defaultStatus: 500,
  });

  // Determine status code
  const status = err.status || err.statusCode || 500;

  // Send error response
  res.status(status).json(response);
}

/**
 * Create a custom error with status code
 * @param {string} message - Error message
 * @param {number} status - HTTP status code (default: 500)
 * @returns {Error} Error object with status property
 * @example
 * throw createError('User not found', 404);
 */
function createError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Validation error (400)
 * @param {string} message - Error message
 * @returns {Error} Validation error
 */
function validationError(message) {
  return createError(message, 400);
}

/**
 * Unauthorized error (401)
 * @param {string} message - Error message
 * @returns {Error} Unauthorized error
 */
function unauthorizedError(message = 'Unauthorized') {
  return createError(message, 401);
}

/**
 * Forbidden error (403)
 * @param {string} message - Error message
 * @returns {Error} Forbidden error
 */
function forbiddenError(message = 'Forbidden') {
  return createError(message, 403);
}

/**
 * Not found error (404)
 * @param {string} message - Error message
 * @returns {Error} Not found error
 */
function notFoundError(message = 'Not found') {
  return createError(message, 404);
}

/**
 * Conflict error (409)
 * @param {string} message - Error message
 * @returns {Error} Conflict error
 */
function conflictError(message = 'Conflict') {
  return createError(message, 409);
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
