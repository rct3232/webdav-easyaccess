'use strict';

/**
 * PermissionRequestRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 */

const { createTestDatabase } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createPermissionRequestRepository = require('../PermissionRequestRepository');
const { PERMISSIONS, PERMISSION_REQUEST_STATUS } = require('@webdav-easyaccess/shared/constants');

describe('PermissionRequestRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;
  let requester;
  let owner;

  const uniqueName = (p) => `${p}-${Date.now()}-${++seq}`;

  const createUser = async (username) => {
    const User = require('@server/models/User');
    return User.create(username, `${username}@conf.test`, 'pw', false);
  };

  const createNode = async () => {
    const { createTestFileNode } = require('@server/test-utils');
    return createTestFileNode({ name: uniqueName('pr-file.txt') });
  };

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createPermissionRequestRepository(storage.getExecutor());
    requester = await createUser(uniqueName('pr-req'));
    owner = await createUser(uniqueName('pr-owner'));
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const baseData = (nodeId, permission = PERMISSIONS.READ) => ({
    requesterId: requester.id,
    requesterUsername: requester.username,
    ownerId: owner.id,
    ownerUsername: owner.username,
    fileNodeId: nodeId,
    requestedPermission: permission,
    message: 'hi',
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('insertPendingRequest creates a domain-shaped request', async () => {
    const node = await createNode();
    const created = await repo.insertPendingRequest(baseData(node.nodeId));
    expect(created.id).toBeGreaterThan(0);
    expect(created.requester_id).toBe(Number(requester.id));
    expect(created.owner_id).toBe(Number(owner.id));
    expect(created.file_node_id).toBe(Number(node.nodeId));
    expect(created.status).toBe(PERMISSION_REQUEST_STATUS.PENDING);
    // The insert RETURNING carries no file JOIN, so targetType is filled by
    // getById / the list queries (matches the former store behaviour).
    expect(created.targetType).toBeNull();

    const viaGet = await repo.getById(created.id);
    expect(viaGet.targetType).toBe('file');
  });

  it('insertPendingRequest is idempotent for a duplicate pending request', async () => {
    const node = await createNode();
    const data = baseData(node.nodeId);
    const first = await repo.insertPendingRequest(data);
    const second = await repo.insertPendingRequest(data);
    expect(second.id).toBe(first.id);
  });

  it('a different permission on the same node is not a duplicate', async () => {
    const node = await createNode();
    const first = await repo.insertPendingRequest(baseData(node.nodeId, PERMISSIONS.READ));
    const second = await repo.insertPendingRequest(baseData(node.nodeId, PERMISSIONS.WRITE));
    expect(second.id).not.toBe(first.id);
  });

  it('getById returns targetType from the file node and null for a missing id', async () => {
    const node = await createNode();
    const created = await repo.insertPendingRequest(baseData(node.nodeId));
    const found = await repo.getById(created.id);
    expect(found.targetType).toBe('file');
    await expect(repo.getById(99999999)).resolves.toBeNull();
  });

  it('listByOwner / listByRequester filter by status', async () => {
    const node = await createNode();
    const created = await repo.insertPendingRequest(baseData(node.nodeId));

    const inbox = await repo.listByOwner(owner.id, null);
    expect(inbox.some((r) => r.id === created.id)).toBe(true);

    const pending = await repo.listByOwner(owner.id, PERMISSION_REQUEST_STATUS.PENDING);
    expect(pending.some((r) => r.id === created.id)).toBe(true);

    const approved = await repo.listByOwner(owner.id, PERMISSION_REQUEST_STATUS.APPROVED);
    expect(approved.some((r) => r.id === created.id)).toBe(false);

    const outbox = await repo.listByRequester(requester.id, null);
    expect(outbox.some((r) => r.id === created.id)).toBe(true);
  });

  it('updateStatusRow PENDING -> APPROVED sets resolved_at/by, APPROVED -> PENDING clears them', async () => {
    const node = await createNode();
    const created = await repo.insertPendingRequest(baseData(node.nodeId));

    const approved = await repo.updateStatusRow(created.id, PERMISSION_REQUEST_STATUS.APPROVED, 7);
    expect(approved.status).toBe(PERMISSION_REQUEST_STATUS.APPROVED);
    expect(approved.resolved_by).toBe(7);
    expect(approved.resolved_at).not.toBeNull();

    const backToPending = await repo.updateStatusRow(
      created.id,
      PERMISSION_REQUEST_STATUS.PENDING,
      null
    );
    expect(backToPending.status).toBe(PERMISSION_REQUEST_STATUS.PENDING);
    expect(backToPending.resolved_at).toBeNull();
    expect(backToPending.resolved_by).toBeNull();
  });

  it('updateStatusRow raises 404 for an unknown request', async () => {
    await expect(
      repo.updateStatusRow(99999999, PERMISSION_REQUEST_STATUS.APPROVED, 1)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deleteByRequesterId deletes the requester rows and reports the count', async () => {
    const node = await createNode();
    await repo.insertPendingRequest(baseData(node.nodeId));
    const res = await repo.deleteByRequesterId(requester.id);
    expect(res.deletedCount).toBeGreaterThanOrEqual(1);
  });

  it('rejectPendingByOwnerId bulk-rejects pending requests for the owner', async () => {
    const node = await createNode();
    const created = await repo.insertPendingRequest(baseData(node.nodeId));
    const res = await repo.rejectPendingByOwnerId(owner.id, 9);
    expect(res.rejectedCount).toBeGreaterThanOrEqual(1);

    const after = await repo.getById(created.id);
    expect(after.status).toBe(PERMISSION_REQUEST_STATUS.REJECTED);
  });
});
