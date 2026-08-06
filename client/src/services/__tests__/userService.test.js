/**
 * userService tests.
 * Verifies getApprovedUsers, updateEmail, updatePassword, updateUserPermissions.
 * @see docs/spec/client/services/userService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, put } from '../apiClient';

import {
  getApprovedUsers,
  updateEmail,
  updatePassword,
  updateUserPermissions,
} from '../userService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getApprovedUsers', () => {
    it('returns user array from GET /users/approved', async () => {
      const users = [{ id: '1', username: 'u1', status: 'approved' }];
      get.mockResolvedValueOnce({ data: users });

      const result = await getApprovedUsers();

      expect(get).toHaveBeenCalledWith('/users/approved');
      expect(result).toEqual(users);
      expect(Array.isArray(result)).toBe(true);
    });

    it('rejects when request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getApprovedUsers()).rejects.toThrow();
    });
  });

  describe('updateEmail', () => {
    it('calls PUT /users/:id/email with email body', async () => {
      put.mockResolvedValueOnce(undefined);

      await updateEmail('user-1', 'new@example.com');

      expect(put).toHaveBeenCalledWith('/users/user-1/email', { email: 'new@example.com' });
    });
  });

  describe('updatePassword', () => {
    it('calls PUT /users/:id/password with password body', async () => {
      put.mockResolvedValueOnce(undefined);

      await updatePassword('user-1', 'newSecret');

      expect(put).toHaveBeenCalledWith('/users/user-1/password', { password: 'newSecret' });
    });
  });

  describe('updateUserPermissions', () => {
    it('calls PUT /users/:id/permissions with permissions array', async () => {
      put.mockResolvedValueOnce(undefined);
      const permissions = [{ folderPath: '/a', permission: 'read' }];

      await updateUserPermissions('user-1', permissions);

      expect(put).toHaveBeenCalledWith('/users/user-1/permissions', { permissions });
    });
  });
});
