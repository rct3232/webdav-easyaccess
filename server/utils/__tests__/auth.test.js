/**
 * Unit tests for auth utilities
 * Tests JWT token generation, verification, and authentication middleware
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const userStore = require('../../store/userStore');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

describe('auth utilities', () => {
  let generateToken;
  let verifyToken;
  let authenticateToken;
  let mockUser;

  beforeAll(async () => {
    // Load with default test env (see server/test-setup.js)
    ({ generateToken, verifyToken, authenticateToken } = require('../auth'));

    // Create a real user so authenticateToken can validate token_version.
    const username = `authutil_${Math.random().toString(36).slice(2, 10)}`;
    const created = await userStore.createUser({
      username,
      email: `${username}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 10),
      isAdmin: false,
    });
    mockUser = {
      id: created.id,
      username: created.username,
      token_version: created.token_version,
    };
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(mockUser);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('should include user id and username in token payload', () => {
      const token = generateToken(mockUser);
      const decoded = jwt.verify(token, JWT_SECRET);
      
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.username).toBe(mockUser.username);
    });

    it('should set expiration time', () => {
      const token = generateToken(mockUser);
      const decoded = jwt.verify(token, JWT_SECRET);
      
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
      
      // Default token expiry should be approximately 30 minutes (1800 seconds)
      const expirationTime = decoded.exp - decoded.iat;
      expect(expirationTime).toBeCloseTo(1800, -1);
    });

    it('should respect JWT_EXPIRES_IN env var', () => {
      const prev = process.env.JWT_EXPIRES_IN;
      process.env.JWT_EXPIRES_IN = '10m';
      jest.resetModules();
      const { generateToken: generateTokenWithEnv } = require('../auth');

      const token = generateTokenWithEnv(mockUser);
      const decoded = jwt.verify(token, JWT_SECRET);
      const expirationTime = decoded.exp - decoded.iat;
      expect(expirationTime).toBeCloseTo(600, -1);

      // restore
      if (prev === undefined) delete process.env.JWT_EXPIRES_IN;
      else process.env.JWT_EXPIRES_IN = prev;
      jest.resetModules();
    });

    it('should generate different tokens for different users', () => {
      const user1 = { id: 1, username: 'user1' };
      const user2 = { id: 2, username: 'user2' };
      
      const token1 = generateToken(user1);
      const token2 = generateToken(user2);
      
      expect(token1).not.toBe(token2);
    });

    it('should handle user with additional properties', () => {
      const userWithExtra = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: true
      };
      
      const token = generateToken(userWithExtra);
      const decoded = jwt.verify(token, JWT_SECRET);
      
      expect(decoded.id).toBe(userWithExtra.id);
      expect(decoded.username).toBe(userWithExtra.username);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', () => {
      const token = generateToken(mockUser);
      const decoded = verifyToken(token);
      
      expect(decoded).toBeDefined();
      expect(decoded).not.toBeNull();
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.username).toBe(mockUser.username);
    });

    it('should return null for invalid token', () => {
      const invalidToken = 'invalid.token.string';
      const decoded = verifyToken(invalidToken);
      
      expect(decoded).toBeNull();
    });

    it('should return null for malformed token', () => {
      const malformedToken = 'not-a-jwt-token';
      const decoded = verifyToken(malformedToken);
      
      expect(decoded).toBeNull();
    });

    it('should return null for expired token', () => {
      // Create token with very short expiration
      const expiredToken = jwt.sign(
        { id: mockUser.id, username: mockUser.username },
        JWT_SECRET,
        { expiresIn: '0s' } // Expired immediately
      );
      
      // Wait a bit to ensure expiration
      return new Promise((resolve) => {
        setTimeout(() => {
          const decoded = verifyToken(expiredToken);
          expect(decoded).toBeNull();
          resolve();
        }, 100);
      });
    });

    it('should return null for token signed with wrong secret', () => {
      const wrongSecretToken = jwt.sign(
        { id: mockUser.id, username: mockUser.username },
        'wrong-secret-key',
        { expiresIn: '7d' }
      );
      
      const decoded = verifyToken(wrongSecretToken);
      expect(decoded).toBeNull();
    });

    it('should return null for empty token', () => {
      expect(verifyToken('')).toBeNull();
      expect(verifyToken(null)).toBeNull();
      expect(verifyToken(undefined)).toBeNull();
    });
  });

  describe('authenticateToken middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {
        headers: {}
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      mockNext = jest.fn();
    });

    it('should authenticate with valid token', () => {
      const token = generateToken(mockUser);
      mockReq.headers['authorization'] = `Bearer ${token}`;
      
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockReq.user).toBeDefined();
        expect(mockReq.user.id).toBe(mockUser.id);
        expect(mockReq.user.username).toBe(mockUser.username);
        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });
      
    });

    it('should reject request without token', () => {
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
        expect(mockNext).not.toHaveBeenCalled();
      });
      
    });

    it('should reject request with invalid token', () => {
      mockReq.headers['authorization'] = 'Bearer invalid.token.string';
      
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
        expect(mockNext).not.toHaveBeenCalled();
      });
      
    });

    it('should reject request with malformed authorization header', () => {
      mockReq.headers['authorization'] = 'InvalidFormat';
      
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
        expect(mockNext).not.toHaveBeenCalled();
      });
      
    });

    it('should reject request with expired token', () => {
      const expiredToken = jwt.sign(
        { id: mockUser.id, username: mockUser.username },
        JWT_SECRET,
        { expiresIn: '0s' }
      );
      
      return new Promise((resolve) => {
        setTimeout(() => {
          mockReq.headers['authorization'] = `Bearer ${expiredToken}`;
          authenticateToken(mockReq, mockRes, mockNext).then(() => {
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(mockNext).not.toHaveBeenCalled();
            resolve();
          });
        }, 100);
      });
    });

    it('should handle authorization header without Bearer prefix', () => {
      const token = generateToken(mockUser);
      mockReq.headers['authorization'] = token; // No "Bearer " prefix
      
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        // Should fail because it expects "Bearer token" format
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
      });
      
    });

    it('should handle multiple authentication attempts', () => {
      const token = generateToken(mockUser);
      mockReq.headers['authorization'] = `Bearer ${token}`;
      
      // First attempt
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockNext).toHaveBeenCalledTimes(1);

        // Reset mocks
        mockNext.mockClear();

        // Second attempt with same token
        return authenticateToken(mockReq, mockRes, mockNext).then(() => {
          expect(mockNext).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe('Integration: Token lifecycle', () => {
    it('should complete full token lifecycle', () => {
      // Generate token
      const token = generateToken(mockUser);
      expect(token).toBeDefined();
      
      // Verify token
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded.id).toBe(mockUser.id);
      
      // Use token in middleware
      const mockReq = {
        headers: { authorization: `Bearer ${token}` }
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const mockNext = jest.fn();
      
      return authenticateToken(mockReq, mockRes, mockNext).then(() => {
        expect(mockReq.user).toBeDefined();
        expect(mockReq.user.id).toBe(mockUser.id);
        expect(mockNext).toHaveBeenCalled();
      });
      
    });
  });
});

