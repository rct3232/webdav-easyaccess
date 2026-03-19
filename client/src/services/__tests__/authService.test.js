/**
 * authService tests.
 * Uses apiClient mock: MSW + axios in Node returns empty body for 200 responses (known compat issue).
 * Tests verify authService returns response.data per spec.
 * @see docs/spec/server/routes/auth.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post } from '../apiClient';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import { login, register, getMe } from '../authService';

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('returns token and user on success', async () => {
      post.mockResolvedValueOnce({
        data: {
          token: 'mock-jwt-token',
          refreshToken: 'mock-refresh-token',
          user: { id: '1', username: 'testuser', email: 'user@example.com', status: 'approved' },
        },
      });

      const result = await login('testuser', 'password123');

      expect(post).toHaveBeenCalledWith('/auth/login', { username: 'testuser', password: 'password123' });
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.token).toBe('string');
      expect(result.user).toMatchObject({
        id: expect.any(String),
        username: 'testuser',
        email: expect.any(String),
        status: 'approved',
      });
    });

    it('rejects on invalid credentials', async () => {
      post.mockRejectedValueOnce(new Error('Request failed'));

      await expect(login('baduser', 'wrongpass')).rejects.toThrow();
    });

    it('forwards null when apiClient skips excluded 401 handling', async () => {
      post.mockResolvedValueOnce(null);

      const result = await login('baduser', 'wrongpass');

      expect(result).toBeNull();
    });
  });

  describe('register', () => {
    it('returns user on success (201)', async () => {
      post.mockResolvedValueOnce({
        data: {
          messageCode: 'serverMessages.auth.registerSuccess',
          status: 'pending',
          user: { id: '1', username: 'newuser', email: 'new@example.com', status: 'pending' },
        },
      });

      const result = await register('newuser', 'new@example.com', 'password123');

      expect(post).toHaveBeenCalledWith('/auth/register', {
        username: 'newuser',
        email: 'new@example.com',
        password: 'password123',
      });
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('status');
      expect(result.user).toMatchObject({
        username: 'newuser',
        email: 'new@example.com',
        status: 'pending',
      });
    });

    it('rejects when registration is disabled', async () => {
      post.mockRejectedValueOnce(new Error('Request failed'));

      await expect(register('user', 'user@example.com', 'password')).rejects.toThrow();
    });

    it('forwards null when apiClient skips excluded 401 handling', async () => {
      post.mockResolvedValueOnce(null);

      const result = await register('user', 'user@example.com', 'password');

      expect(result).toBeNull();
    });
  });

  describe('getMe', () => {
    it('returns user when authenticated', async () => {
      get.mockResolvedValueOnce({
        data: {
          id: '1',
          username: 'testuser',
          email: 'user@example.com',
          is_admin: false,
          status: 'approved',
        },
      });

      const result = await getMe();

      expect(get).toHaveBeenCalledWith('/auth/me');
      expect(result).toMatchObject({
        id: expect.any(String),
        username: 'testuser',
        email: 'user@example.com',
        status: 'approved',
      });
    });
  });
});
