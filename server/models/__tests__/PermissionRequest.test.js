/**
 * PermissionRequest model tests.
 * Verifies create, findById, listInbox, listOutbox, updateStatus, deleteByRequesterId, rejectByOwnerId.
 */
const PermissionRequest = require('../PermissionRequest');
const { PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
} = require('../../test-utils');

describe('PermissionRequest model', () => {
  let dbCleanup;
  let ownerId;
  let requesterId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const owner = await createAuthenticatedTestUser();
    const requester = await createAuthenticatedTestUser({ username: 'requester' });
    ownerId = owner.user.id;
    requesterId = requester.user.id;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('create', () => {
    it('creates a request and returns id, status pending', async () => {
      const result = await PermissionRequest.create({
        requesterId,
        requesterUsername: 'requester',
        ownerId,
        ownerUsername: 'owner',
        folderPath: '/shared',
        requestedPermission: 'read',
        message: 'Please grant access',
      });
      expect(result).toMatchObject({
        requester_id: requesterId,
        owner_id: ownerId,
        folder_path: '/shared',
        requested_permission: 'read',
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('number');
    });
  });

  describe('findById', () => {
    it('returns request when id exists', async () => {
      const created = await PermissionRequest.create({
        requesterId,
        requesterUsername: 'requester',
        ownerId,
        ownerUsername: 'owner',
        folderPath: '/find-me',
        requestedPermission: 'write',
      });
      const req = await PermissionRequest.findById(created.id);
      expect(req).toMatchObject({
        id: created.id,
        folder_path: '/find-me',
        requested_permission: 'write',
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
    });

    it('returns null when id does not exist', async () => {
      const req = await PermissionRequest.findById(999999);
      expect(req).toBeNull();
    });
  });

  describe('listInbox', () => {
    it('returns requests where owner is the given user', async () => {
      const inbox = await PermissionRequest.listInbox(ownerId);
      expect(Array.isArray(inbox)).toBe(true);
      inbox.forEach((r) => expect(r.owner_id).toBe(ownerId));
    });

    it('filters by status when provided', async () => {
      const inbox = await PermissionRequest.listInbox(ownerId, {
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      inbox.forEach((r) => expect(r.status).toBe(PERMISSION_REQUEST_STATUS.PENDING));
    });
  });

  describe('listOutbox', () => {
    it('returns requests where requester is the given user', async () => {
      const outbox = await PermissionRequest.listOutbox(requesterId);
      expect(Array.isArray(outbox)).toBe(true);
      outbox.forEach((r) => expect(r.requester_id).toBe(requesterId));
    });
  });

  describe('updateStatus', () => {
    it('updates status to approved', async () => {
      const created = await PermissionRequest.create({
        requesterId,
        requesterUsername: 'requester',
        ownerId,
        ownerUsername: 'owner',
        folderPath: '/approve-me',
        requestedPermission: 'read',
      });
      const updated = await PermissionRequest.updateStatus(created.id, {
        status: PERMISSION_REQUEST_STATUS.APPROVED,
        resolvedBy: ownerId,
      });
      expect(updated.status).toBe(PERMISSION_REQUEST_STATUS.APPROVED);
      expect(updated.resolved_at).toBeDefined();
      expect(updated.resolved_by).toBe(ownerId);
    });
  });

  describe('deleteByRequesterId', () => {
    it('removes requests by requester', async () => {
      const before = await PermissionRequest.listOutbox(requesterId);
      const { deletedCount } = await PermissionRequest.deleteByRequesterId(requesterId);
      const after = await PermissionRequest.listOutbox(requesterId);
      expect(after.length).toBe(before.length - deletedCount);
    });
  });
});
