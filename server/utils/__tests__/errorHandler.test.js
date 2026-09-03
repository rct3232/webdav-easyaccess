/**
 * Server errorHandler tests: asyncHandler, formatErrorResponse, createError family,
 * errorHandler middleware. details exposed only in development.
 * @see docs/spec/server/utils/errorHandler.md
 * @see docs/shared-contracts.md
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  asyncHandler,
  formatErrorResponse,
  logError,
  createError,
  mapDatabaseError,
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
  errorHandler,
} = require('../errorHandler');

jest.mock('../../store/storage', () => ({
  getBackend: jest.fn(() => 'postgresql'),
}));
jest.mock('../../infrastructure/backendHealth', () => {
  const { createBackendHealth } = jest.requireActual('../../infrastructure/backendHealth');
  const tracker = createBackendHealth();
  return { getBackendHealth: () => tracker };
});
jest.mock('../../infrastructure/backendProbe', () => ({
  toShortReason: jest.fn((value) => (value == null ? undefined : String(value))),
}));

describe('errorHandler', () => {
  describe('asyncHandler', () => {
    it('invokes handler and calls next on success', async () => {
      const req = {};
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      const next = jest.fn();
      const handler = asyncHandler(async (r, resp) => {
        resp.json({ ok: true });
      });
      await handler(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with error when handler throws', async () => {
      const req = {};
      const res = {};
      const next = jest.fn();
      const err = new Error('handler failed');
      const handler = asyncHandler(async () => {
        throw err;
      });
      await handler(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('calls next with rejection when handler rejects', async () => {
      const req = {};
      const res = {};
      const next = jest.fn();
      const err = new Error('rejected');
      const handler = asyncHandler(async () => {
        return Promise.reject(err);
      });
      handler(req, res, next);
      await new Promise((resolve) => setImmediate(resolve));
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('formatErrorResponse', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('returns errorCode and params when error has errorCode', () => {
      const err = createError(SERVER_ERROR_CODES.auth.userNotFound, 404, { id: 1 });
      process.env.NODE_ENV = 'production';
      const result = formatErrorResponse(err);
      expect(result).toMatchObject({
        errorCode: SERVER_ERROR_CODES.auth.userNotFound,
        params: { id: 1 },
      });
      expect(result.details).toBeUndefined();
    });

    it('excludes empty params', () => {
      const err = createError(SERVER_ERROR_CODES.auth.userNotFound, 404);
      const result = formatErrorResponse(err);
      expect(result).toHaveProperty('errorCode', SERVER_ERROR_CODES.auth.userNotFound);
      expect(result.params).toBeUndefined();
    });

    it('uses default errorCode when error has no errorCode', () => {
      const err = new Error('something broke');
      const result = formatErrorResponse(err);
      expect(result).toMatchObject({
        errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError,
        params: { reason: 'something broke' },
      });
    });

    it('excludes params when error has no message', () => {
      const err = new Error();
      const result = formatErrorResponse(err);
      expect(result).toHaveProperty(
        'errorCode',
        SERVER_ERROR_CODES.errorHandler.internalServerError
      );
      expect(result.params).toBeUndefined();
    });

    it('includes details (stack) only in development', () => {
      const err = new Error('dev error');
      err.stack = 'Error: dev error\n  at foo';
      process.env.NODE_ENV = 'development';
      const result = formatErrorResponse(err);
      expect(result.details).toBe('Error: dev error\n  at foo');
    });

    it('excludes details in production', () => {
      const err = new Error('prod error');
      err.stack = 'Error: prod error';
      process.env.NODE_ENV = 'production';
      const result = formatErrorResponse(err);
      expect(result.details).toBeUndefined();
    });

    it('uses err.status over defaultStatus', () => {
      const err = createError('some.code', 403);
      const result = formatErrorResponse(err, { defaultStatus: 500 });
      expect(result).toBeDefined();
    });

    it('respects custom defaultErrorCode and defaultStatus options', () => {
      const err = new Error('generic');
      const result = formatErrorResponse(err, {
        defaultErrorCode: 'custom.code',
        defaultStatus: 503,
      });
      expect(result.errorCode).toBe('custom.code');
    });
  });

  describe('logError', () => {
    it('logs without throwing', () => {
      const err = new Error('test');
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => logError(err, { method: 'GET' })).not.toThrow();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('createError', () => {
    it('returns Error with status, errorCode, params', () => {
      const err = createError(SERVER_ERROR_CODES.auth.userNotFound, 404, { id: 42 });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(SERVER_ERROR_CODES.auth.userNotFound);
      expect(err.status).toBe(404);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.auth.userNotFound);
      expect(err.params).toEqual({ id: 42 });
    });

    it('omits params when params is empty object', () => {
      const err = createError('some.code', 400, {});
      expect(err.params).toBeUndefined();
    });

    it('omits params when params is undefined', () => {
      const err = createError('some.code', 400);
      expect(err.params).toBeUndefined();
    });

    it('defaults status to 500', () => {
      const err = createError('some.code');
      expect(err.status).toBe(500);
    });
  });

  describe('mapDatabaseError', () => {
    it('returns original app error when status and errorCode exist', () => {
      const original = createError('custom.error', 418);
      expect(mapDatabaseError(original)).toBe(original);
    });

    it('maps unique violation (23505) to conflict', () => {
      const mapped = mapDatabaseError({ code: '23505', constraint: 'users_email_key' });
      expect(mapped.status).toBe(HTTP_STATUS.CONFLICT);
      expect(mapped.errorCode).toBe(SERVER_ERROR_CODES.errorHandler.databaseConflict);
      expect(mapped.params).toEqual({ constraint: 'users_email_key' });
    });

    it('maps FK/check/input violations to bad request', () => {
      const fk = mapDatabaseError({ code: '23503', constraint: 'fk_user_id' });
      expect(fk.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(fk.errorCode).toBe(SERVER_ERROR_CODES.errorHandler.databaseConstraintViolation);
      expect(fk.params).toEqual({ constraint: 'fk_user_id' });

      const check = mapDatabaseError({ code: '23514' });
      expect(check.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(check.errorCode).toBe(SERVER_ERROR_CODES.errorHandler.databaseConstraintViolation);

      const invalidText = mapDatabaseError({ code: '22P02' });
      expect(invalidText.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(invalidText.errorCode).toBe(
        SERVER_ERROR_CODES.errorHandler.databaseConstraintViolation
      );
    });

    it('maps DB unavailable errors to service unavailable', () => {
      const mapped = mapDatabaseError({ code: '57P01' });
      expect(mapped.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
      expect(mapped.errorCode).toBe(SERVER_ERROR_CODES.errorHandler.databaseUnavailable);
    });

    it('reports postgresql unreachable in the backend health snapshot when backend is postgresql', () => {
      const tracker = require('../../infrastructure/backendHealth').getBackendHealth();
      tracker.reset();
      mapDatabaseError({ code: '53300', message: 'sorry, too many clients already' });
      const pg = tracker.getHealth().postgresql;
      expect(pg.status).toBe('fail');
      expect(pg.code).toBe('unreachable');
      expect(pg.reason).toBe('sorry, too many clients already');
    });

    it('leaves the backend health snapshot untouched for non-connection error codes', () => {
      const tracker = require('../../infrastructure/backendHealth').getBackendHealth();
      tracker.reset();
      mapDatabaseError({ code: '23505', constraint: 'users_email_key' });
      mapDatabaseError({ code: '23503', constraint: 'fk_user_id' });
      mapDatabaseError({ code: 'XX000' });
      expect(tracker.getHealth().postgresql.status).toBe('unknown');
    });

    it('uses fallback error code for unknown DB errors', () => {
      const mapped = mapDatabaseError({ code: 'XX000' }, { fallbackErrorCode: 'db.fallback' });
      expect(mapped.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(mapped.errorCode).toBe('db.fallback');
    });
  });

  describe('validationError', () => {
    it('returns 400 error', () => {
      const err = validationError(SERVER_ERROR_CODES.folders.pathRequired);
      expect(err.status).toBe(400);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.folders.pathRequired);
    });
  });

  describe('unauthorizedError', () => {
    it('returns 401 with default errorCode', () => {
      const err = unauthorizedError();
      expect(err.status).toBe(401);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken);
    });

    it('accepts custom errorCode and params', () => {
      const err = unauthorizedError('custom.code', { reason: 'expired' });
      expect(err.status).toBe(401);
      expect(err.errorCode).toBe('custom.code');
      expect(err.params).toEqual({ reason: 'expired' });
    });
  });

  describe('forbiddenError', () => {
    it('returns 403 with default errorCode', () => {
      const err = forbiddenError();
      expect(err.status).toBe(403);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    });
  });

  describe('notFoundError', () => {
    it('returns 404', () => {
      const err = notFoundError(SERVER_ERROR_CODES.share.shareLinkNotFound);
      expect(err.status).toBe(404);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkNotFound);
    });
  });

  describe('conflictError', () => {
    it('returns 409', () => {
      const err = conflictError(SERVER_ERROR_CODES.auth.emailTaken);
      expect(err.status).toBe(409);
      expect(err.errorCode).toBe(SERVER_ERROR_CODES.auth.emailTaken);
    });
  });

  describe('errorHandler middleware', () => {
    it('logs error, formats response, and sends JSON with correct status', () => {
      const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const req = { method: 'GET', path: '/api/users', query: {}, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      const err = createError(SERVER_ERROR_CODES.auth.userNotFound, 404, { id: 1 });
      errorHandler(err, req, res, next);

      expect(logSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: SERVER_ERROR_CODES.auth.userNotFound,
          params: { id: 1 },
        })
      );
      logSpy.mockRestore();
    });

    it('uses INTERNAL_SERVER_ERROR when err has no status', () => {
      const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const req = { method: 'GET', path: '/', query: {}, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      const err = new Error('unexpected');
      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      logSpy.mockRestore();
    });
  });
});
