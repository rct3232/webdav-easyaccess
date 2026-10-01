/**
 * CollectionDashboard (MyPage `Storage`) tests — T0.10.
 * Blocks per docs/spec/client/components/mypage/content/CollectionDashboard.md §2.3
 * + §2.3.1 as-built seams: hygiene cards (deep-link, never action center),
 * system-changes journal feed (undo + cascade), my-collections status,
 * SuggestionsChecklist, capacity sparkline (absent ⇒ omitted).
 * IO flows exclusively through the injected gateway seam (failure-absorbing
 * repository shapes — the component sees fallbacks, never rejections).
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../../../test-utils';
import MyPageContentPanel from '../../MyPageContentPanel';
import CollectionDashboard from '../CollectionDashboard';

const user = { id: '4', username: 'testuser', is_admin: false };

const actionRow = (overrides = {}) => ({
  action_id: 995,
  domain: 'collection',
  subject: 'collection:17',
  subject_label: 'Europe trip',
  actor: 4,
  action: 'merge',
  status: 'applied',
  chain_seq: 12,
  is_tip: true,
  undo_available: true,
  created_at: new Date().toISOString(),
  undone_at: null,
  expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  ...overrides,
});

const suggestionRow = (overrides = {}) => ({
  node_id: 90211,
  kind: 'exact_dup',
  path: '/testuser/photos/beach copy.jpg',
  size_bytes: 2048,
  reason: { kind: 'exact_dup', keep_node_id: 90210 },
  ...overrides,
});

function makeGateway(overrides = {}) {
  return {
    getFileSuggestions: jest.fn().mockResolvedValue({
      duplicates: { group_count: 0, duplicate_count: 0, reclaimable_bytes: 0 },
      suggestions: [],
      trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
    }),
    getActions: jest.fn().mockResolvedValue({ actions: [] }),
    loadCollections: jest.fn().mockResolvedValue({ collections: [] }),
    getGrants: jest.fn().mockResolvedValue({ grants: [] }),
    revokeGrant: jest.fn().mockResolvedValue({ revoked: true }),
    acceptFileSuggestions: jest.fn().mockResolvedValue({
      trashed: [],
      rejected_not_owned: [],
      skipped: [],
    }),
    undoAction: jest.fn().mockResolvedValue({ ok: true, itemsUndone: 1, itemsSkipped: 0 }),
    ...overrides,
  };
}

const renderDashboard = (props = {}) => {
  const gateway = props.gateway || makeGateway();
  const helpers = renderWithProviders(
    <MyPageContentPanel>
      <CollectionDashboard user={user} gateway={gateway} onNavigate={jest.fn()} {...props} />
    </MyPageContentPanel>
  );
  return { gateway, ...helpers };
};

describe('CollectionDashboard — block assembly', () => {
  it('renders the dashboard and hides zero/absent blocks (absent-not-disabled)', async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('collection-dashboard')).toBeInTheDocument());

    // all-zero feeds: no hygiene cards, no journal section
    expect(screen.queryByText(/exact duplicates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/system changes/i)).not.toBeInTheDocument();
    // capacity series seam absent ⇒ sparkline block omitted entirely
    expect(screen.queryByText(/storage over time/i)).not.toBeInTheDocument();
  });

  it('absorbed repository fallbacks never crash the panel', async () => {
    const gateway = makeGateway({
      getFileSuggestions: jest.fn().mockResolvedValue({ suggestions: [] }) /* dups/trash absent */,
      getActions: jest.fn().mockResolvedValue({ actions: [] }),
      loadCollections: jest.fn().mockResolvedValue({ collections: [] }),
    });

    renderDashboard({ gateway });

    await waitFor(() => expect(screen.getByTestId('collection-dashboard')).toBeInTheDocument());
    expect(screen.queryByText(/exact duplicates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/purged in/i)).not.toBeInTheDocument();
  });
});

describe('CollectionDashboard — hygiene cards', () => {
  it('renders dup/trash/suggestion cards and deep-links WITHOUT mutating', async () => {
    const onNavigate = jest.fn();
    const gateway = makeGateway({
      getFileSuggestions: jest.fn().mockResolvedValue({
        duplicates: { group_count: 2, duplicate_count: 5, reclaimable_bytes: 4718592 },
        suggestions: [suggestionRow(), suggestionRow({ node_id: 90300 })],
        trash: {
          item_count: 3,
          total_bytes: 98765,
          oldest_deleted_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          retention_days: 30,
        },
      }),
    });

    renderDashboard({ gateway, onNavigate });

    const dupCard = await screen.findByRole('button', { name: /exact duplicates/i });
    expect(dupCard).toHaveTextContent(/2 groups/i);
    expect(dupCard).toHaveTextContent(/4.5 MB/i); // reclaimed size rendered
    expect(screen.getByRole('button', { name: /trash/i })).toHaveTextContent(/purged in ~25d/i);
    expect(screen.getByRole('button', { name: /cleanup suggestions/i })).toHaveTextContent(
      /2 rows/i
    );

    await userEvent.click(screen.getByRole('button', { name: /trash/i }));
    expect(onNavigate).toHaveBeenCalledWith('/files/__trash__');

    // dup card is a pull-overview: scrolls to the suggestions block, mutates nothing
    await userEvent.click(dupCard);
    expect(onNavigate).not.toHaveBeenCalledWith('/files/duplicates');
    expect(gateway.acceptFileSuggestions).not.toHaveBeenCalled();
  });

  it('retention 0 renders the no-automatic-purge note instead of a countdown', async () => {
    const gateway = makeGateway({
      getFileSuggestions: jest.fn().mockResolvedValue({
        duplicates: { group_count: 0, duplicate_count: 0, reclaimable_bytes: 0 },
        suggestions: [],
        trash: {
          item_count: 1,
          total_bytes: 10,
          oldest_deleted_at: new Date().toISOString(),
          retention_days: 0,
        },
      }),
    });

    renderDashboard({ gateway });

    expect(await screen.findByRole('button', { name: /trash/i })).toHaveTextContent(
      /no automatic purge/i
    );
  });
});

describe('CollectionDashboard — system-changes journal feed', () => {
  it('renders rows verbatim: subject_label + mapped action label + auto tag for system actors', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({
        actions: [
          actionRow({ action_id: 2, action: 'add-items', subject_label: 'Europe trip' }),
          actionRow({
            action_id: 1,
            action: 'archive',
            actor: 'system',
            subject_label: 'Auto coll',
          }),
        ],
      }),
    });

    renderDashboard({ gateway });

    const section = await screen.findByText(/system changes/i);
    const feed = section.closest('section');
    const rows = within(feed).getAllByTestId('journal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Europe trip');
    // system-origin rows are tagged `auto` (§2.3 block 2)
    expect(rows[1]).toHaveTextContent(/auto/i);
    // action label map: archive row renders the archive label, subject label verbatim
    expect(rows[1]).toHaveTextContent('Auto coll');
  });

  it('routes tip-undo clicks to the host onUndo seam when provided', async () => {
    const onUndo = jest.fn();
    const gateway = makeGateway({
      // 'rename' keeps the row out of the collections-status merge/archive
      // subset (same renderer) so the feed holds exactly one Undo button.
      getActions: jest.fn().mockResolvedValue({ actions: [actionRow({ action: 'rename' })] }),
    });

    renderDashboard({ gateway, onUndo });

    const undoButton = await screen.findByTestId('journal-undo');
    await userEvent.click(undoButton);

    expect(onUndo).toHaveBeenCalledWith(995, {});
    expect(gateway.undoAction).not.toHaveBeenCalled();
  });

  it('without onUndo executes through useUndoToast (gateway.undoAction) and re-reads the feed', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({ actions: [actionRow({ action: 'rename' })] }),
    });

    renderDashboard({ gateway });

    await userEvent.click(await screen.findByTestId('journal-undo'));

    await waitFor(() => expect(gateway.undoAction).toHaveBeenCalledWith(995, {}));
    // success refresh: the feed is re-read after the undo lands
    await waitFor(() => expect(gateway.getActions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/1 undone/i)).toBeInTheDocument();
  });

  it('non-tip undo arms the cascade dialog with the laterChanges count, then re-posts with confirmCascade', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({
        actions: [actionRow({ action_id: 3, action: 'rename', is_tip: false, chain_seq: 5 })],
      }),
      undoAction: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          errorCode: 'serverErrors.actions.cascadeConfirmRequired',
          params: { laterChanges: 2 },
        })
        .mockResolvedValueOnce({
          ok: true,
          itemsUndone: 3,
          itemsSkipped: 0,
          cascadeUndone: [4, 5],
        }),
    });

    renderDashboard({ gateway });

    await userEvent.click(await screen.findByTestId('journal-undo'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/2 later changes will also be undone/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /undo/i }));

    await waitFor(() =>
      expect(gateway.undoAction).toHaveBeenLastCalledWith(3, { confirmCascade: true })
    );
  });

  it('undone rows are strikethrough-labelled without an action; expired rows badge "not recoverable"', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({
        actions: [
          actionRow({
            action_id: 5,
            status: 'undone',
            undo_available: false,
            undone_at: new Date().toISOString(),
          }),
          actionRow({ action_id: 6, status: 'expired', undo_available: false }),
        ],
      }),
    });

    renderDashboard({ gateway });

    const rows = await screen.findAllByTestId('journal-row');
    expect(rows[0]).toHaveAttribute('data-status', 'undone');
    expect(within(rows[0]).queryByTestId('journal-undo')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(/not recoverable/i);
    expect(within(rows[1]).queryByTestId('journal-undo')).not.toBeInTheDocument();
  });

  it('permanent-delete parity: never-undoable report rows carry the badge, no button', async () => {
    // `delete-permanent` has no journaled writer (invariant 10) — a defensive
    // mapping row still renders the report-only badge, never an Undo button.
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({
        actions: [actionRow({ action_id: 7, action: 'delete-permanent', undo_available: false })],
      }),
    });

    renderDashboard({ gateway });

    const row = await screen.findByTestId('journal-row');
    expect(row).toHaveTextContent(/not recoverable/i);
    expect(within(row).queryByTestId('journal-undo')).not.toBeInTheDocument();
  });

  it('cap hit (200 rows) shows the "more changes" note without a pagination control', async () => {
    const actions = Array.from({ length: 200 }, (_, i) =>
      actionRow({
        action_id: i + 1,
        subject: `collection:${i}`,
        undo_available: false,
        status: 'undone',
      })
    );
    const gateway = makeGateway({ getActions: jest.fn().mockResolvedValue({ actions }) });

    renderDashboard({ gateway });

    expect(await screen.findByText(/more changes/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more|next/i })).not.toBeInTheDocument();
  });
});

describe('CollectionDashboard — my-collections status', () => {
  const collection = (overrides = {}) => ({
    collection_id: 17,
    name: 'Europe trip',
    origin: 'user',
    status: 'active',
    owner_id: 4,
    granted_role: null,
    item_count: 5,
    ...overrides,
  });

  it('renders counts, grants received/granted and inline revoke (instant row removal)', async () => {
    const gateway = makeGateway({
      loadCollections: jest.fn().mockResolvedValue({
        collections: [
          collection(),
          collection({ collection_id: 18, name: 'Old stuff', status: 'archived' }),
          collection({ collection_id: 19, name: 'Shared in', owner_id: 9, granted_role: 'viewer' }),
        ],
      }),
      getGrants: jest
        .fn()
        .mockImplementation(async (id) =>
          id === 17
            ? { grants: [{ grantee_id: 9, username: 'bob', role: 'viewer' }] }
            : { grants: [] }
        ),
    });

    renderDashboard({ gateway });

    const section = await screen.findByText(/collections status/i);
    const block = section.closest('section');
    expect(within(block).getByText(/2 active/i)).toBeInTheDocument();
    expect(within(block).getByText(/1 archived/i)).toBeInTheDocument();
    // received = granted_role rows; granted = owner-side grant rows (bob)
    expect(within(block).getByText('Shared in')).toBeInTheDocument();
    expect(within(block).getByText('Viewer')).toBeInTheDocument();
    expect(within(block).getByText(/bob/i)).toBeInTheDocument();

    await userEvent.click(within(block).getByTestId('grants-revoke'));
    await waitFor(() => expect(gateway.revokeGrant).toHaveBeenCalledWith(17, 9));
    // instant revoke: the row disappears without a collections re-read
    await waitFor(() => expect(within(block).queryByText(/bob/i)).not.toBeInTheDocument());
  });
});

describe('CollectionDashboard — suggestions block', () => {
  it('feeds the SuggestionsChecklist and accepts checked rows to trash with a report toast', async () => {
    const gateway = makeGateway({
      getFileSuggestions: jest.fn().mockResolvedValue({
        duplicates: { group_count: 1, duplicate_count: 2, reclaimable_bytes: 2048 },
        suggestions: [suggestionRow({ node_id: 101 }), suggestionRow({ node_id: 102 })],
        trash: { item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: 30 },
      }),
      acceptFileSuggestions: jest
        .fn()
        .mockResolvedValue({ trashed: [101], rejected_not_owned: [], skipped: [] }),
    });

    renderDashboard({ gateway });

    const checkboxes = await screen.findAllByTestId('suggestion-checkbox');
    await userEvent.click(checkboxes[0]);

    const accept = screen.getByTestId('suggestions-accept');
    expect(accept).toHaveTextContent(/accept selected \(1\)/i);

    await userEvent.click(accept);

    await waitFor(() => expect(gateway.acceptFileSuggestions).toHaveBeenCalledWith([101]));
    // P0: no journal row yet ⇒ report toast WITHOUT an Undo button (routes/dashboard.md §2.4)
    expect(await screen.findByText(/moved 1 items to trash/i)).toBeInTheDocument();
    expect(screen.queryByTestId('undo-toast-action')).not.toBeInTheDocument();
    // re-read feeds the cards/checklist back from the server state
    await waitFor(() => expect(gateway.getFileSuggestions).toHaveBeenCalledTimes(2));
  });

  it('absent suggestions data hides the block entirely', async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('collection-dashboard')).toBeInTheDocument());
    expect(screen.queryByText(/suggestions$/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestions-accept')).not.toBeInTheDocument();
  });
});
