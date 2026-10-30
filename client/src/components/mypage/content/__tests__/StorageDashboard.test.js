/**
 * StorageDashboard (MyPage `Storage`) tests — storage client-domain split.
 * Blocks per docs/spec/client/components/mypage/content/StorageDashboard.md §2.3
 * + §2.3.1: storage-usage summary/sparkline, hygiene cards (deep-link, never
 * action center), cleanup suggestions checklist. Collection status/journal
 * blocks are CollectionsOverview-owned and must never render here.
 * IO flows exclusively through the injected gateway seam (failure-absorbing
 * storageRepository shapes — the component sees fallbacks, never rejections).
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../../../test-utils';
import MyPageContentPanel from '../../MyPageContentPanel';
import StorageDashboard from '../StorageDashboard';

const user = { id: '4', username: 'testuser', is_admin: false };

const suggestionRow = (overrides = {}) => ({
  node_id: 90211,
  kind: 'exact_dup',
  path: '/testuser/photos/beach copy.jpg',
  size_bytes: 2048,
  reason: { kind: 'exact_dup', keep_node_id: 90210 },
  ...overrides,
});

const current = (overrides = {}) => ({
  total_bytes: 5242880,
  live_bytes: 4194304,
  trash_bytes: 524288,
  versions_bytes: 524288,
  version_history_supported: true,
  incomplete: false,
  ...overrides,
});

function makeGateway(overrides = {}) {
  return {
    getStorageHygiene: jest.fn().mockResolvedValue({
      hygiene: {
        duplicates: { group_count: 0, duplicate_count: 0, reclaimable_bytes: 0 },
        trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
      },
      suggestions: [],
    }),
    getStorageUsage: jest.fn().mockResolvedValue(null),
    acceptStorageSuggestions: jest.fn().mockResolvedValue({
      trashed: [],
      rejected_not_owned: [],
      skipped: [],
    }),
    dismissStorageSuggestion: jest.fn().mockResolvedValue({ id: 901, state: 'dismissed' }),
    undoAction: jest.fn().mockResolvedValue({ ok: true, itemsUndone: 1, itemsSkipped: 0 }),
    // Collection-owned seams: StorageDashboard must not call them.
    getActions: jest.fn().mockResolvedValue({ actions: [] }),
    loadCollections: jest.fn().mockResolvedValue({ collections: [] }),
    getGrants: jest.fn().mockResolvedValue({ grants: [] }),
    revokeGrant: jest.fn().mockResolvedValue({ revoked: true }),
    ...overrides,
  };
}

const renderDashboard = (props = {}) => {
  const gateway = props.gateway || makeGateway();
  const helpers = renderWithProviders(
    <MyPageContentPanel>
      <StorageDashboard user={user} gateway={gateway} onNavigate={jest.fn()} {...props} />
    </MyPageContentPanel>
  );
  return { gateway, ...helpers };
};

describe('StorageDashboard — block assembly', () => {
  it('renders the storage dashboard and hides zero/absent blocks (absent-not-disabled)', async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('storage-dashboard')).toBeInTheDocument());

    expect(screen.queryByText(/exact duplicates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/system changes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/collections status/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('storage-usage-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('storage-usage-sparkline')).not.toBeInTheDocument();
  });

  it('reads only the storage seams — no collection/actions IO', async () => {
    const { gateway } = renderDashboard();

    await waitFor(() => expect(screen.getByTestId('storage-dashboard')).toBeInTheDocument());

    expect(gateway.getStorageHygiene).toHaveBeenCalled();
    expect(gateway.getStorageUsage).toHaveBeenCalled();
    expect(gateway.getActions).not.toHaveBeenCalled();
    expect(gateway.loadCollections).not.toHaveBeenCalled();
    expect(gateway.getGrants).not.toHaveBeenCalled();
  });

  it('absorbed repository fallbacks never crash the panel', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue({ suggestions: [] }),
      getStorageUsage: jest.fn().mockResolvedValue(null),
    });

    renderDashboard({ gateway });

    await waitFor(() => expect(screen.getByTestId('storage-dashboard')).toBeInTheDocument());
    expect(screen.queryByText(/exact duplicates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/purged in/i)).not.toBeInTheDocument();
  });

  it('accepts a flat legacy hygiene payload (duplicates/trash/suggestions at the root)', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue({
        duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 2048 },
        suggestions: [suggestionRow()],
        trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
      }),
    });

    renderDashboard({ gateway });

    expect(await screen.findByTestId('storage-hygiene-duplicates')).toBeInTheDocument();
    expect(screen.getByTestId('storage-hygiene-suggestions')).toBeInTheDocument();
  });
});

describe('StorageDashboard — storage usage summary', () => {
  it('renders total/live/trash/versions and no quota/percent copy', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest.fn().mockResolvedValue({ current: current(), series: { points: [] } }),
    });

    renderDashboard({ gateway });

    const summary = await screen.findByTestId('storage-usage-summary');
    expect(within(summary).getByText(/^total$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/^live$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/^trash$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/^versions$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/5 MB/i)).toBeInTheDocument();
    // Observable breakdown rows carry stable testids (E2E-S3-STORAGE-001).
    expect(screen.getByTestId('storage-usage-total')).toHaveTextContent(/5 MB/i);
    expect(screen.getByTestId('storage-usage-live')).toHaveTextContent(/4 MB/i);
    expect(screen.getByTestId('storage-usage-trash')).toHaveTextContent(/512 KB/i);
    expect(screen.getByTestId('storage-usage-versions')).toHaveTextContent(/512 KB/i);
    expect(screen.queryByText(/quota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('hides the versions line when version_history_supported is false', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest.fn().mockResolvedValue({
        current: current({ version_history_supported: false }),
        series: { points: [] },
      }),
    });

    renderDashboard({ gateway });

    const summary = await screen.findByTestId('storage-usage-summary');
    expect(within(summary).queryByText(/^versions$/i)).not.toBeInTheDocument();
    expect(within(summary).getByText(/^live$/i)).toBeInTheDocument();
  });

  it('renders the incomplete warning only when the payload flags it', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest
        .fn()
        .mockResolvedValue({ current: current({ incomplete: true }), series: { points: [] } }),
    });

    renderDashboard({ gateway });

    expect(await screen.findByTestId('storage-usage-incomplete')).toHaveTextContent(
      /may be incomplete/i
    );
  });
});

describe('StorageDashboard — storage-usage sparkline', () => {
  const series = (points) => ({ current: current(), series: { points } });

  it('renders the sparkline when the seam returns at least two points', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest.fn().mockResolvedValue(
        series([
          { day: '2026-10-01', bytes: 100 },
          { day: '2026-10-02', bytes: 200 },
        ])
      ),
    });

    renderDashboard({ gateway });

    expect(await screen.findByTestId('storage-usage-sparkline')).toBeInTheDocument();
    expect(gateway.getStorageUsage).toHaveBeenCalled();
  });

  it('places points by actual day spacing (a two-day gap is wider than a one-day gap)', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest.fn().mockResolvedValue(
        series([
          { day: '2026-10-01', bytes: 100 },
          { day: '2026-10-02', bytes: 100 },
          { day: '2026-10-04', bytes: 100 },
        ])
      ),
    });

    renderDashboard({ gateway });

    const sparkline = await screen.findByTestId('storage-usage-sparkline');
    const polyline = sparkline.querySelector('polyline');
    const xs = polyline
      .getAttribute('points')
      .split(' ')
      .map((pair) => Number(pair.split(',')[0]));

    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1]).toBeCloseTo(100 / 3);
    expect(xs[2]).toBeCloseTo(100);
  });

  it('omits the block for a single point (no fabricated trend)', async () => {
    const gateway = makeGateway({
      getStorageUsage: jest.fn().mockResolvedValue(series([{ day: '2026-10-01', bytes: 100 }])),
    });

    renderDashboard({ gateway });

    await waitFor(() => expect(gateway.getStorageUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('storage-usage-sparkline')).not.toBeInTheDocument();
  });

  it('omits the block when the absorbed read falls back to null', async () => {
    const gateway = makeGateway({ getStorageUsage: jest.fn().mockResolvedValue(null) });

    renderDashboard({ gateway });

    await waitFor(() => expect(gateway.getStorageUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('storage-usage-sparkline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('storage-usage-summary')).not.toBeInTheDocument();
  });
});

describe('StorageDashboard — hygiene cards', () => {
  it('renders dup/trash/suggestion cards and deep-links WITHOUT mutating', async () => {
    const onNavigate = jest.fn();
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue({
        hygiene: {
          duplicates: { group_count: 2, duplicate_count: 5, reclaimable_bytes: 4718592 },
          trash: {
            item_count: 3,
            total_bytes: 98765,
            oldest_deleted_at: new Date(Date.now() - 5 * 86400000).toISOString(),
            retention_days: 30,
          },
        },
        suggestions: [suggestionRow(), suggestionRow({ node_id: 90300 })],
      }),
    });

    renderDashboard({ gateway, onNavigate });

    const dupCard = await screen.findByTestId('storage-hygiene-duplicates');
    expect(dupCard).toHaveTextContent(/2 groups/i);
    expect(dupCard).toHaveTextContent(/4.5 MB/i);
    expect(screen.getByTestId('storage-hygiene-trash')).toHaveTextContent(/purged in ~25d/i);
    expect(screen.getByTestId('storage-hygiene-suggestions')).toHaveTextContent(/2 rows/i);

    await userEvent.click(screen.getByTestId('storage-hygiene-trash'));
    expect(onNavigate).toHaveBeenCalledWith('/files/__trash__');

    // dup card is a pull-overview: scrolls to the suggestions block, mutates nothing
    await userEvent.click(dupCard);
    expect(onNavigate).not.toHaveBeenCalledWith('/files/duplicates');
    expect(gateway.acceptStorageSuggestions).not.toHaveBeenCalled();
  });

  it('renders the near-dup card line + near_dup checklist rows when the payload carries them', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue({
        hygiene: {
          duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 2048 },
          near_duplicates: { group_count: 1, duplicate_count: 2 },
          trash: {
            item_count: 0,
            total_bytes: 0,
            oldest_deleted_at: null,
            retention_days: 30,
          },
        },
        suggestions: [
          suggestionRow(),
          suggestionRow({
            node_id: 90321,
            kind: 'near_dup',
            path: '/testuser/docs/report v2.pdf',
            size_bytes: 1048576,
            reason: { kind: 'near_dup', keep_node_id: 90320 },
          }),
        ],
      }),
    });

    renderDashboard({ gateway });

    const dupCard = await screen.findByTestId('storage-hygiene-duplicates');
    expect(dupCard).toHaveTextContent(/near-duplicates/i);
    expect((await screen.findAllByText(/report v2\.pdf/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/near duplicate/i).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('suggestion-checkbox')).toHaveLength(2);
  });

  it('retention 0 renders the no-automatic-purge note instead of a countdown', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue({
        hygiene: {
          duplicates: { group_count: 0, duplicate_count: 0, reclaimable_bytes: 0 },
          trash: {
            item_count: 1,
            total_bytes: 10,
            oldest_deleted_at: new Date().toISOString(),
            retention_days: 0,
          },
        },
        suggestions: [],
      }),
    });

    renderDashboard({ gateway });

    expect(await screen.findByTestId('storage-hygiene-trash')).toHaveTextContent(
      /no automatic purge/i
    );
  });
});

describe('StorageDashboard — suggestions block', () => {
  const persistedRow = (overrides = {}) => ({
    id: 901,
    node_id: 101,
    kind: 'exact_dup',
    path: '/testuser/photos/beach copy.jpg',
    size_bytes: 2048,
    reason: { kind: 'exact_dup', keep_node_id: 100 },
    created_at: '2025-10-01T03:00:00Z',
    expires_at: '2025-10-31T03:00:00Z',
    ...overrides,
  });

  const suggestionsPayload = (rows) => ({
    hygiene: {
      duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 2048 },
      trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
    },
    suggestions: rows,
  });

  it('accept with a journaled command shows the UNDO toast and the action undoes via the gateway', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest
        .fn()
        .mockResolvedValue(
          suggestionsPayload([persistedRow(), persistedRow({ id: 902, node_id: 102 })])
        ),
      acceptStorageSuggestions: jest.fn().mockResolvedValue({
        trashed: [101],
        rejected_not_owned: [],
        skipped: [],
        undo: { action_id: 5501 },
      }),
    });

    renderDashboard({ gateway });

    const checkboxes = await screen.findAllByTestId('suggestion-checkbox');
    await userEvent.click(checkboxes[0]);
    await userEvent.click(screen.getByTestId('suggestions-accept'));

    await waitFor(() => expect(gateway.acceptStorageSuggestions).toHaveBeenCalledWith([101]));
    expect(await screen.findByText(/moved 1 items to trash/i)).toBeInTheDocument();
    const undoAction = screen.getByTestId('undo-toast-action');
    await userEvent.click(undoAction);
    await waitFor(() => expect(gateway.undoAction).toHaveBeenCalledWith(5501, {}));
  });

  it('accept WITHOUT an undo pointer stays a plain report toast', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest
        .fn()
        .mockResolvedValue(
          suggestionsPayload([persistedRow(), persistedRow({ id: 902, node_id: 102 })])
        ),
      acceptStorageSuggestions: jest
        .fn()
        .mockResolvedValue({ trashed: [101], rejected_not_owned: [], skipped: [] }),
    });

    renderDashboard({ gateway });

    const checkboxes = await screen.findAllByTestId('suggestion-checkbox');
    await userEvent.click(checkboxes[0]);
    await userEvent.click(screen.getByTestId('suggestions-accept'));

    expect(await screen.findByText(/moved 1 items to trash/i)).toBeInTheDocument();
    expect(screen.queryByTestId('undo-toast-action')).not.toBeInTheDocument();
    await waitFor(() => expect(gateway.getStorageHygiene).toHaveBeenCalledTimes(2));
  });

  it('wires per-row dismiss through the gateway seam and refreshes silently (no toast)', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue(suggestionsPayload([persistedRow()])),
      dismissStorageSuggestion: jest.fn().mockResolvedValue({ id: 901, state: 'dismissed' }),
    });

    renderDashboard({ gateway });

    const dismiss = await screen.findByTestId('suggestion-dismiss-901');
    await userEvent.click(dismiss);
    await waitFor(() => expect(gateway.dismissStorageSuggestion).toHaveBeenCalledWith(901));
    await waitFor(() => expect(gateway.getStorageHygiene).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('undo-toast-action')).not.toBeInTheDocument();
  });

  it('dismissed failure (absorbed null) keeps the row and skips the refresh', async () => {
    const gateway = makeGateway({
      getStorageHygiene: jest.fn().mockResolvedValue(suggestionsPayload([persistedRow()])),
      dismissStorageSuggestion: jest.fn().mockResolvedValue(null),
    });

    renderDashboard({ gateway });

    const dismiss = await screen.findByTestId('suggestion-dismiss-901');
    await userEvent.click(dismiss);
    await waitFor(() => expect(gateway.dismissStorageSuggestion).toHaveBeenCalledWith(901));
    expect(screen.getByTestId('suggestion-dismiss-901')).toBeInTheDocument();
    expect(gateway.getStorageHygiene).toHaveBeenCalledTimes(1);
  });

  it('absent suggestions data hides the block and its anchor entirely', async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('storage-dashboard')).toBeInTheDocument());
    expect(screen.queryByText(/suggestions$/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestions-accept')).not.toBeInTheDocument();
    expect(document.getElementById('storage-suggestions')).toBeNull();
  });
});
