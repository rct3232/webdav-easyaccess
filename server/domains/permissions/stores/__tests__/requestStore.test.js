/**
 * permissionRequestStore — nodeId-based tests.
 * Verifies createRequest, getById, listInbox/listOutbox, updateStatus, deleteByRequestId
 * using file_node_id references instead of path strings.
 */
const crypto = require('crypto');
const permissionRequestStore = require('../permissionRequestStore');
const { PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  createTestDatabase,
  dbRun,
} = require('../../../../test-utils');

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

describe('permissionRequestStore (nodeId)', () => {
  let dbCleanup;
  let ownerId;
  let ownerUsername;
  let requesterId;
  let requesterUsername;
  let fileNodeId;
  let dirNodeId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;

    // Create users directly via SQL to avoid bootstrap admin issues
    ownerUsername = uid('owner');
    const ownerRes = await dbRun(
      `INSERT INTO users (username, email, email_hash, password, status, is_admin)
       VALUES (?, ?, ?, ?, 'approved', false)`,
      [ownerUsername, `${ownerUsername}@test.com`, 'hash_owner', 'pw']
    );
    ownerId = ownerRes.lastID;

    requesterUsername = uid('req');
    const reqRes = await dbRun(
      `INSERT INTO users (username, email, email_hash, password, status, is_admin)
       VALUES (?, ?, ?, ?, 'approved', false)`,
      [requesterUsername, `${requesterUsername}@test.com`, 'hash_req', 'pw']
    );
    requesterId = reqRes.lastID;

    // Create file_nodes for testing
    const fileRes = await dbRun(
      `INSERT INTO file_nodes (name, type) VALUES (?, ?)`,
      [uid('file'), 'file']
    );
    fileNodeId = fileRes.lastID;

    const dirRes = await dbRun(
      `INSERT INTO file_nodes (name, type) VALUES (?, ?)`,
      [uid('dir'), 'directory']
    );
    dirNodeId = dirRes.lastID;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('V1 — createRequest with fileNodeId', () => {
    it('creates request and stores file_node_id', async () => {
      const req = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId,
        requestedPermission: 'read',
        message: 'V1 test request',
      });

      expect(req).toMatchObject({
        requester_id: requesterId,
        owner_id: ownerId,
        requested_permission: 'read',
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(req.file_node_id).toBe(fileNodeId);
      expect(typeof req.id).toBe('number');
    });

    it('throws 400 for invalid permission', async () => {
      await expect(
        permissionRequestStore.createRequest({
          requesterId,
          requesterUsername,
          ownerId,
          ownerUsername,
          fileNodeId,
          requestedPermission: 'invalid',
        })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws 400 for missing fileNodeId', async () => {
      await expect(
        permissionRequestStore.createRequest({
          requesterId,
          requesterUsername,
          ownerId,
          ownerUsername,
          requestedPermission: 'read',
        })
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('V2 — createRequest duplicate pending deduplication', () => {
    it('returns existing request for same (requester, owner, permission, nodeId)', async () => {
      const first = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId: dirNodeId,
        requestedPermission: 'write',
      });

      const second = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId: dirNodeId,
        requestedPermission: 'write',
      });

      expect(second.id).toBe(first.id);
    });

    it('allows different permission on same nodeId (not a duplicate)', async () => {
      const readReq = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId: dirNodeId,
        requestedPermission: 'read',
      });

      expect(readReq.id).toBeDefined();
    });

    it('allows different requester for same nodeId (not a duplicate)', async () => {
      const otherUserRes = await dbRun(
        `INSERT INTO users (username, email, email_hash, password, status, is_admin)
         VALUES (?, ?, ?, ?, 'approved', false)`,
        [uid('other'), `${uid('other')}@test.com`, 'hash_other', 'pw']
      );
      const otherId = otherUserRes.lastID;

      // Update username to match what we inserted
      await dbRun(
        `UPDATE users SET username = ? WHERE id = ?`,
        [uid('otherer'), otherId]
      );

      const req = await permissionRequestStore.createRequest({
        requesterId: otherId,
        requesterUsername: 'other-user',
        ownerId,
        ownerUsername,
        fileNodeId: dirNodeId,
        requestedPermission: 'read',
      });

      expect(req.id).toBeDefined();
    });
  });

  describe('V3 — getById returns node_id and derived type', () => {
    it('returns targetType=file for a file node', async () => {
      const created = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId,
        requestedPermission: 'write',
      });

      const fetched = await permissionRequestStore.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched.file_node_id).toBe(fileNodeId);
      expect(fetched.targetType).toBe('file');
    });

    it('returns targetType=directory for a directory node', async () => {
      const dirFileRes = await dbRun(
        `INSERT INTO file_nodes (name, type) VALUES (?, ?)`,
        [uid('dir2'), 'directory']
      );
      const dir2Id = dirFileRes.lastID;

      const created = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId: dir2Id,
        requestedPermission: 'read',
      });

      const fetched = await permissionRequestStore.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched.targetType).toBe('directory');
    });

    it('returns null when not found', async () => {
      const result = await permissionRequestStore.getById(999999);
      expect(result).toBeNull();
    });
  });

  describe('V4 — listInbox / listOutbox filters by status', () => {
    it('listInbox returns owner requests with targetType', async () => {
      const inbox = await permissionRequestStore.listInbox(ownerId);
      expect(Array.isArray(inbox)).toBe(true);
      expect(inbox.length).toBeGreaterThan(0);
      inbox.forEach((r) => {
        expect(r.owner_id).toBe(ownerId);
        expect(typeof r.file_node_id).toBe('number');
        expect(r.targetType).toBeDefined();
      });
    });

    it('listInbox filters by status=pending', async () => {
      const pending = await permissionRequestStore.listInbox(ownerId, {
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(Array.isArray(pending)).toBe(true);
      pending.forEach((r) => {
        expect(r.status).toBe(PERMISSION_REQUEST_STATUS.PENDING);
        expect(r.owner_id).toBe(ownerId);
      });
    });

    it('listOutbox returns requester requests', async () => {
      const outbox = await permissionRequestStore.listOutbox(requesterId);
      expect(Array.isArray(outbox)).toBe(true);
      outbox.forEach((r) => {
        expect(r.requester_id).toBe(requesterId);
        expect(typeof r.file_node_id).toBe('number');
        expect(r.targetType).toBeDefined();
      });
    });

    it('listOutbox filters by status', async () => {
      const pending = await permissionRequestStore.listOutbox(requesterId, {
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(Array.isArray(pending)).toBe(true);
      pending.forEach((r) => {
        expect(r.status).toBe(PERMISSION_REQUEST_STATUS.PENDING);
      });
    });
  });

  describe('V5 — updateStatus PENDING -> APPROVED sets resolved_at/resolved_by', () => {
    let approvableReqId;

    beforeAll(async () => {
      const nodeResult = await dbRun(
        `INSERT INTO file_nodes (name, type) VALUES (?, ?)`,
        [uid('approve'), 'file']
      );
      const targetNodeId = nodeResult.lastID;

      const created = await permissionRequestStore.createRequest({
        requesterId,
        requesterUsername,
        ownerId,
        ownerUsername,
        fileNodeId: targetNodeId,
        requestedPermission: 'read',
      });
      approvableReqId = created.id;
    });

    it('PENDING -> APPROVED sets resolved_at and resolved_by', async () => {
      const updated = await permissionRequestStore.updateStatus(approvableReqId, {
        status: PERMISSION_REQUEST_STATUS.APPROVED,
        resolvedBy: ownerId,
      });

      expect(updated.status).toBe(PERMISSION_REQUEST_STATUS.APPROVED);
      expect(updated.resolved_at).toBeDefined();
      expect(updated.resolved_by).toBe(ownerId);
    });

    it('APPROVED -> PENDING clears resolved_at and resolved_by', async () => {
      const reverted = await permissionRequestStore.updateStatus(approvableReqId, {
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });

      expect(reverted.status).toBe(PERMISSION_REQUEST_STATUS.PENDING);
      expect(reverted.resolved_at).toBeFalsy();
      expect(reverted.resolved_by).toBeFalsy();
    });

    it('throws 404 for non-existent request', async () => {
      await expect(
        permissionRequestStore.updateStatus(999999, {
          status: PERMISSION_REQUEST_STATUS.APPROVED,
        })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('throws 400 for invalid status', async () => {
      await expect(
        permissionRequestStore.updateStatus(approvableReqId, {
          status: 'invalid-status',
        })
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('V6 — deleteByRequesterId cascades', () => {
    it('removes all requests for the given requester', async () => {
      const beforeOutbox = await permissionRequestStore.listOutbox(requesterId);
      const beforeCount = beforeOutbox.length;

      const result = await permissionRequestStore.deleteByRequesterId(requesterId);
      expect(typeof result.deletedCount).toBe('number');
      expect(result.deletedCount).toBe(beforeCount);

      const afterOutbox = await permissionRequestStore.listOutbox(requesterId);
      expect(afterOutbox.length).toBe(0);
    });
  });

  describe('rejectByOwnerId', () => {
    it('bulk rejects pending requests for an owner', async () => {
      // Create a fresh user and node to test reject in isolation
      const otherUserRes = await dbRun(
        `INSERT INTO users (username, email, email_hash, password, status, is_admin)
         VALUES (?, ?, ?, ?, 'approved', false)`,
        [uid('freshreq'), `${uid('freshreq')}@test.com`, 'hash_fresh', 'pw']
      );
      const freshReqId = otherUserRes.lastID;

      const nodeResult = await dbRun(
        `INSERT INTO file_nodes (name, type) VALUES (?, ?)`,
        [uid('reject'), 'file']
      );

      await permissionRequestStore.createRequest({
        requesterId: freshReqId,
        requesterUsername: 'fresh-req',
        ownerId,
        ownerUsername,
        fileNodeId: nodeResult.lastID,
        requestedPermission: 'read',
      });

      const result = await permissionRequestStore.rejectByOwnerId(ownerId);
      expect(result.rejectedCount).toBeGreaterThan(0);

      // Verify no pending requests remain for this owner
      const inbox = await permissionRequestStore.listInbox(ownerId, {
        status: PERMISSION_REQUEST_STATUS.PENDING,
      });
      expect(inbox.length).toBe(0);
    });
  });
});
