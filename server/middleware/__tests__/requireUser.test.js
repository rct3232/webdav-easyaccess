/**
 * requireUser middleware tests.
 * @see docs/spec/server/middleware/requireUser.md
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const requireUserModule = require('../requireUser');

const User = require('../../models/User');

jest.mock('../../models/User');

describe('requireUser', () => {
  const requireUser = requireUserModule;
  const { requireAuth } = requireUserModule;

  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {};
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  describe('requireUser (default export)', () => {
    it('calls next() when user loaded successfully', async () => {
      const fullUser = { id: 1, username: 'alice', email: 'a@x.com', is_admin: 0 };
      req.user = { id: 1 };
      User.findById.mockResolvedValue(fullUser);

      await requireUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.full).toEqual(fullUser);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() when req.user.full is already set', async () => {
      const fullUser = { id: 1, username: 'alice' };
      req.user = { id: 1, full: fullUser };
      User.findById.mockResolvedValue(fullUser);

      await requireUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(User.findById).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when no req.user', async () => {
      req.user = undefined;

      await requireUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.requireUser.authenticationRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when req.user has no id', async () => {
      req.user = { full: null };

      await requireUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.requireUser.authenticationRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with error when User.findById throws (DB/store exception)', async () => {
      req.user = { id: 999 };
      const dbError = new Error('Store connection failed');
      User.findById.mockRejectedValue(dbError);

      await requireUser(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next with notFoundError when User.findById returns null', async () => {
      req.user = { id: 999 };
      User.findById.mockResolvedValue(null);

      await requireUser(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 404,
          errorCode: SERVER_ERROR_CODES.auth.userNotFound,
        })
      );
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('requireAuth', () => {
    it('calls next() and sets req.principalId when JWT user loaded', async () => {
      const fullUser = { id: 1, username: 'alice' };
      req.user = { id: 1 };
      User.findById.mockResolvedValue(fullUser);

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.principalId).toBe(1);
      expect(req.user.full).toEqual(fullUser);
    });

    it('calls next() when req.principalId already set (share token)', async () => {
      req.principalId = 'share:abc123';
      req.user = undefined; // share token context typically has no req.user

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(User.findById).not.toHaveBeenCalled();
    });

    it('returns 401 when no principalId and no req.user.id', async () => {
      req.user = undefined;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.requireUser.authenticationRequired,
      });
    });

    it('calls next with error when User.findById returns null', async () => {
      req.user = { id: 999 };
      User.findById.mockResolvedValue(null);

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 404,
          errorCode: SERVER_ERROR_CODES.auth.userNotFound,
        })
      );
    });
  });
});
