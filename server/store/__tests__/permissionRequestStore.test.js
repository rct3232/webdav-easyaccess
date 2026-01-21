const PermissionRequest = require('../../models/PermissionRequest');
const { resetTestStore, teardownTestStore, createTestUser } = require('../../test-utils');

describe('permissionRequestStore', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('creates a permission request and de-dupes pending duplicates', async () => {
    const owner = await createTestUser({ username: 'owner', email: 'owner@example.com' });
    const requester = await createTestUser({ username: 'req', email: 'req@example.com' });

    const first = await PermissionRequest.create({
      requesterId: requester.id,
      requesterUsername: requester.username,
      ownerId: owner.id,
      ownerUsername: owner.username,
      folderPath: '/owner/project/',
      requestedPermission: 'read',
      message: 'please',
    });

    const second = await PermissionRequest.create({
      requesterId: requester.id,
      requesterUsername: requester.username,
      ownerId: owner.id,
      ownerUsername: owner.username,
      folderPath: '/owner/project', // same after normalization
      requestedPermission: 'read',
      message: 'ignored',
    });

    expect(second.id).toBe(first.id);

    const inbox = await PermissionRequest.listInbox(owner.id, { status: 'pending' });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].folder_path).toBe('/owner/project');
    expect(inbox[0].requested_permission).toBe('read');

    const outbox = await PermissionRequest.listOutbox(requester.id, { status: 'pending' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].id).toBe(first.id);
  });

  it('updates status and sets resolved metadata', async () => {
    const owner = await createTestUser({ username: 'owner', email: 'owner@example.com' });
    const requester = await createTestUser({ username: 'req', email: 'req@example.com' });

    const created = await PermissionRequest.create({
      requesterId: requester.id,
      requesterUsername: requester.username,
      ownerId: owner.id,
      ownerUsername: owner.username,
      folderPath: '/owner/project',
      requestedPermission: 'write',
      message: '',
    });

    expect(created.status).toBe('pending');
    expect(created.resolved_at).toBe('');
    expect(created.resolved_by).toBeNull();

    const updated = await PermissionRequest.updateStatus(created.id, { status: 'rejected', resolvedBy: owner.id });
    expect(updated.status).toBe('rejected');
    expect(typeof updated.resolved_at).toBe('string');
    expect(updated.resolved_at.length).toBeGreaterThan(0);
    expect(updated.resolved_by).toBe(owner.id);

    const inboxPending = await PermissionRequest.listInbox(owner.id, { status: 'pending' });
    expect(inboxPending).toHaveLength(0);

    const inboxAll = await PermissionRequest.listInbox(owner.id);
    expect(inboxAll).toHaveLength(1);
    expect(inboxAll[0].status).toBe('rejected');
  });
});

