/**
 * permissionRequestService tests.
 * Verifies create, inbox/outbox list, approve/reject/cancel, checkOwnerExists.
 * @see docs/spec/client/services/permissionRequestService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post } from '../apiClient';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import {
  createPermissionRequest,
  listInboxPermissionRequests,
  listOutboxPermissionRequests,
  approvePermissionRequest,
  rejectPermissionRequest,
  cancelPermissionRequest,
  checkOwnerExists,
} from '../permissionRequestService';

describe('permissionRequestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPermissionRequest', () => {
    it('sends nodeId when provided', async () => {
      post.mockResolvedValueOnce({ data: { id: 'req-1' } });

      const result = await createPermissionRequest({
        nodeId: 42,
        permission: 'read',
        message: 'Please',
      });

      expect(post).toHaveBeenCalledWith('/permission-requests', {
        nodeId: 42,
        permission: 'read',
        message: 'Please',
      });
      expect(result).toHaveProperty('id');
    });
  });

  describe('listInboxPermissionRequests', () => {
    it('returns array from GET /permission-requests/inbox', async () => {
      const list = [{ id: '1', status: 'pending' }];
      get.mockResolvedValueOnce({ data: list });

      const result = await listInboxPermissionRequests({});

      expect(get).toHaveBeenCalledWith('/permission-requests/inbox', {
        params: undefined,
      });
      expect(result).toEqual(list);
      expect(Array.isArray(result)).toBe(true);
    });

    it('sends status param when provided', async () => {
      get.mockResolvedValueOnce({ data: [] });

      await listInboxPermissionRequests({ status: 'pending' });

      expect(get).toHaveBeenCalledWith('/permission-requests/inbox', {
        params: { status: 'pending' },
      });
    });
  });

  describe('listOutboxPermissionRequests', () => {
    it('returns array from GET /permission-requests/outbox', async () => {
      get.mockResolvedValueOnce({ data: [] });

      const result = await listOutboxPermissionRequests({});

      expect(get).toHaveBeenCalledWith('/permission-requests/outbox', {
        params: undefined,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('approvePermissionRequest', () => {
    it('calls POST /permission-requests/:id/approve', async () => {
      post.mockResolvedValueOnce({ data: { status: 'approved' } });

      const result = await approvePermissionRequest('req-1');

      expect(post).toHaveBeenCalledWith('/permission-requests/req-1/approve');
      expect(result).toHaveProperty('status');
    });
  });

  describe('rejectPermissionRequest', () => {
    it('calls POST /permission-requests/:id/reject', async () => {
      post.mockResolvedValueOnce({ data: {} });

      await rejectPermissionRequest('req-2');

      expect(post).toHaveBeenCalledWith('/permission-requests/req-2/reject');
    });
  });

  describe('cancelPermissionRequest', () => {
    it('calls POST /permission-requests/:id/cancel', async () => {
      post.mockResolvedValueOnce({ data: {} });

      await cancelPermissionRequest('req-3');

      expect(post).toHaveBeenCalledWith('/permission-requests/req-3/cancel');
    });
  });

  describe('checkOwnerExists', () => {
    it('uses nodeId param', async () => {
      get.mockResolvedValueOnce({ data: { ownerExists: true } });

      const result = await checkOwnerExists(42);

      expect(get).toHaveBeenCalledWith('/permission-requests/check-owner', {
        params: { nodeId: 42 },
      });
      expect(result).toHaveProperty('ownerExists');
    });
  });
});
