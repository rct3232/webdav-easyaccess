import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

function summaryFixture() {
  return {
    generated_at: '2026-01-01T00:00:00.000Z',
    pipeline: {
      queue: { pending: 2, running: 1, done: 3, failed: 1, skipped: 0, cancelled: 1, total: 8 },
      failed_24h: 1,
      finished_24h: 4,
      failure_rate_24h: 0.25,
      failed_jobs: [
        {
          id: 9,
          node_id: 44,
          kind: 'embed',
          generation: 2,
          status: 'failed',
          attempt: 3,
          last_error: 'provider timeout',
          created_at: '2026-01-01T00:00:00.000Z',
          started_at: null,
          finished_at: '2026-01-01T00:05:00.000Z',
        },
      ],
      failed_jobs_display_only: true,
      capabilities: [{ capability: 'text_embed', enabled: true }],
      breaker_states: { instrumented: false, reason: 'active_observation_required' },
    },
    cost: {
      day: '2026-01-01',
      roles: [{ role: 'embed', calls: 4, input_chars: 100, cached: 1, degraded: 0, failed_429: 2 }],
      caps: { call_cap: 100, token_cap: 0 },
      per_user_top_n: { instrumented: false },
    },
    evolution: {
      latest_night_eval: {
        id: 3,
        status: 'ok',
        created_at: '2026-01-01T03:00:00.000Z',
        totals: { users: 2, collections: 6, merge_suggested: 1 },
      },
      pending_merge_suggestions: 4,
      not_instrumented: ['survival_curves'],
    },
    models: {
      roles: [
        { role: 'embed', active: { id: 5, model_name: 'eg2', engine: 'embedded' }, history: [] },
      ],
      profiles: [{ role: 'embed', model_id: 5, dim: 768, calibrated: false, pooling: 'mean' }],
    },
    coverage: {
      available: true,
      model_id: 5,
      text: { totals: { files: 5, embedded: 3, missing: 1, stale: 1 }, by_source: { fulltext: 3 } },
      media: {
        totals: { media: 2, embedded: 1, missing: 1, stale: 0 },
        by_source: { media_direct: 1, missing: 1 },
        by_media_kind: { image: { media: 2, embedded: 1, missing: 1, stale: 0 } },
        by_capability: { enabled: 2, disabled: 0 },
        by_corpus: { caption: 0, transcript: 0, none: 2 },
      },
    },
    gates: {
      kill_switches: [
        {
          key: 'AI_EVOLUTION_ENABLED',
          value: 'true',
          source: 'db',
          impact: { metric: 'night_eval_users', count: 2 },
        },
      ],
      gates: [
        {
          key: 'AI_EVOLUTION_INACTIVE_DAYS',
          value: '30',
          source: 'default',
          impact: { metric: 'night_eval_users', count: 2 },
        },
      ],
    },
    launcher: {
      available: true,
      reason: null,
      active_jobs: 0,
      active_model_id: 5,
      generations: { embed: 2, features: 2, caption: 2, asr: 2 },
    },
    not_instrumented: ['survival_curves', 'merge_accept_series', 'per_version_history'],
  };
}

const journalRow = {
  action_id: 77,
  domain: 'settings',
  subject: 'settings:AI_EVOLUTION_ENABLED',
  action: 'config-update',
  status: 'applied',
  undo_available: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('AiAdminContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPanel.summary = summaryFixture();
    mockPanel.preview = null;
    mockPanel.journal = [journalRow];
    mockPanel.loading = false;
    mockPanel.error = null;
    mockPanel.busyKey = null;
  });

  it('renders the operations blocks, display-only failed jobs and not-instrumented series', () => {
    renderWithProviders(<AiAdminContent />);

    expect(screen.getByTestId('ai-admin-content')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-cost')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-evolution')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-models')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-coverage')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-gates')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-launcher')).toBeInTheDocument();
    expect(screen.getByTestId('ai-section-journal')).toBeInTheDocument();
    expect(screen.getByTestId('ai-kill-switches')).toBeInTheDocument();

    expect(screen.getByText(/Display only/i)).toBeInTheDocument();
    expect(screen.getByText('provider timeout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/not instrumented/i).length).toBeGreaterThan(0);
    expect(screen.getByText('settings:AI_EVOLUTION_ENABLED · config-update')).toBeInTheDocument();
  });

  it('saves kill switches and gate values through the hook', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AiAdminContent />);

    await user.click(screen.getByRole('switch'));
    expect(mockPanel.saveSettings).toHaveBeenCalledWith({ AI_EVOLUTION_ENABLED: 'false' });

    const row = screen.getByTestId('gate-row-AI_EVOLUTION_INACTIVE_DAYS');
    const input = within(row).getByTestId('gate-input-AI_EVOLUTION_INACTIVE_DAYS');
    await user.clear(input);
    await user.type(input, '45');
    await user.click(within(row).getByRole('button', { name: /save/i }));
    expect(mockPanel.saveSettings).toHaveBeenCalledWith({ AI_EVOLUTION_INACTIVE_DAYS: '45' });
  });

  it('previews, confirms once, and launches the re-embed; progress points at the queue', async () => {
    const user = userEvent.setup();
    mockPanel.loadPreview.mockResolvedValue({
      plan: { text_count: 1, media_count: 1, union_count: 2 },
    });
    mockPanel.launch.mockResolvedValue({ enqueued: 2, generation: 3 });
    mockPanel.preview = { plan: { text_count: 1, media_count: 1, union_count: 2 } };
    renderWithProviders(<AiAdminContent />);

    await user.click(screen.getByRole('button', { name: /^preview$/i }));
    expect(mockPanel.loadPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('reembed-preview')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /launch re-embed/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(mockPanel.launch).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Re-embed launched/i)).toBeInTheDocument();
  });

  it('undoes a settings journal row', async () => {
    const user = userEvent.setup();
    mockPanel.undoJournal.mockResolvedValue({ status: 'undone' });
    renderWithProviders(<AiAdminContent />);

    await user.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(mockPanel.undoJournal).toHaveBeenCalledWith(77);
  });
});
