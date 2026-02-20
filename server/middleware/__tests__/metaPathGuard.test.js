/**
 * metaPathGuard middleware tests.
 * @see docs/spec/server/middleware/metaPathGuard.md
 */
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { checkMetaPathAccess, checkMetaPath } = require('../metaPathGuard');

describe('metaPathGuard', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { query: {}, body: {}, params: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  describe('checkMetaPathAccess', () => {
    it('calls next() when path is not meta path', () => {
      req.query.path = '/docs/file.txt';
      req.user = { full: { is_admin: 0 } };

      expect(() => checkMetaPathAccess(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });

    it('calls next() when user is admin and path is meta', () => {
      req.query.path = '/.wea/settings.json';
      req.user = { full: { is_admin: 1 } };

      expect(() => checkMetaPathAccess(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });

    it('throws 403 when meta path and non-admin', () => {
      req.query.path = '/.wea/settings.json';
      req.user = { full: { is_admin: 0 } };

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('throws 403 when meta path in req.body.path and non-admin', () => {
      req.body.path = '/.wea/users/1.json';
      req.user = {};

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });

    it('throws 403 when meta path in req.body.sourcePath and non-admin', () => {
      req.body.sourcePath = '/.wea/permissions';
      req.user = { full: { is_admin: 0 } };

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });

    it('throws 403 when meta path in req.body.destinationPath and non-admin', () => {
      req.body.destinationPath = '/.wea/locks';
      req.user = { full: { is_admin: 0 } };

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });

    it('calls next() when share context and path under root (no meta)', () => {
      req.shareContext = { rootPath: '/shared/docs', isDirectory: true };
      req.query.path = '/shared/docs/file.txt';

      expect(() => checkMetaPathAccess(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });

    it('throws 403 when share context and path is meta', () => {
      req.shareContext = { rootPath: '/shared/docs', isDirectory: true };
      req.query.path = '/.wea/settings.json';

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });

    it('throws 403 when share context and path outside share root', () => {
      req.shareContext = { rootPath: '/shared/docs', isDirectory: true };
      req.query.path = '/other/folder';

      expect(() => checkMetaPathAccess(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });
  });

  describe('checkMetaPath factory', () => {
    it('calls next() when extracted path is not meta', () => {
      const middleware = checkMetaPath((r) => r.query.path);
      req.query.path = '/normal/path';
      req.user = { is_admin: 0 };

      expect(() => middleware(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });

    it('throws 403 when extracted path is meta and non-admin', () => {
      const middleware = checkMetaPath((r) => r.body.customPath);
      req.body.customPath = '/.wea/users';
      req.user = { is_admin: 0 };

      expect(() => middleware(req, res, next)).toThrow(
        expect.objectContaining({
          status: 403,
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        })
      );
    });

    it('calls next() when extracted path is meta and admin', () => {
      const middleware = checkMetaPath((r) => r.query.path);
      req.query.path = '/.wea/settings.json';
      req.user = { full: { is_admin: 1 } };

      expect(() => middleware(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });
  });
});
