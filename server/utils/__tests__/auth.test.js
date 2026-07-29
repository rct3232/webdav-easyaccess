/**
 * Server auth tests: JWT generateToken, verifyToken, authenticateToken middleware.
 * @see docs/spec/server/routes/auth.md
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  generateToken,
  verifyToken,
  authenticateToken,
} = require('../auth');

describe('auth', () => {
  describe('generateToken', () => {
    it('returns a JWT string for a user', () => {
      const user = { id: 1, username: 'alice', token_version: 0, is_admin: 0 };
      const token = generateToken(user);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('works with minimal user (id, username)', () => {
      const user = { id: 2, username: 'bob' };
      const token = generateToken(user);
      expect(typeof token).toBe('string');
      const decoded = verifyToken(token);
      expect(decoded).toMatchObject({ id: 2, username: 'bob' });
      expect(decoded.token_version).toBe(0);
      expect(decoded.is_admin).toBe(0);
    });

    it('includes token_version and is_admin in payload', () => {
      const user = { id: 3, username: 'admin', token_version: 5, is_admin: 1 };
      const token = generateToken(user);
      const decoded = verifyToken(token);
      expect(decoded.token_version).toBe(5);
      expect(decoded.is_admin).toBe(1);
    });
  });

  describe('verifyToken', () => {
    it('returns decoded payload for valid token', () => {
      const user = { id: 1, username: 'alice', token_version: 0, is_admin: 0 };
      const token = generateToken(user);
      const decoded = verifyToken(token);
      expect(decoded).toMatchObject({
        id: 1,
        username: 'alice',
        token_version: 0,
        is_admin: 0,
      });
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('returns null for invalid token', () => {
      expect(verifyToken('invalid')).toBeNull();
      expect(verifyToken('not.a.token')).toBeNull();
    });

    it('returns null for malformed token', () => {
      expect(verifyToken('')).toBeNull();
    });
  });

  describe('authenticateToken', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const req = { headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.utilsAuth.accessTokenRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization has no Bearer token', async () => {
      const req = { headers: { authorization: 'Bearer' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.utilsAuth.accessTokenRequired,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when token is invalid or expired', async () => {
      const req = { headers: { authorization: 'Bearer invalid-token' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
      expect(res.json).toHaveBeenCalledWith({
        errorCode: SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next and sets req.user when token is valid', async () => {
      const user = { id: 1, username: 'alice', token_version: 0, is_admin: 0 };
      const token = generateToken(user);
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({
        id: 1,
        username: 'alice',
        token_version: 0,
        is_admin: 0,
      });
      expect(req.user.full).toEqual({
        id: 1,
        username: 'alice',
        is_admin: 0,
      });
    });
  });
});
