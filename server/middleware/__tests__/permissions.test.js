/**
 * permissions middleware tests.
 * Verifies requirePermission, requireFolderPermission: admin/owner bypass, 400, 401, 403.
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  requirePermission,
  requireFolderPermission,
} = require('../permissions');
const {
  createTestDatabase,
  grantTestPermission,
  createAuthenticatedTestUser,
  PERMISSIONS,
} = require('../../test-utils');

describe('permissions middleware', () => {
  let req;
  let res;
  let next;
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  beforeEach(() => {
    req = { query: {}, body: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  describe('requirePermission (file)', () => {
    it('returns 400 when path is missing', async () => {
      req.user = { id: 1 };
      req.principalId = 1;
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when principalId and user.id are missing', async () => {
      req.query.path = '/docs/file.txt';
      req.user = undefined;
      req.principalId = undefined;
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('uses req.principalId when set', async () => {
      const { user } = await createAuthenticatedTestUser({ isAdmin: true });
      req.principalId = user.id;
      req.query.path = '/docs/file.txt';
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() when admin user (admin bypass)', async () => {
      const { user } = await createAuthenticatedTestUser({ isAdmin: true });
      req.user = { id: user.id };
      req.principalId = user.id;
      req.query.path = '/some/path/file.txt';
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when user has no permission', async () => {
      const { user } = await createAuthenticatedTestUser(); // non-admin, no extra perms
      req.user = { id: user.id };
      req.principalId = user.id;
      // Path outside user's home and without granted permission
      req.query.path = '/other-user/folder/file.txt';
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when user has folder permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      await grantTestPermission(user.id, '/shared', PERMISSIONS.READ);
      req.user = { id: user.id };
      req.principalId = user.id;
      req.query.path = '/shared/file.txt'; // parent /shared has permission
      const mw = requirePermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('uses custom pathExtractor from body', async () => {
      const { user } = await createAuthenticatedTestUser({ grantRoot: true });
      req.user = { id: user.id };
      req.principalId = user.id;
      req.body.customPath = '/docs';
      const mw = requirePermission(PERMISSIONS.READ, (r) => r.body.customPath);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireFolderPermission', () => {
    it('returns 400 when path is missing', async () => {
      req.user = { id: 1 };
      const mw = requireFolderPermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when no principalId', async () => {
      req.query.path = '/docs';
      req.user = undefined;
      req.principalId = undefined;
      const mw = requireFolderPermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired,
      });
    });

    it('calls next() when admin user', async () => {
      const { user } = await createAuthenticatedTestUser({ isAdmin: true });
      req.user = { id: user.id };
      req.principalId = user.id;
      req.query.path = '/any/folder';
      const mw = requireFolderPermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when user has no folder permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      req.user = { id: user.id };
      req.principalId = user.id;
      req.query.path = '/other-user/private';
      const mw = requireFolderPermission(PERMISSIONS.READ);

      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
      });
    });

    it('calls next() when user has folder permission', async () => {
      const { user } = await createAuthenticatedTestUser();
      await grantTestPermission(user.id, '/shared', PERMISSIONS.WRITE);
      req.user = { id: user.id };
      req.principalId = user.id;
      req.query.path = '/shared';
      const mw = requireFolderPermission(PERMISSIONS.WRITE);

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
