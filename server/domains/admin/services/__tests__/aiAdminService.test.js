'use strict';

/**
 * AI admin snapshot + launcher service (routes/admin.md §2.2.7). Real
 * ai_jobs/settings/journal stores; only provider-adjacent reads are faked.
 */

const { createTestDatabase, createTestFileNode, dbRun } = require('@server/test-utils');
const actionJournalStore = require('@server/store/actionJournalStore');
const aiJobsStore = require('@server/store/aiJobsStore');
const { JOURNAL_DOMAIN } = require('@webdav-easyaccess/shared/constants');
const { createAiAdminService, AI_REEMBED_SUBJECT } = require('../aiAdminService');
const { GENERATION_KINDS, generationKey } = require('../../../ai/generationSettings');

let textRows = [];

const models = {
  embed: {
    id: 5,
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    precision: 'q4',
    modelRevision: 'rev',
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
    reasoning: 'off',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

function buildService(rows = textRows) {
  return createAiAdminService({
    fileNodesStore: {
      async getChildren() {
        return [{ id: 900 }];
      },
      async listSubtreeCacheRows() {
        return rows;
      },
      async getUserRootNode() {
        return { id: 901 };
      },
    },
    embeddingsStore: {
      async getByNodeIds(ids) {
        return [
          { nodeId: rows[0].nodeId, modelId: 5, source: 'fulltext' },
          { nodeId: rows[2].nodeId, modelId: 4, source: 'chunk_pool' },
        ].filter((row) => ids.includes(row.nodeId));
      },
    },
    aiEnrichmentsStore: {
      async getByNodeIds() {
        return [];
      },
    },
    llmModelsStore: {
      async getActiveByRole(role) {
        return models[role] || null;
      },
      async listByRole(role) {
        return models[role] ? [models[role]] : [];
      },
    },
    aiUsageDailyStore: {
      async getByDay() {
        return [
          {
            day: '2026-01-01',
            role: 'embed',
            calls: 3,
            inputChars: 120,
            cached: 1,
            degraded: 0,
            failed429: 1,
          },
        ];
      },
    },
    adminReportsStore: {
      async listReports() {
        return [
          {
            id: 7,
            kind: 'night_eval',
            status: 'ok',
            createdAt: '2026-01-02T03:00:00.000Z',
            payload: { passes: 'full', totals: { users: 4, collections: 11, merge_suggested: 2 } },
          },
        ];
      },
    },
    collectionsStore: {
      async listMergeSuggestions() {
        return [{ id: 1 }, { id: 2 }];
      },
    },
    resolver: {
      async getEffectiveConfig() {
        return {
          AI_EVOLUTION_ENABLED: { value: 'true', source: 'db' },
          LLM_DAILY_CALL_CAP: { value: 100, source: 'default' },
          LLM_DAILY_TOKEN_CAP: { value: 0, source: 'default' },
        };
      },
    },
    probeState: {
      getCapabilityEntries: () => [{ capability: 'text_embed', enabled: true }],
      isCapabilityEnabled: () => false,
    },
  });
}

describe('aiAdminService', () => {
  let dbCleanup;
  let service;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(async () => {
    await dbRun('DELETE FROM ai_jobs');
    await dbRun('DELETE FROM action_journal');
    for (const kind of GENERATION_KINDS) {
      await dbRun('DELETE FROM settings WHERE key = ?', [generationKey(kind)]);
    }
    await dbRun('DELETE FROM file_nodes');
    const a = await createTestFileNode({ name: 'private-a.txt' });
    const b = await createTestFileNode({ name: 'private-b.txt' });
    const c = await createTestFileNode({ name: 'private-photo.jpg' });
    textRows = [
      { nodeId: a.nodeId, type: 'file', name: 'private-a.txt', mimeType: 'text/plain' },
      { nodeId: b.nodeId, type: 'file', name: 'private-b.txt', mimeType: 'text/plain' },
      { nodeId: c.nodeId, type: 'file', name: 'private-photo.jpg', mimeType: 'image/jpeg' },
    ];
    service = buildService();
  });

  it('summary exposes queue, failed jobs (display-only), cost, evolution, models, coverage, gates and not-instrumented', async () => {
    const summary = await service.getSummary();

    expect(summary.pipeline.failed_jobs_display_only).toBe(true);
    expect(summary.pipeline.breaker_states.instrumented).toBe(false);
    expect(summary.pipeline.capabilities).toEqual([{ capability: 'text_embed', enabled: true }]);
    expect(summary.cost.roles[0]).toMatchObject({ role: 'embed', calls: 3, failed_429: 1 });
    expect(summary.cost.caps).toEqual({ call_cap: 100, token_cap: 0 });
    expect(summary.evolution.latest_night_eval.totals.users).toBe(4);
    expect(summary.evolution.pending_merge_suggestions).toBe(2);
    expect(summary.models.roles.find((row) => row.role === 'embed').active.id).toBe(5);
    expect(summary.models.profiles[0]).toMatchObject({
      model_id: 5,
      dim: 768,
      calibrated: false,
    });
    expect(summary.coverage.available).toBe(true);
    expect(summary.coverage.text.totals).toEqual({ files: 2, embedded: 1, missing: 1, stale: 0 });
    expect(summary.coverage.media.totals).toMatchObject({ media: 1, missing: 0, stale: 1 });
    expect(
      summary.gates.kill_switches.find((row) => row.key === 'AI_EVOLUTION_ENABLED')
    ).toMatchObject({
      value: 'true',
      source: 'db',
      impact: { metric: 'night_eval_users', count: 4 },
    });
    expect(summary.not_instrumented).toEqual(
      expect.arrayContaining([
        'survival_curves',
        'merge_accept_series',
        'per_version_history',
        'per_user_top_n',
      ])
    );
    expect(summary.launcher.available).toBe(true);
    expect(summary.launcher.generations).toEqual({ embed: 1, features: 1, caption: 1, asr: 1 });
    const payloadText = JSON.stringify(summary);
    expect(payloadText).not.toContain('private-a.txt');
    expect(payloadText).not.toContain('/private');
  });

  it('preview is read-only and returns deterministic text+media union counts', async () => {
    const preview = await service.getReembedPreview();
    expect(preview.plan).toEqual({ text_count: 1, media_count: 1, union_count: 2 });
    expect(preview.model_id).toBe(5);
    await expect(aiJobsStore.countByStatus()).resolves.toMatchObject({ pending: 0 });
  });

  it('launch journal + generation bump + enqueue commit atomically', async () => {
    const launched = await service.launchReembed({ actor: 1 });
    expect(launched.enqueued).toBe(2);
    expect(launched.job_ids).toHaveLength(2);
    expect(launched.generation).toBe(2);
    expect(launched.generations).toEqual({ embed: 2, features: 2, caption: 2, asr: 2 });
    expect(launched.model_id).toBe(5);
    expect(launched.undo.action_id).toBeGreaterThan(0);

    const journalRow = await actionJournalStore.getAction(launched.undo.action_id);
    expect(journalRow).toMatchObject({
      domain: JOURNAL_DOMAIN.SETTINGS,
      subject: AI_REEMBED_SUBJECT,
      action: 'ai-reembed',
    });
    expect(journalRow.payload.inverse).toEqual({
      op: 'cancel-ai-jobs',
      jobIds: launched.job_ids,
    });

    const counts = await aiJobsStore.countByStatus();
    expect(counts.pending).toBe(2);
    expect((await service.getSummary()).launcher.generations.embed).toBe(2);
  });

  it('the global single-active guard refuses a new launch while the previous ids are still queued', async () => {
    await service.launchReembed({ actor: 1 });

    await expect(service.launchReembed({ actor: 1 })).rejects.toMatchObject({
      message: 'alreadyActive',
      status: 409,
      params: { active_jobs: 2 },
    });
  });

  it('undo of the launcher row cancels only pending jobs and reports per-id outcomes', async () => {
    const launched = await service.launchReembed({ actor: 1 });
    // Claim one job: the running row wins, the other remains pending.
    const claimed = await aiJobsStore.claimNext();
    expect(launched.job_ids).toContain(claimed.id);

    const undo = await actionJournalStore.undoAction(launched.undo.action_id);
    expect(undo.undone).toBe(1);
    expect(undo.skipped).toEqual([{ reason: 'not_pending' }]);

    const rows = await Promise.all(launched.job_ids.map((id) => aiJobsStore.getById(id)));
    expect(rows.find((row) => row.id === claimed.id).status).toBe('running');
    expect(
      rows.filter((row) => row.id !== claimed.id).every((row) => row.status === 'cancelled')
    ).toBe(true);
  });

  it('no active embed model → 409 modelUnavailable and preview remains unavailable', async () => {
    const noModel = createAiAdminService({
      ...buildServiceDeps(),
      llmModelsStore: {
        async getActiveByRole() {
          return null;
        },
        async listByRole() {
          return [];
        },
      },
    });
    const preview = await noModel.getReembedPreview();
    expect(preview.available).toBe(false);
    expect(preview.model_id).toBeNull();
    await expect(noModel.launchReembed({ actor: 1 })).rejects.toMatchObject({
      message: 'modelUnavailable',
      status: 409,
    });
  });
});

function buildServiceDeps(rows = textRows) {
  return {
    fileNodesStore: {
      async getChildren() {
        return [{ id: 900 }];
      },
      async listSubtreeCacheRows() {
        return rows;
      },
    },
    embeddingsStore: {
      async getByNodeIds() {
        return [];
      },
    },
    aiEnrichmentsStore: {
      async getByNodeIds() {
        return [];
      },
    },
    llmModelsStore: {
      async getActiveByRole(role) {
        return models[role] || null;
      },
      async listByRole(role) {
        return models[role] ? [models[role]] : [];
      },
    },
    aiUsageDailyStore: {
      async getByDay() {
        return [];
      },
    },
    adminReportsStore: {
      async listReports() {
        return [];
      },
    },
    collectionsStore: {
      async listMergeSuggestions() {
        return [];
      },
    },
    resolver: {
      async getEffectiveConfig() {
        return {};
      },
    },
    probeState: {
      getCapabilityEntries: () => [],
      isCapabilityEnabled: () => false,
    },
  };
}
