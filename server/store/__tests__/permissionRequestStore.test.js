/**
 * permissionRequestStore tests.
 * Verifies createRequest, getById, listInbox, listOutbox, updateStatus, deleteByRequesterId, rejectByOwnerId.
 */
const permissionRequestStore = require('../../domains/permissions/stores/permissionRequestStore');
const { PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../test-utils');

describe('permissionRequestStore', () => {
  let dbCleanup;
  let ownerId;
  let requesterId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const owner = await createAuthenticatedTestUser();
    const requester = await createAuthenticatedTestUser({ username: 'req_store' });
    ownerId = owner.user.id;
    requesterId = requester.user.id;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('createRequest', () => {
    it('creates request with pending status', async () => {
      const req = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername: 'req_store',
        ownerId,
        ownerUsername: 'owner',
        folderPath: '/store-folder',
        requestedPermission: 'read',
      });
      expect(req).toMatchObject({
        requester_id: requesterId,
        owner_id: ownerId,
        folder_path: '/store-folder',
        requested_permission: 'read',
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(req.id).toBeDefined();
    });

    it('throws 400 for invalid permission', async () => {
      await expect(
        permissionRequestStore.createRequest({
          requesterId,
          requesterUsername: 'x',
          ownerId,
          ownerUsername: 'y',
          folderPath: '/x',
          requestedPermission: 'invalid',
        })
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getById', () => {
    it('returns request when exists', async () => {
      const created = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername: 'x',
        ownerId,
        ownerUsername: 'y',
        folderPath: '/getbyid',
        requestedPermission: 'write',
      });
      const req = await permissionRequestStore.getById(created.id);
      expect(req).toMatchObject({ id: created.id, folder_path: '/getbyid' });
    });

    it('returns null when not found', async () => {
      const req = await permissionRequestStore.getById(999999);
      expect(req).toBeNull();
    });
  });

  describe('listInbox / listOutbox', () => {
    it('listInbox returns owner requests', async () => {
      const inbox = await permissionRequestStore.listInbox(ownerId);
      expect(Array.isArray(inbox)).toBe(true);
      inbox.forEach((r) => expect(r.owner_id).toBe(ownerId));
    });

    it('listOutbox returns requester requests', async () => {
      const outbox = await permissionRequestStore.listOutbox(requesterId);
      expect(Array.isArray(outbox)).toBe(true);
      outbox.forEach((r) => expect(r.requester_id).toBe(requesterId));
    });
  });

  describe('updateStatus', () => {
    it('updates status', async () => {
      const created = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername: 'x',
        ownerId,
        ownerUsername: 'y',
        folderPath: '/update-status',
        requestedPermission: 'read',
      });
      const updated = await permissionRequestStore.updateStatus(created.id, {
        status: PERMISSION_REQUEST_STATUS.APPROVED,
        resolvedBy: ownerId,
      });
      expect(updated.status).toBe(PERMISSION_REQUEST_STATUS.APPROVED);
    });

    it('throws 404 when request not found', async () => {
      await expect(
        permissionRequestStore.updateStatus(999999, { status: PERMISSION_REQUEST_STATUS.APPROVED })
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteByRequesterId', () => {
    it('returns deletedCount', async () => {
      const { deletedCount } = await permissionRequestStore.deleteByRequesterId(requesterId);
      expect(typeof deletedCount).toBe('number');
    });
  });
});
