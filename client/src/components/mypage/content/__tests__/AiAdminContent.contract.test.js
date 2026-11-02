import React from 'react';
import { screen, within } from '@testing-library/react';

import {
  AI_ADMIN_SENTINELS,
  createAiAdminPanelFixture,
  createAiAdminPreviewFixture,
} from '@webdav-easyaccess/shared/fixtures/aiAdminPanel.fixture';
import { renderWithProviders } from '../../../../test-utils';
import AiAdminContent from '../AiAdminContent';

const mockPanel = {
  summary: null,
  preview: null,
  journal: [],
  journalError: null,
  loading: false,
  error: null,
  busyKey: null,
  refresh: jest.fn(),
  refreshJournal: jest.fn(),
  loadPreview: jest.fn(),
  launch: jest.fn(),
  saveSettings: jest.fn(),
  probeRoles: jest.fn().mockResolvedValue([]),
  undoJournal: jest.fn(),
};

jest.mock('../../../../pages/MyPage/hooks/useAiAdminPanel', () => ({
  useAiAdminPanel: () => mockPanel,
}));

jest.mock('../../../../contexts/PageHeaderContext', () => ({
  usePageHeader: () => ({ setTitle: jest.fn(), setActions: jest.fn() }),
}));

function setPanel({ summary = createAiAdminPanelFixture(), preview = null } = {}) {
  mockPanel.summary = summary;
  mockPanel.preview = preview;
  mockPanel.journal = [];
  mockPanel.journalError = null;
  mockPanel.loading = false;
  mockPanel.error = null;
  mockPanel.busyKey = null;
}

function metricValue(label) {
  const paragraphs = screen.getByText(label).closest('div').querySelectorAll('p');
  return paragraphs[paragraphs.length - 1];
}

describe('AiAdminContent contract sentinel matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPanel();
  });

  it('renders every summary scalar from the shared sentinel fixture', () => {
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('ai-generated-at')).toHaveTextContent(/2031/);
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.queueTotal))).toBeInTheDocument();
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.finished24h))).toBeInTheDocument();
    expect(
      screen.getByText(`${Math.round(AI_ADMIN_SENTINELS.failureRate * 100)}%`)
    ).toBeInTheDocument();
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.failed24h))).toBeInTheDocument();

    const failed = screen.getByTestId('failed-jobs-table');
    expect(within(failed).getByText(String(AI_ADMIN_SENTINELS.failedJobId))).toBeInTheDocument();
    expect(
      within(failed).getByText(String(AI_ADMIN_SENTINELS.failedJobNodeId))
    ).toBeInTheDocument();
    expect(within(failed).getByText('failed')).toBeInTheDocument();
    expect(within(failed).getByText(AI_ADMIN_SENTINELS.failedJobError)).toBeInTheDocument();

    expect(screen.getByText(String(AI_ADMIN_SENTINELS.costCalls))).toBeInTheDocument();
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.costDegraded))).toBeInTheDocument();
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.nightEvalUsers))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Pending merge suggestions: ${AI_ADMIN_SENTINELS.pendingMerges}`))
    ).toBeInTheDocument();

    expect(screen.getByTestId('model-history-row-8141')).toHaveTextContent(
      'sentinel-history-model'
    );
    expect(screen.getByText(/dtype bf16\|fp32/)).toBeInTheDocument();
    expect(screen.getByText(/mrl 768 · 512 · 256/)).toBeInTheDocument();
    expect(screen.getByText(/title: sentinel \| text:/)).toBeInTheDocument();

    expect(screen.getByTestId('coverage-text')).toHaveTextContent(
      String(AI_ADMIN_SENTINELS.textFiles)
    );
    expect(screen.getByTestId('coverage-text-by-source')).toHaveTextContent(
      `fulltext: ${AI_ADMIN_SENTINELS.textBySource}`
    );
    expect(screen.getByTestId('coverage-media')).toHaveTextContent(
      String(AI_ADMIN_SENTINELS.mediaFiles)
    );
    expect(screen.getByTestId('coverage-media-by-media-kind')).toHaveTextContent(
      `image: ${AI_ADMIN_SENTINELS.imageEmbedded}/${AI_ADMIN_SENTINELS.imageMedia}`
    );
    expect(screen.getByTestId('coverage-media-by-capability')).toHaveTextContent(
      `enabled ${AI_ADMIN_SENTINELS.capabilityEnabled}`
    );
    expect(screen.getByTestId('coverage-media-by-corpus')).toHaveTextContent(
      `caption ${AI_ADMIN_SENTINELS.corpusCaption}`
    );

    expect(screen.getByText(/night-eval users: 8180/)).toBeInTheDocument();
    expect(screen.getByText(/night-eval collections: 8181/)).toBeInTheDocument();
    expect(screen.getAllByText(/not instrumented/i).length).toBeGreaterThan(0);

    expect(screen.getByTestId('launcher-generations')).toHaveTextContent(
      String(AI_ADMIN_SENTINELS.generationEmbed)
    );
    expect(screen.getByTestId('launcher-generations')).toHaveTextContent(
      String(AI_ADMIN_SENTINELS.generationAsr)
    );
    expect(screen.getByText(String(AI_ADMIN_SENTINELS.activeJobs))).toBeInTheDocument();
  });

  it('renders preview plan counts only when the preview is available', () => {
    mockPanel.preview = createAiAdminPreviewFixture();
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('reembed-preview')).toHaveTextContent(
      `${AI_ADMIN_SENTINELS.previewText}`
    );
    expect(screen.getByTestId('reembed-preview')).toHaveTextContent(
      `${AI_ADMIN_SENTINELS.previewMedia}`
    );
    expect(screen.getByTestId('reembed-preview')).toHaveTextContent(
      `${AI_ADMIN_SENTINELS.previewUnion}`
    );
  });

  it('never renders 0/0/0 for an unavailable preview', () => {
    mockPanel.preview = createAiAdminPreviewFixture({
      available: false,
      reason: 'model_unavailable',
      model_id: null,
      plan: { text_count: 0, media_count: 0, union_count: 0 },
    });
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('reembed-preview-unavailable')).toHaveTextContent(
      /No active embedding model/i
    );
    expect(screen.queryByTestId('reembed-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /launch re-embed/i })).toBeDisabled();
  });

  it('keeps null values null-safe and labels an unknown kill switch', () => {
    const summary = createAiAdminPanelFixture({
      pipeline: {
        queue: { pending: null },
        failed_24h: null,
        finished_24h: null,
        failure_rate_24h: null,
        failed_jobs: [
          {
            created_at: null,
            finished_at: null,
            last_error: null,
            status: 'failed',
          },
        ],
      },
      coverage: {
        available: false,
        reason: 'model_unavailable',
        model_id: null,
        text: null,
        media: null,
      },
      gates: {
        kill_switches: [{ key: 'AI_EVOLUTION_ENABLED', value: null, source: 'default' }],
        gates: [
          {
            key: 'AI_EVOLUTION_INACTIVE_DAYS',
            value: null,
            source: 'default',
            impact: { metric: 'night_eval_users', count: null },
          },
        ],
      },
      launcher: { active_model_id: null },
    });
    setPanel({ summary, preview: null });
    renderWithProviders(<AiAdminContent />);

    expect(metricValue('Pending')).toHaveTextContent('—');
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/night-eval users: no data/i)).toBeInTheDocument();
    expect(screen.getByTestId('coverage-unavailable')).toHaveTextContent(
      /No active embedding model/i
    );
    expect(screen.getByTestId('failed-jobs-table')).toHaveTextContent('—');
  });

  it('drives not-instrumented labels from the API list instead of fixed copy', () => {
    const summary = createAiAdminPanelFixture({
      evolution: {
        not_instrumented: ['custom_series'],
      },
    });
    setPanel({ summary });
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('evolution-not-instrumented')).toHaveTextContent('custom_series');
  });

  it('separates a journal read error from an empty feed', () => {
    mockPanel.journalError = new Error('journal down');
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('journal-error')).toBeInTheDocument();
    expect(screen.queryByText(/No settings journal rows/i)).not.toBeInTheDocument();
  });
});
