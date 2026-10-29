'use strict';

/**
 * Settings-domain journal on PUT /api/admin/config (routes/config.md).
 * Real DB + real journal; only the resolver/User are test doubles.
 */

const request = require('supertest');
const express = require('express');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  dbQuery,
  dbRun,
} = require('../../../../test-utils');
const settingsStore = require('../../../../store/settingsStore');
const actionJournalStore = require('../../../../store/actionJournalStore');
const { setSharedResolver } = require('../../../../infrastructure/configResolver');
const { errorHandler } = require('../../../../utils/errorHandler');
const { JOURNAL_DOMAIN } = require('@webdav-easyaccess/shared/constants');

let app;
let dbCleanup;
let token;
let invalidateCache;

function buildResolver() {
  return {
    async getEffectiveConfig() {
      return {
        AI_EVOLUTION_ENABLED: { value: 'true', source: 'db', tier: 'T2', secret: false },
        LLM_CHAT_API_KEY: { value: '****', source: 'db', tier: 'T2', secret: true },
      };
    },
    getConfigSync: (key) => (key === 'JWT_EXPIRES_IN' ? '30m' : undefined),
    invalidateCache: (...args) => invalidateCache(...args),
  };
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  invalidateCache = jest.fn();
  setSharedResolver(buildResolver());
  const ctx = await createAuthenticatedTestUser({
    username: `ai-journal-${Date.now()}`,
    isAdmin: true,
  });
  token = ctx.token;

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../config'));
  app.use('/api/actions', require('../../../actions/routes'));
  app.use(errorHandler);
});

afterAll(async () => {
  setSharedResolver(null);
  await dbCleanup?.();
});

beforeEach(async () => {
  await dbRun('DELETE FROM action_journal');
  await dbRun(
    "DELETE FROM settings WHERE key IN ('AI_EVOLUTION_ENABLED','AI_MERGE_ARBITER_ENABLED','LLM_CHAT_API_KEY')"
  );
  invalidateCache.mockClear();
});

const putConfig = (values) =>
  request(app).put('/api/admin/config').set('Authorization', `Bearer ${token}`).send({ values });

describe('PUT /api/admin/config settings journal', () => {
  it('journals a curated key with the previous value and undo restores it', async () => {
    await settingsStore.set('AI_EVOLUTION_ENABLED', 'true');

    const res = await putConfig({ AI_EVOLUTION_ENABLED: 'false' });
    expect(res.status).toBe(200);
    await expect(settingsStore.get('AI_EVOLUTION_ENABLED')).resolves.toBe('false');

    const { rows } = await dbQuery(
      "SELECT * FROM action_journal WHERE domain = 'settings' ORDER BY id DESC LIMIT 1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('settings:AI_EVOLUTION_ENABLED');
    expect(JSON.parse(rows[0].payload).inverse).toEqual({
      op: 'set-setting',
      key: 'AI_EVOLUTION_ENABLED',
      value: 'true',
    });

    const undo = await actionJournalStore.undoAction(Number(rows[0].id));
    expect(undo.undone).toBe(1);
    await expect(settingsStore.get('AI_EVOLUTION_ENABLED')).resolves.toBe('true');
    expect(invalidateCache).toHaveBeenCalledWith(['AI_EVOLUTION_ENABLED']);
  });

  it('undo removes a setting row that did not exist before the write', async () => {
    await expect(settingsStore.get('AI_MERGE_ARBITER_ENABLED')).resolves.toBeNull();
    const res = await putConfig({ AI_MERGE_ARBITER_ENABLED: 'false' });
    expect(res.status).toBe(200);
    await expect(settingsStore.get('AI_MERGE_ARBITER_ENABLED')).resolves.toBe('false');

    const { rows } = await dbQuery(
      "SELECT * FROM action_journal WHERE subject = 'settings:AI_MERGE_ARBITER_ENABLED'"
    );
    const undo = await actionJournalStore.undoAction(Number(rows[0].id));
    expect(undo.undone).toBe(1);
    await expect(settingsStore.get('AI_MERGE_ARBITER_ENABLED')).resolves.toBeNull();
  });

  it('never journals secret keys', async () => {
    const res = await putConfig({ LLM_CHAT_API_KEY: 'super-secret' });
    expect(res.status).toBe(200);
    const { rows } = await dbQuery("SELECT * FROM action_journal WHERE domain = 'settings'");
    expect(rows).toEqual([]);
    await expect(settingsStore.get('LLM_CHAT_API_KEY')).resolves.toBe('super-secret');
  });

  it('the journal payload never contains the secret value', async () => {
    await settingsStore.set('AI_EVOLUTION_ENABLED', 'true');
    await putConfig({ AI_EVOLUTION_ENABLED: 'false', LLM_CHAT_API_KEY: 'super-secret' });
    const { rows } = await dbQuery("SELECT * FROM action_journal WHERE domain = 'settings'");
    expect(rows.every((row) => !String(row.payload).includes('super-secret'))).toBe(true);
  });

  it('exposes a settings-domain feed row that the undo route can consume', async () => {
    await putConfig({ AI_EVOLUTION_ENABLED: 'false' });
    const { rows } = await dbQuery('SELECT subject, status FROM action_journal WHERE domain = ?', [
      JOURNAL_DOMAIN.SETTINGS,
    ]);
    expect(rows).toEqual([{ subject: 'settings:AI_EVOLUTION_ENABLED', status: 'applied' }]);

    const feed = await request(app)
      .get('/api/actions?domain=settings')
      .set('Authorization', `Bearer ${token}`);
    expect(feed.status).toBe(200);
    expect(feed.body.actions).toHaveLength(1);
    expect(feed.body.actions[0]).toMatchObject({
      domain: 'settings',
      subject: 'settings:AI_EVOLUTION_ENABLED',
      status: 'applied',
      undo_available: true,
    });
    expect(feed.body.actions[0]).not.toHaveProperty('payload');

    const undoTarget = await request(app)
      .post(`/api/actions/${feed.body.actions[0].action_id}/undo`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(undoTarget.status).toBe(200);
    expect(undoTarget.body.status).toBe('undone');
    expect(undoTarget.body.items_undone).toBe(1);
  });
});
