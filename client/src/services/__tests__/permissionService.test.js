/**
 * permissionService tests.
 * Verifies getUserPermissions, getFolderPermissions, grantPermission, revokePermission,
 * checkPermission, listFilePermissions. Return shapes and endpoint usage per spec.
 * @see docs/spec/client/services/permissionService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post, del } from '../apiClient';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  del: jest.fn(),
}));

import {
  getUserPermissions,
  getFolderPermissions,
  grantPermission,
  revokePermission,
  checkPermission,
  listFilePermissions,
} from '../permissionService';

describe('permissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserPermissions', () => {
    it('returns array from GET /permissions/user/:userId', async () => {
      const perms = [{ folderPath: '/a', permission: 'read' }];
      get.mockResolvedValueOnce({ data: perms });

      const result = await getUserPermissions('user-1');

      expect(get).toHaveBeenCalledWith('/permissions/user/user-1');
      expect(result).toEqual(perms);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getFolderPermissions', () => {
    it('returns array from GET /permissions/folder with path params', async () => {
      const perms = [];
      get.mockResolvedValueOnce({ data: perms });

      const result = await getFolderPermissions('/docs', false);

      expect(get).toHaveBeenCalledWith('/permissions/folder', {
        params: { path: '/docs', includeSubfolders: 'false' },
      });
      expect(Array.isArray(result)).toBe(true);
    });

    it('sends includeSubfolders true and filePath when provided', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await getFolderPermissions('/docs', true, '/docs/file.txt');

      expect(get).toHaveBeenCalledWith('/permissions/folder', {
        params: { path: '/docs', includeSubfolders: 'true', filePath: '/docs/file.txt' },
      });
    });
  });

  describe('grantPermission', () => {
    it('calls POST /permissions/grant with userId, folderPath, permission', async () => {
      post.mockResolvedValueOnce(undefined);

      await grantPermission({
        userId: 'u1',
        folderPath: '/a',
        permission: 'read',
      });

      expect(post).toHaveBeenCalledWith('/permissions/grant', {
        userId: 'u1',
        folderPath: '/a',
        permission: 'read',
      });
    });

    it('includes target "file" for file-level grant', async () => {
      post.mockResolvedValueOnce(undefined);

      await grantPermission({
        userId: 'u1',
        folderPath: '/a/file.txt',
        permission: 'read',
        target: 'file',
      });

      expect(post).toHaveBeenCalledWith('/permissions/grant', {
        userId: 'u1',
        folderPath: '/a/file.txt',
        permission: 'read',
        target: 'file',
      });
    });
  });

  describe('revokePermission', () => {
    it('calls DELETE /permissions/revoke with params', async () => {
      del.mockResolvedValueOnce(undefined);

      await revokePermission({
        userId: 'u1',
        folderPath: '/a',
        includeSubfolders: false,
      });

      expect(del).toHaveBeenCalledWith('/permissions/revoke', {
        params: { userId: 'u1', folderPath: '/a', includeSubfolders: 'false' },
      });
    });

    it('includes scope pathOnly for file-level revoke', async () => {
      del.mockResolvedValueOnce(undefined);

      await revokePermission({
        userId: 'u1',
        folderPath: '/a/file.txt',
        includeSubfolders: false,
        scope: 'pathOnly',
      });

      expect(del).toHaveBeenCalledWith('/permissions/revoke', {
        params: {
          userId: 'u1',
          folderPath: '/a/file.txt',
          includeSubfolders: 'false',
          scope: 'pathOnly',
        },
      });
    });
  });

  describe('checkPermission', () => {
    it('returns object with hasRead, hasWrite, source', async () => {
      const data = { path: '/a', hasRead: true, hasWrite: false, source: 'path' };
      get.mockResolvedValueOnce({ data });

      const result = await checkPermission('/a');

      expect(get).toHaveBeenCalledWith('/permissions/check', { params: { path: '/a' } });
      expect(result).toHaveProperty('hasRead');
      expect(result).toHaveProperty('hasWrite');
      expect(result).toHaveProperty('source');
      expect(result).toEqual(data);
    });
  });

  describe('listFilePermissions', () => {
    it('returns array from GET /permissions/file/list', async () => {
      const list = [];
      get.mockResolvedValueOnce({ data: list });

      const result = await listFilePermissions();

      expect(get).toHaveBeenCalledWith('/permissions/file/list', { params: {} });
      expect(Array.isArray(result)).toBe(true);
    });

    it('sends folderPath when provided', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await listFilePermissions('/docs');

      expect(get).toHaveBeenCalledWith('/permissions/file/list', {
        params: { folderPath: '/docs' },
      });
    });
  });
});
