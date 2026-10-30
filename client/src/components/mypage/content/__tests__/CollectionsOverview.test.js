/**
 * CollectionsOverview (MyPage `Collections`) tests — storage client-domain split.
 * Blocks per docs/spec/client/components/mypage/content/CollectionsOverview.md:
 * my-collections status (counts, grants received/granted + revoke, recent
 * merge/archive facts) and the collection journal feed (undo + cascade).
 * No storage hygiene/usage/suggestion IO.
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../../../test-utils';
import MyPageContentPanel from '../../MyPageContentPanel';
import CollectionsOverview from '../CollectionsOverview';

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

function makeGateway(overrides = {}) {
  return {
    getActions: jest.fn().mockResolvedValue({ actions: [] }),
    loadCollections: jest.fn().mockResolvedValue({ collections: [] }),
    getGrants: jest.fn().mockResolvedValue({ grants: [] }),
    revokeGrant: jest.fn().mockResolvedValue({ revoked: true }),
    undoAction: jest.fn().mockResolvedValue({ ok: true, itemsUndone: 1, itemsSkipped: 0 }),
    // Storage-owned seams: CollectionsOverview must not call them.
    getStorageHygiene: jest.fn().mockResolvedValue({ suggestions: [] }),
    getStorageUsage: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const renderOverview = (props = {}) => {
  const gateway = props.gateway || makeGateway();
  const helpers = renderWithProviders(
    <MyPageContentPanel>
      <CollectionsOverview user={user} gateway={gateway} {...props} />
    </MyPageContentPanel>
  );
  return { gateway, ...helpers };
};

describe('CollectionsOverview — block assembly', () => {
  it('renders the overview shell and hides zero/absent blocks', async () => {
    renderOverview();

    await waitFor(() => expect(screen.getByTestId('collections-overview')).toBeInTheDocument());
    expect(screen.queryByText(/collections status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/system changes/i)).not.toBeInTheDocument();
  });

  it('reads only the collection seams — no storage IO', async () => {
    const { gateway } = renderOverview();

    await waitFor(() => expect(screen.getByTestId('collections-overview')).toBeInTheDocument());

    expect(gateway.getActions).toHaveBeenCalledWith({ domain: 'collection' });
    expect(gateway.loadCollections).toHaveBeenCalled();
    expect(gateway.getStorageHygiene).not.toHaveBeenCalled();
    expect(gateway.getStorageUsage).not.toHaveBeenCalled();
  });
});

describe('CollectionsOverview — system-changes journal feed', () => {
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

    renderOverview({ gateway });

    const section = await screen.findByText(/system changes/i);
    const feed = section.closest('section');
    const rows = within(feed).getAllByTestId('journal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Europe trip');
    expect(rows[1]).toHaveTextContent(/auto/i);
    expect(rows[1]).toHaveTextContent('Auto coll');
  });

  it('routes tip-undo clicks to the host onUndo seam when provided', async () => {
    const onUndo = jest.fn();
    const gateway = makeGateway({
      // 'rename' keeps the row out of the collections-status merge/archive
      // subset (same renderer) so the feed holds exactly one Undo button.
      getActions: jest.fn().mockResolvedValue({ actions: [actionRow({ action: 'rename' })] }),
    });

    renderOverview({ gateway, onUndo });

    const undoButton = await screen.findByTestId('journal-undo');
    await userEvent.click(undoButton);

    expect(onUndo).toHaveBeenCalledWith(995, {});
    expect(gateway.undoAction).not.toHaveBeenCalled();
  });

  it('without onUndo executes through useUndoToast (gateway.undoAction) and re-reads the feed', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({ actions: [actionRow({ action: 'rename' })] }),
    });

    renderOverview({ gateway });

    await userEvent.click(await screen.findByTestId('journal-undo'));

    await waitFor(() => expect(gateway.undoAction).toHaveBeenCalledWith(995, {}));
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

    renderOverview({ gateway });

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

    renderOverview({ gateway });

    const rows = await screen.findAllByTestId('journal-row');
    expect(rows[0]).toHaveAttribute('data-status', 'undone');
    expect(within(rows[0]).queryByTestId('journal-undo')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(/not recoverable/i);
    expect(within(rows[1]).queryByTestId('journal-undo')).not.toBeInTheDocument();
  });

  it('permanent-delete parity: never-undoable report rows carry the badge, no button', async () => {
    const gateway = makeGateway({
      getActions: jest.fn().mockResolvedValue({
        actions: [actionRow({ action_id: 7, action: 'delete-permanent', undo_available: false })],
      }),
    });

    renderOverview({ gateway });

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

    renderOverview({ gateway });

    expect(await screen.findByText(/more changes/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more|next/i })).not.toBeInTheDocument();
  });
});

describe('CollectionsOverview — my-collections status', () => {
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

    renderOverview({ gateway });

    const section = await screen.findByText(/collections status/i);
    const block = section.closest('section');
    expect(within(block).getByText(/2 active/i)).toBeInTheDocument();
    expect(within(block).getByText(/1 archived/i)).toBeInTheDocument();
    expect(within(block).getByText('Shared in')).toBeInTheDocument();
    expect(within(block).getByText('Viewer')).toBeInTheDocument();
    expect(within(block).getByText(/bob/i)).toBeInTheDocument();

    await userEvent.click(within(block).getByTestId('grants-revoke'));
    await waitFor(() => expect(gateway.revokeGrant).toHaveBeenCalledWith(17, 9));
    await waitFor(() => expect(within(block).queryByText(/bob/i)).not.toBeInTheDocument());
  });

  it('renders recent merge/archive facts in the status block using the same row renderer', async () => {
    const gateway = makeGateway({
      loadCollections: jest.fn().mockResolvedValue({ collections: [collection()] }),
      getActions: jest.fn().mockResolvedValue({
        actions: [actionRow({ action: 'archive', action_id: 11, subject_label: 'Europe trip' })],
      }),
    });

    renderOverview({ gateway });

    const facts = await screen.findByText(/recent collection changes/i);
    const block = facts.closest('div');
    expect(within(block).getByTestId('journal-row')).toHaveTextContent('Europe trip');
    expect(within(block).getByTestId('journal-row')).toHaveTextContent(/archived/i);
  });
});
