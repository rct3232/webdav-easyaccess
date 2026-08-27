/**
 * permissions middleware tests — nodeId-based migration.
 * Verifies requirePermission, requireFolderPermission with nodeId extraction.
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

jest.mock('../../domains/permissions/services/aclService', () => {
  const actual = jest.requireActual(
        '../../domains/permissions/services/aclService'
  );
  return {
    ...actual,
    checkFilePermission: jest.fn(),
    checkFolderPermission: jest.fn(),
    getCachedUser: jest.fn(),
    isAdminUser: jest.fn(),
  };
});

const aclService = require('../../domains/permissions/services/aclService');
const { requirePermission, requireFolderPermission } = require('../permissions');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('permissions middleware (nodeId)', () => {
  let req, res, next;

  beforeEach(() => {
    req = { query: {}, body: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    jest.clearAllMocks();
    aclService.checkFilePermission.mockResolvedValue(false);
    aclService.checkFolderPermission.mockResolvedValue(false);
    aclService.getCachedUser.mockResolvedValue({ id: 1, is_admin: false });
    aclService.isAdminUser.mockReturnValue(false);
  });

  describe('requirePermission (file)', () => {
    // V1: requirePermission with valid nodeId — request proceeds
    it('calls next() when user has permission on nodeId', async () => {
      req.principalId = 1;
      req.query.nodeId = '42';
      aclService.checkFilePermission.mockResolvedValue(true);

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    // V2: requirePermission with unauthorized nodeId — returns 403
    it('returns 403 when user lacks permission on nodeId', async () => {
      req.principalId = 1;
      req.query.nodeId = '42';
      aclService.checkFilePermission.mockResolvedValue(false);

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
      });
      expect(next).not.toHaveBeenCalled();
    });

    // V3: requirePermission with missing nodeId — returns 400
    it('returns 400 when nodeId is missing', async () => {
      req.principalId = 1;

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(next).not.toHaveBeenCalled();
    });

    // V4: Admin user bypasses all checks
    it('bypasses permission check for admin users', async () => {
      req.principalId = 1;
      req.query.nodeId = '99';
      aclService.getCachedUser.mockResolvedValue({ id: 1, is_admin: true });
      aclService.isAdminUser.mockReturnValue(true);

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    });

    // V5: Owner accesses own node via ancestry check (permission granted)
    it('allows access when ownership grants permission', async () => {
      req.principalId = 1;
      req.query.nodeId = '10';
      aclService.checkFilePermission.mockResolvedValue(true);

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when no principal', async () => {
      req.query.nodeId = '42';

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired,
      });
    });

    it('falls back to req.body.nodeId when query is empty', async () => {
      req.principalId = 1;
      req.body.nodeId = '50';
      aclService.checkFilePermission.mockResolvedValue(true);

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('accepts custom nodeIdExtractor', async () => {
      req.principalId = 1;
      req.body.customNodeId = '75';
      aclService.checkFilePermission.mockResolvedValue(true);

      const mw = requirePermission(
        PERMISSIONS.READ,
        (r) => r.body.customNodeId
      );
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 500 on internal error', async () => {
      req.principalId = 1;
      req.query.nodeId = '42';
      aclService.getCachedUser.mockRejectedValue(new Error('db down'));

      const mw = requirePermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });
  });

  describe('requireFolderPermission', () => {
    it('calls next() when user has folder permission on nodeId', async () => {
      req.principalId = 1;
      req.query.nodeId = '20';
      aclService.checkFolderPermission.mockResolvedValue(true);

      const mw = requireFolderPermission(PERMISSIONS.WRITE);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when user lacks folder permission', async () => {
      req.principalId = 1;
      req.query.nodeId = '20';

      const mw = requireFolderPermission(PERMISSIONS.WRITE);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when nodeId is missing', async () => {
      req.principalId = 1;

      const mw = requireFolderPermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(next).not.toHaveBeenCalled();
    });

    it('bypasses check for admin users', async () => {
      req.principalId = 1;
      req.query.nodeId = '20';
      aclService.getCachedUser.mockResolvedValue({ id: 1, is_admin: true });
      aclService.isAdminUser.mockReturnValue(true);

      const mw = requireFolderPermission(PERMISSIONS.READ);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(aclService.checkFolderPermission).not.toHaveBeenCalled();
    });
  });
});
