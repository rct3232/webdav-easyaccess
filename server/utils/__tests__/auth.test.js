/**
 * Unit tests for auth utilities
 * Tests JWT token generation, verification, and authentication middleware
 */

const jwt = require('jsonwebtoken');
const { generateToken, verifyToken, authenticateToken } = require('../auth');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

describe('auth utilities', () => {
  const mockUser = {
    id: 1,
    username: 'testuser'
  };

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
      
      // Token should expire in approximately 7 days (604800 seconds)
      const expirationTime = decoded.exp - decoded.iat;
      expect(expirationTime).toBeCloseTo(604800, -2);
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
      
      authenticateToken(mockReq, mockRes, mockNext);
      
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.id).toBe(mockUser.id);
      expect(mockReq.user.username).toBe(mockUser.username);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject request without token', () => {
      authenticateToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token', () => {
      mockReq.headers['authorization'] = 'Bearer invalid.token.string';
      
      authenticateToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with malformed authorization header', () => {
      mockReq.headers['authorization'] = 'InvalidFormat';
      
      authenticateToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
      expect(mockNext).not.toHaveBeenCalled();
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
          authenticateToken(mockReq, mockRes, mockNext);
          
          expect(mockRes.status).toHaveBeenCalledWith(403);
          expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
          expect(mockNext).not.toHaveBeenCalled();
          resolve();
        }, 100);
      });
    });

    it('should handle authorization header without Bearer prefix', () => {
      const token = generateToken(mockUser);
      mockReq.headers['authorization'] = token; // No "Bearer " prefix
      
      authenticateToken(mockReq, mockRes, mockNext);
      
      // Should fail because it expects "Bearer token" format
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle multiple authentication attempts', () => {
      const token = generateToken(mockUser);
      mockReq.headers['authorization'] = `Bearer ${token}`;
      
      // First attempt
      authenticateToken(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      
      // Reset mocks
      mockNext.mockClear();
      
      // Second attempt with same token
      authenticateToken(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
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
      
      authenticateToken(mockReq, mockRes, mockNext);
      
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.id).toBe(mockUser.id);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});

