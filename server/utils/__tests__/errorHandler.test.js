/**
 * Unit tests for errorHandler utilities
 * Covers formatErrorResponse, logError, errorHandler, createError,
 * validation/unauthorized/forbidden/notFound/conflict errors, and asyncHandler
 * to improve branch coverage (NODE_ENV, status/message defaults, optional chaining, etc.)
 */

const {
  formatErrorResponse,
  logError,
  errorHandler,
  createError,
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
  asyncHandler,
} = require('../errorHandler');

describe('errorHandler utilities', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('formatErrorResponse', () => {
    it('uses default options when options omitted', () => {
      const err = new Error('fail');
      err.status = 404;
      const res = formatErrorResponse(err);
      expect(res.error).toBe('fail');
      expect(res.details).toBeDefined();
    });

    it('uses defaultMessage from options when provided', () => {
      const err = { statusCode: 500 };
      const res = formatErrorResponse(err, { defaultMessage: 'Custom default' });
      expect(res.error).toBe('Custom default');
    });

    it('uses defaultStatus from options when provided', () => {
      const err = new Error('msg');
      const res = formatErrorResponse(err, { defaultStatus: 503 });
      expect(res.error).toBe('msg');
    });

    it('prefers error.status over error.statusCode and defaultStatus', () => {
      const err = new Error('x');
      err.status = 400;
      err.statusCode = 500;
      const res = formatErrorResponse(err, { defaultStatus: 503 });
      expect(res.error).toBe('x');
    });

    it('uses error.statusCode when error.status is absent', () => {
      const err = new Error('y');
      err.statusCode = 403;
      const res = formatErrorResponse(err, { defaultStatus: 500 });
      expect(res.error).toBe('y');
    });

    it('uses defaultStatus when error has neither status nor statusCode', () => {
      const err = new Error('z');
      const res = formatErrorResponse(err, { defaultStatus: 502 });
      expect(res.error).toBe('z');
    });

    it('uses error.message when present', () => {
      const err = new Error('my message');
      const res = formatErrorResponse(err);
      expect(res.error).toBe('my message');
    });

    it('uses defaultMessage when error.message is absent', () => {
      const err = { status: 500 };
      const res = formatErrorResponse(err, { defaultMessage: 'Fallback message' });
      expect(res.error).toBe('Fallback message');
    });

    it('includes details when NODE_ENV is not production and error has stack', () => {
      const err = new Error('dev error');
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      const res = formatErrorResponse(err);
      expect(res.details).toBe(err.stack);
      process.env.NODE_ENV = prev;
    });

    it('excludes details when NODE_ENV is production', () => {
      const err = new Error('prod error');
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const res = formatErrorResponse(err);
      expect(res.details).toBeUndefined();
      expect(res.error).toBe('prod error');
      process.env.NODE_ENV = prev;
    });

    it('excludes details when NODE_ENV is not production but error has no stack', () => {
      const err = { message: 'no stack', status: 500 };
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const res = formatErrorResponse(err);
      expect(res.details).toBeUndefined();
      expect(res.error).toBe('no stack');
      process.env.NODE_ENV = prev;
    });

    it('omits details key when details is undefined (details && { details } false branch)', () => {
      const err = { message: 'x', status: 400 };
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const res = formatErrorResponse(err);
      expect(res).toEqual({ error: 'x' });
      expect(res).not.toHaveProperty('details');
      process.env.NODE_ENV = prev;
    });
  });

  describe('logError', () => {
    it('logs error with context when context provided', () => {
      const err = new Error('logged');
      logError(err, { method: 'GET', path: '/api' });
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Error]', expect.any(String));
      const logged = consoleErrorSpy.mock.calls[0][1];
      expect(logged).toContain('method');
      expect(logged).toContain('GET');
      expect(logged).toContain('path');
      expect(logged).toContain('/api');
    });

    it('logs error with default empty context when context omitted', () => {
      const err = new Error('no context');
      logError(err);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Error]', expect.any(String));
    });
  });

  describe('errorHandler', () => {
    it('sends error response and includes user id in log context when req.user exists', () => {
      const err = createError('Bad request', 400);
      const req = {
        method: 'POST',
        path: '/api/foo',
        query: {},
        body: {},
        user: { id: 42 },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Bad request' }));
      const logged = consoleErrorSpy.mock.calls[0][1];
      expect(logged).toContain('user');
      expect(logged).toContain('42');
    });

    it('sends error response when req.user is undefined (optional chaining branch)', () => {
      const err = createError('Unauthorized', 401);
      const req = {
        method: 'GET',
        path: '/api/me',
        query: {},
        body: {},
        user: undefined,
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Error]', expect.any(String));
    });

    it('uses err.statusCode when err.status is absent', () => {
      const err = new Error('Server error');
      err.statusCode = 503;
      const req = { method: 'GET', path: '/', query: {}, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('uses 500 when err has neither status nor statusCode', () => {
      const err = new Error('Unknown');
      const req = { method: 'GET', path: '/', query: {}, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('createError', () => {
    it('creates error with message and status', () => {
      const err = createError('Not found', 404);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Not found');
      expect(err.status).toBe(404);
    });

    it('uses default status 500 when status omitted', () => {
      const err = createError('Internal');
      expect(err.message).toBe('Internal');
      expect(err.status).toBe(500);
    });
  });

  describe('validationError', () => {
    it('returns 400 error with given message', () => {
      const err = validationError('Invalid input');
      expect(err.status).toBe(400);
      expect(err.message).toBe('Invalid input');
    });
  });

  describe('unauthorizedError', () => {
    it('returns 401 error with given message', () => {
      const err = unauthorizedError('Token expired');
      expect(err.status).toBe(401);
      expect(err.message).toBe('Token expired');
    });

    it('returns 401 error with default message when message omitted', () => {
      const err = unauthorizedError();
      expect(err.status).toBe(401);
      expect(err.message).toBe('Unauthorized');
    });
  });

  describe('forbiddenError', () => {
    it('returns 403 error with given message', () => {
      const err = forbiddenError('Access denied');
      expect(err.status).toBe(403);
      expect(err.message).toBe('Access denied');
    });

    it('returns 403 error with default message when message omitted', () => {
      const err = forbiddenError();
      expect(err.status).toBe(403);
      expect(err.message).toBe('Forbidden');
    });
  });

  describe('notFoundError', () => {
    it('returns 404 error with given message', () => {
      const err = notFoundError('User not found');
      expect(err.status).toBe(404);
      expect(err.message).toBe('User not found');
    });

    it('returns 404 error with default message when message omitted', () => {
      const err = notFoundError();
      expect(err.status).toBe(404);
      expect(err.message).toBe('Not found');
    });
  });

  describe('conflictError', () => {
    it('returns 409 error with given message', () => {
      const err = conflictError('Resource exists');
      expect(err.status).toBe(409);
      expect(err.message).toBe('Resource exists');
    });

    it('returns 409 error with default message when message omitted', () => {
      const err = conflictError();
      expect(err.status).toBe(409);
      expect(err.message).toBe('Conflict');
    });
  });

  describe('asyncHandler', () => {
    it('calls next with no args when handler resolves', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        res.send('ok');
      });
      const req = {};
      const res = { send: jest.fn() };
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.send).toHaveBeenCalledWith('ok');
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with error when handler rejects', async () => {
      const handler = asyncHandler(async () => {
        throw new Error('async fail');
      });
      const req = {};
      const res = {};
      const next = jest.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('async fail');
    });
  });
});
