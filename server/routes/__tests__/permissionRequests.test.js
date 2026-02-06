const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken, grantTestPermission } = require('../../test-utils');
const PermissionRequest = require('../../models/PermissionRequest');

describe('PermissionRequest Routes', () => {
  let requester, requesterToken;
  let owner, ownerToken;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    
    // Create requester
    requester = await createTestUser({
      username: 'requester',
      email: 'requester@example.com',
      status: 'approved',
    });
    requesterToken = createTestToken(requester);

    // Create owner
    owner = await createTestUser({
      username: 'owner',
      email: 'owner@example.com',
      status: 'approved',
    });
    ownerToken = createTestToken(owner);

    // Grant owner permission to their folder
    await grantTestPermission(owner.id, '/owner', 'admin');
  });

  describe('POST /api/permission-requests (P4: 권한 요청 생성)', () => {
    it('fails without folder path', async () => {
      const response = await request(app)
        .post('/api/permission-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedPermission: 'read',
        });

      expect(response.status).toBe(400);
    });

    it('fails without authentication', async () => {
      const response = await request(app)
        .post('/api/permission-requests')
        .send({
          folderPath: '/owner/shared',
          requestedPermission: 'read',
        });

      expect(response.status).toBe(401);
    });
  });

  // Helper to create permission request with proper payload format
  const createPermRequest = async () => {
    return await PermissionRequest.create({
      requesterId: requester.id,
      requesterUsername: requester.username,
      ownerId: owner.id,
      ownerUsername: owner.username,
      folderPath: '/owner/shared',
      requestedPermission: 'read',
      message: 'Please give access',
    });
  };

  describe('GET /api/permission-requests/inbox (수신함)', () => {
    it('returns requests received by owner', async () => {
      await createPermRequest();

      const response = await request(app)
        .get('/api/permission-requests/inbox')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      // Check that request has expected properties (snake_case)
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('folder_path');
    });

    it('returns empty list when no requests', async () => {
      const response = await request(app)
        .get('/api/permission-requests/inbox')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/permission-requests/outbox (발신함)', () => {
    it('returns requests sent by requester', async () => {
      await createPermRequest();

      const response = await request(app)
        .get('/api/permission-requests/outbox')
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('id');
    });
  });

  describe('POST /api/permission-requests/:id/approve (P5: 승인)', () => {
    it('approves a permission request', async () => {
      const permRequest = await createPermRequest();

      const response = await request(app)
        .post(`/api/permission-requests/${permRequest.id}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);

      // Verify status changed
      const updated = await PermissionRequest.findById(permRequest.id);
      expect(updated.status).toBe('approved');
    });

    it('fails if not the owner', async () => {
      const permRequest = await createPermRequest();

      const response = await request(app)
        .post(`/api/permission-requests/${permRequest.id}/approve`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(response.status).toBe(403);
    });

    it('returns 404 for non-existent request', async () => {
      const response = await request(app)
        .post('/api/permission-requests/99999/approve')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/permission-requests/:id/reject (P6: 거절)', () => {
    it('rejects a permission request', async () => {
      const permRequest = await createPermRequest();

      const response = await request(app)
        .post(`/api/permission-requests/${permRequest.id}/reject`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);

      // Verify status changed
      const updated = await PermissionRequest.findById(permRequest.id);
      expect(updated.status).toBe('rejected');
    });
  });

  describe('POST /api/permission-requests/:id/cancel (요청 취소)', () => {
    it('cancels own permission request', async () => {
      const permRequest = await createPermRequest();

      const response = await request(app)
        .post(`/api/permission-requests/${permRequest.id}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(response.status).toBe(200);

      // Verify status changed
      const updated = await PermissionRequest.findById(permRequest.id);
      expect(updated.status).toBe('cancelled');
    });

    it('fails if not the requester', async () => {
      const permRequest = await createPermRequest();

      const response = await request(app)
        .post(`/api/permission-requests/${permRequest.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(403);
    });
  });
});
