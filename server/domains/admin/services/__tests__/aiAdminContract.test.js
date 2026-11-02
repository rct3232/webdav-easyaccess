'use strict';

/**
 * Shared admin-AI contract parity (routes/admin.md §2.2.7,
 * AiAdminContent.md §2.4): the server summary and the sentinel fixture must
 * both satisfy the single manifest the client render matrix consumes.
 */

const {
  AI_ADMIN_FAILED_JOB_LIMIT,
  AI_ADMIN_NOT_INSTRUMENTED,
  validateAiAdminPreview,
  validateAiAdminSummary,
} = require('@webdav-easyaccess/shared/aiAdminContract');
const {
  createAiAdminPanelFixture,
  createAiAdminPreviewFixture,
} = require('@webdav-easyaccess/shared/fixtures/aiAdminPanel.fixture');
const { createAiAdminService } = require('../aiAdminService');

function buildService() {
  const listFailed = jest.fn(async () => []);
  const service = createAiAdminService({
    actionJournalStore: {
      async listBySubject() {
        return [];
      },
    },
    aiJobsStore: {
      async countByStatus() {
        return { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 };
      },
      listFailed,
      async countFailedSince() {
        return 0;
      },
      async countFinishedSince() {
        return 0;
      },
      async countActiveByIds() {
        return 0;
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
    llmModelsStore: {
      async getActiveByRole() {
        return null;
      },
      async listByRole() {
        return [];
      },
    },
    fileNodesStore: {
      async getChildren() {
        return [];
      },
      async listSubtreeCacheRows() {
        return [];
      },
    },
    probeState: {
      getCapabilityEntries() {
        return [];
      },
      isCapabilityEnabled() {
        return false;
      },
    },
    resolver: {
      async getEffectiveConfig() {
        return {};
      },
    },
    generationSettings: {
      getGenerations: async () => ({ embed: 1, features: 1, caption: 1, asr: 1 }),
      GENERATION_KINDS: ['embed', 'features', 'caption', 'asr'],
      bumpGenerationsTx: async () => ({}),
    },
  });
  return { service, listFailed };
}

describe('admin AI contract parity', () => {
  it('the shared sentinel fixture satisfies both manifests', () => {
    expect(validateAiAdminSummary(createAiAdminPanelFixture())).toEqual([]);
    expect(validateAiAdminPreview(createAiAdminPreviewFixture())).toEqual([]);
  });

  it('the service summary satisfies the shared manifest and caps failed jobs at 20', async () => {
    const { service, listFailed } = buildService();
    const summary = await service.getSummary();
    expect(validateAiAdminSummary(summary)).toEqual([]);
    expect(summary.not_instrumented).toEqual([...AI_ADMIN_NOT_INSTRUMENTED]);
    expect(summary.not_instrumented).not.toContain('degraded_input_histogram');
    expect(listFailed).toHaveBeenCalledWith({ limit: 20 });
  });

  it('the preview satisfies the shared manifest and reports the failed-job cap', async () => {
    const preview = await buildService().service.getReembedPreview();
    expect(validateAiAdminPreview(preview)).toEqual([]);
    expect(AI_ADMIN_FAILED_JOB_LIMIT).toBe(20);
  });
});
