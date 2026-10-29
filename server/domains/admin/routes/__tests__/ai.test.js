'use strict';

/**
 * Admin AI routes: summary/preview/reembed (routes/admin.md §2.2.7). Real DB,
 * real stores; no provider work (coverage is DB-derived).
 */

const request = require('supertest');
const express = require('express');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbRun,
} = require('../../../../test-utils');
const llmModelsStore = require('../../../../store/llmModelsStore');
const { setSharedResolver } = require('../../../../infrastructure/configResolver');
const { errorHandler } = require('../../../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

let app;
let dbCleanup;
let adminToken;
let userToken;

const fakeResolver = {
  async getEffectiveConfig() {
    return {
      AI_EVOLUTION_ENABLED: { value: 'true', source: 'default', tier: 'T2', secret: false },
      LLM_DAILY_CALL_CAP: { value: 0, source: 'default', tier: 'T2', secret: false },
      LLM_DAILY_TOKEN_CAP: { value: 0, source: 'default', tier: 'T2', secret: false },
    };
  },
  getConfigSync: (key) => (key === 'JWT_EXPIRES_IN' ? '30m' : undefined),
  invalidateCache: jest.fn(),
};

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  setSharedResolver(fakeResolver);
  const admin = await createAuthenticatedTestUser({
    username: `ai-admin-${Date.now()}`,
    isAdmin: true,
  });
  adminToken = admin.token;
  const user = await createAuthenticatedTestUser({ username: `ai-user-${Date.now()}` });
  userToken = user.token;

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../config'));
  app.use(errorHandler);
});

afterAll(async () => {
  setSharedResolver(null);
  await dbCleanup?.();
});

beforeEach(async () => {
  await dbRun('DELETE FROM ai_jobs');
  await dbRun('DELETE FROM action_journal');
  await dbRun('DELETE FROM settings');
  await dbRun('DELETE FROM llm_models');
});

async function seedEmbedModel() {
  return llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    modelRevision: 'test-rev',
    enabled: true,
  });
}

describe('admin AI routes', () => {
  it('requires the admin role', async () => {
    const res = await request(app)
      .get('/api/admin/ai/summary')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);
  });

  it('GET /api/admin/ai/summary returns the governance snapshot with unavailable coverage when no model exists', async () => {
    const res = await request(app)
      .get('/api/admin/ai/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pipeline.failed_jobs_display_only).toBe(true);
    expect(res.body.pipeline.breaker_states).toEqual({
      instrumented: false,
      reason: 'active_observation_required',
    });
    expect(res.body.coverage).toMatchObject({ available: false, model_id: null });
    expect(res.body.launcher.available).toBe(false);
    expect(res.body.launcher.reason).toBe('model_unavailable');
    expect(res.body.not_instrumented).toEqual(
      expect.arrayContaining([
        'survival_curves',
        'merge_accept_series',
        'per_version_history',
        'per_user_top_n',
      ])
    );
    expect(res.body.gates.kill_switches.length).toBeGreaterThan(0);
  });

  it('preview reports the deterministic plan and launch returns 429 params on the next call', async () => {
    await seedEmbedModel();
    await createTestFileNode({ name: `ai-route-${Date.now()}.txt` });

    const preview = await request(app)
      .get('/api/admin/ai/reembed/preview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.plan.union_count).toBeGreaterThanOrEqual(1);
    expect(preview.body.retry_after_seconds).toBe(0);

    const launched = await request(app)
      .post('/api/admin/ai/reembed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(launched.status).toBe(200);
    expect(launched.body.enqueued).toBeGreaterThanOrEqual(1);
    expect(launched.body.generation).toBe(2);
    expect(launched.body.undo.action_id).toBeGreaterThan(0);

    const second = await request(app)
      .post('/api/admin/ai/reembed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(second.status).toBe(429);
    expect(second.body.errorCode).toBe(SERVER_ERROR_CODES.admin.reembedRateLimited);
    expect(second.body.params.retry_after_seconds).toBeGreaterThan(0);
  });

  it('launch without an active embed model is a 409 modelUnavailable', async () => {
    const res = await request(app)
      .post('/api/admin/ai/reembed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.reembedModelUnavailable);
  });
});
