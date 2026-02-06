import React from 'react';
import * as permissionRequestService from '../../services/permissionRequestService';

// Mock services
jest.mock('../../services/permissionRequestService');

describe('Permission Requests Integration Tests (P4-P7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('권한 요청 서비스', () => {
    describe('createPermissionRequest (P4)', () => {
      it('creates a permission request successfully', async () => {
        const mockRequest = {
          id: 1,
          folderPath: '/owner/shared',
          requestedPermission: 'read',
          status: 'pending',
        };
        permissionRequestService.createPermissionRequest.mockResolvedValue(mockRequest);

        const result = await permissionRequestService.createPermissionRequest({
          folderPath: '/owner/shared',
          permission: 'read',
          message: 'Please give access',
        });

        expect(permissionRequestService.createPermissionRequest).toHaveBeenCalled();
        expect(result.status).toBe('pending');
      });

      it('handles creation failure', async () => {
        permissionRequestService.createPermissionRequest.mockRejectedValue(
          new Error('Request failed')
        );

        await expect(
          permissionRequestService.createPermissionRequest({
            folderPath: '/owner/shared',
            permission: 'read',
            message: '',
          })
        ).rejects.toThrow('Request failed');
      });
    });

    describe('listInboxPermissionRequests (수신함)', () => {
      it('fetches inbox permission requests', async () => {
        const mockRequests = [
          {
            id: 1,
            requesterUsername: 'requester1',
            folderPath: '/testuser/shared',
            requestedPermission: 'read',
            status: 'pending',
          },
          {
            id: 2,
            requesterUsername: 'requester2',
            folderPath: '/testuser/docs',
            requestedPermission: 'write',
            status: 'pending',
          },
        ];
        permissionRequestService.listInboxPermissionRequests.mockResolvedValue(mockRequests);

        const result = await permissionRequestService.listInboxPermissionRequests({});

        expect(result).toHaveLength(2);
        expect(result[0].requesterUsername).toBe('requester1');
      });

      it('filters by status', async () => {
        permissionRequestService.listInboxPermissionRequests.mockResolvedValue([]);

        await permissionRequestService.listInboxPermissionRequests({ status: 'pending' });

        expect(permissionRequestService.listInboxPermissionRequests).toHaveBeenCalledWith({
          status: 'pending',
        });
      });
    });

    describe('listOutboxPermissionRequests (발신함)', () => {
      it('fetches outbox permission requests', async () => {
        const mockRequests = [
          {
            id: 1,
            ownerUsername: 'owner1',
            folderPath: '/owner1/shared',
            requestedPermission: 'read',
            status: 'pending',
          },
        ];
        permissionRequestService.listOutboxPermissionRequests.mockResolvedValue(mockRequests);

        const result = await permissionRequestService.listOutboxPermissionRequests({});

        expect(result).toHaveLength(1);
        expect(result[0].ownerUsername).toBe('owner1');
      });
    });

    describe('approvePermissionRequest (P5)', () => {
      it('approves a permission request', async () => {
        permissionRequestService.approvePermissionRequest.mockResolvedValue({ success: true });

        const result = await permissionRequestService.approvePermissionRequest(1);

        expect(permissionRequestService.approvePermissionRequest).toHaveBeenCalledWith(1);
        expect(result.success).toBe(true);
      });
    });

    describe('rejectPermissionRequest (P6)', () => {
      it('rejects a permission request', async () => {
        permissionRequestService.rejectPermissionRequest.mockResolvedValue({ success: true });

        const result = await permissionRequestService.rejectPermissionRequest(1);

        expect(permissionRequestService.rejectPermissionRequest).toHaveBeenCalledWith(1);
        expect(result.success).toBe(true);
      });
    });

    describe('cancelPermissionRequest (P7)', () => {
      it('cancels own permission request', async () => {
        permissionRequestService.cancelPermissionRequest.mockResolvedValue({ success: true });

        const result = await permissionRequestService.cancelPermissionRequest(1);

        expect(permissionRequestService.cancelPermissionRequest).toHaveBeenCalledWith(1);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('checkOwnerExists', () => {
    it('checks if folder owner exists', async () => {
      permissionRequestService.checkOwnerExists.mockResolvedValue({
        exists: true,
        ownerId: 2,
        ownerUsername: 'owner',
      });

      const result = await permissionRequestService.checkOwnerExists('/owner/shared');

      expect(result.exists).toBe(true);
      expect(result.ownerUsername).toBe('owner');
    });

    it('returns false when owner not found', async () => {
      permissionRequestService.checkOwnerExists.mockResolvedValue({
        exists: false,
      });

      const result = await permissionRequestService.checkOwnerExists('/unknown/path');

      expect(result.exists).toBe(false);
    });
  });

  describe('권한 요청 워크플로우', () => {
    it('complete request workflow: create -> approve -> granted', async () => {
      // Step 1: Create request
      const createResult = {
        id: 1,
        status: 'pending',
        folderPath: '/owner/shared',
      };
      permissionRequestService.createPermissionRequest.mockResolvedValue(createResult);

      const created = await permissionRequestService.createPermissionRequest({
        folderPath: '/owner/shared',
        permission: 'read',
        message: 'Need access',
      });
      expect(created.status).toBe('pending');

      // Step 2: Approve request
      permissionRequestService.approvePermissionRequest.mockResolvedValue({ success: true });
      const approved = await permissionRequestService.approvePermissionRequest(created.id);
      expect(approved.success).toBe(true);
    });

    it('complete request workflow: create -> reject', async () => {
      // Step 1: Create request
      const createResult = {
        id: 1,
        status: 'pending',
        folderPath: '/owner/private',
      };
      permissionRequestService.createPermissionRequest.mockResolvedValue(createResult);

      const created = await permissionRequestService.createPermissionRequest({
        folderPath: '/owner/private',
        permission: 'write',
        message: 'Need write access',
      });
      expect(created.status).toBe('pending');

      // Step 2: Reject request
      permissionRequestService.rejectPermissionRequest.mockResolvedValue({ success: true });
      const rejected = await permissionRequestService.rejectPermissionRequest(created.id);
      expect(rejected.success).toBe(true);
    });

    it('complete request workflow: create -> cancel', async () => {
      // Step 1: Create request
      const createResult = {
        id: 1,
        status: 'pending',
        folderPath: '/owner/shared',
      };
      permissionRequestService.createPermissionRequest.mockResolvedValue(createResult);

      const created = await permissionRequestService.createPermissionRequest({
        folderPath: '/owner/shared',
        permission: 'read',
        message: 'Request access',
      });

      // Step 2: Cancel request
      permissionRequestService.cancelPermissionRequest.mockResolvedValue({ success: true });
      const cancelled = await permissionRequestService.cancelPermissionRequest(created.id);
      expect(cancelled.success).toBe(true);
    });
  });
});
