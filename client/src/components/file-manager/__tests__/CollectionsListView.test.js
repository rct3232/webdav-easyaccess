/**
 * CollectionsListView tests.
 * @see docs/spec/client/components/file-manager/CollectionsListView.md (§2.4, §2.5, §2.8)
 */
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import CollectionsListView from '../CollectionsListView';

const card = (overrides = {}) => ({
  collection_id: 1,
  name: 'Roadtrip',
  item_count: 12,
  origin: 'user',
  status: 'active',
  granted_role: null,
  pinned: false,
  pinned_by: null,
  ...overrides,
});

const listProps = () => ({
  mode: 'list',
  collections: [card()],
  sort: 'activity',
  onSortChange: jest.fn(),
  onCardAction: jest.fn(),
});

const openCardMenu = (id = 1) => {
  fireEvent.click(screen.getByTestId(`card-menu-button-${id}`));
};

describe('CollectionsListView — list mode', () => {
  it('renders collection cards with name and item count', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    const cardEl = screen.getByTestId('collection-card-1');
    expect(within(cardEl).getByText('Roadtrip')).toBeInTheDocument();
    expect(within(cardEl).getByText(/12/)).toBeInTheDocument();
  });

  it('empty list renders the localized empty state', () => {
    const props = listProps();
    props.collections = [];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByText('No collections yet')).toBeInTheDocument();
  });

  it('empty archive view renders the archive empty state (§2.2)', () => {
    const props = listProps();
    props.collections = [];
    props.include = 'mine,archived';
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByText('Nothing archived')).toBeInTheDocument();
  });

  it('sort menu offers the five options and dispatches onSortChange', () => {
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(screen.getByTestId('collections-sort-menu'));
    fireEvent.click(screen.getByText('Similar'));
    expect(props.onSortChange).toHaveBeenCalledWith('similar');
  });

  it('sort=similar renders cluster GROUP HEADERS per cluster_index runs; other sorts do not', () => {
    const props = listProps();
    props.collections = [
      card({ collection_id: 1, cluster_index: 0 }),
      card({ collection_id: 2, name: 'B', cluster_index: 0 }),
      card({ collection_id: 3, name: 'C', cluster_index: 1 }),
    ];
    props.sort = 'similar';
    const { container } = renderWithProviders(<CollectionsListView {...props} />);
    expect(container.querySelectorAll('[data-testid^="cluster-header-"]').length).toBe(2);
    expect(screen.getByTestId('collection-card-1')).toBeInTheDocument();

    const flat = listProps();
    flat.collections = [card({ collection_id: 1, cluster_index: 0 })];
    const { container: flatContainer } = renderWithProviders(<CollectionsListView {...flat} />);
    expect(flatContainer.querySelectorAll('[data-testid^="cluster-header-"]').length).toBe(0);
  });

  it('zero pending suggestions ⇒ NO merge-card DOM node (zero layout footprint)', () => {
    const { container } = renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.queryByTestId('merge-card')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/merge/i);
  });

  it('mergeSlot injects the host-provided card above the list', () => {
    renderWithProviders(
      <CollectionsListView {...listProps()} mergeSlot={<div data-testid="merge-card" />} />
    );
    expect(screen.getByTestId('merge-card')).toBeInTheDocument();
  });

  it('shared-received cards carry the shared chip; auto-pin chips expose the unpin CTA', () => {
    const props = listProps();
    props.collections = [
      card({ collection_id: 2, name: 'Auto', pinned: true, pinned_by: 'auto' }),
      card({ collection_id: 3, name: 'Given', granted_role: 'viewer' }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByTestId('card-shared-chip-3')).toBeInTheDocument();
    expect(screen.getByTestId('card-autopin-chip-2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('card-autopin-unpin-2'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'unpin',
      expect.objectContaining({ collection_id: 2 })
    );
  });

  it('own ACTIVE card menu: open/rename/pin/archive/sharing — NO permanent delete', () => {
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    ['open', 'rename', 'pin', 'archive', 'sharing'].forEach((action) => {
      expect(screen.getByTestId(`card-menu-option-${action}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-menu-option-delete-permanent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-restore')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('card-menu-option-open'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'open',
      expect.objectContaining({ collection_id: 1 })
    );
  });

  it('pinned own cards expose Unpin in place of Pin', () => {
    const props = listProps();
    props.collections = [card({ pinned: true, pinned_by: 'user' })];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    expect(screen.getByTestId('card-menu-option-unpin')).toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-pin')).not.toBeInTheDocument();
  });

  it('own ARCHIVED card menu: Restore in place of Archive + Delete present (§2.4 T0.4 decision)', () => {
    const props = listProps();
    props.collections = [card({ status: 'archived' })];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    expect(screen.getByTestId('card-menu-option-restore')).toBeInTheDocument();
    expect(screen.getByTestId('card-menu-option-delete-permanent')).toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-archive')).not.toBeInTheDocument();
  });

  it('archive goes through exactly ONE confirm, then dispatches', () => {
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    fireEvent.click(screen.getByTestId('card-menu-option-archive'));

    expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(props.onCardAction).not.toHaveBeenCalled();

    openCardMenu();
    fireEvent.click(screen.getByTestId('card-menu-option-archive'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.onCardAction).toHaveBeenCalledTimes(1);
    expect(props.onCardAction).toHaveBeenCalledWith(
      'archive',
      expect.objectContaining({ collection_id: 1 })
    );
  });

  it('permanent delete asks a SECOND confirm (trash-parity 2-step) before dispatching', () => {
    const props = listProps();
    props.collections = [card({ status: 'archived' })];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    fireEvent.click(screen.getByTestId('card-menu-option-delete-permanent'));

    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(props.onCardAction).toHaveBeenCalledWith(
      'delete-permanent',
      expect.objectContaining({ collection_id: 1 })
    );
    // exactly ONE dispatch — the first confirm only arms step two.
    expect(props.onCardAction).toHaveBeenCalledTimes(1);
  });

  it('viewer-received card menu has NO mutation entries (open + leave only)', () => {
    const props = listProps();
    props.collections = [card({ granted_role: 'viewer' })];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    expect(screen.getByTestId('card-menu-option-open')).toBeInTheDocument();
    expect(screen.getByTestId('card-menu-option-leave')).toBeInTheDocument();
    ['rename', 'pin', 'unpin', 'archive', 'restore', 'sharing', 'delete-permanent'].forEach(
      (action) => {
        expect(screen.queryByTestId(`card-menu-option-${action}`)).not.toBeInTheDocument();
      }
    );
  });

  it('Leave hides the received card locally (recipient-local hide, §3.2)', () => {
    const props = listProps();
    props.collections = [
      card({ collection_id: 4, granted_role: 'viewer', name: 'Given' }),
      card({ collection_id: 1 }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu(4);
    fireEvent.click(screen.getByTestId('card-menu-option-leave'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'leave',
      expect.objectContaining({ collection_id: 4 })
    );
    expect(screen.queryByTestId('collection-card-4')).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-card-1')).toBeInTheDocument();
  });
});

describe('CollectionsListView — member mode', () => {
  const member = (overrides = {}) => ({
    nodeId: 90210,
    basename: 'poster.pdf',
    name: 'poster.pdf',
    type: 'file',
    size: 2048,
    lastmod: '2026-09-01T00:00:00Z',
    membership: 'derived',
    published: true,
    state: 'normal',
    shared_excluded: false,
    reason: 'tag:poster',
    ...overrides,
  });

  const membersProps = () => ({
    mode: 'members',
    items: [member()],
    nextCursor: null,
    onLoadMore: jest.fn(),
    onMemberAction: jest.fn(),
    onPublishBatch: jest.fn(),
  });

  it('renders member rows through the row area with name/size/date', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    const row = screen.getByTestId('member-row-90210');
    expect(within(row).getByText('poster.pdf')).toBeInTheDocument();
    expect(within(row).getByText(/KB/)).toBeInTheDocument();
  });

  it('revoked members render a gray placeholder WITHOUT filename', () => {
    const props = membersProps();
    props.items = [member({ nodeId: 5, state: 'revoked', name: null, basename: undefined })];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByTestId('member-row-5')).toBeInTheDocument();
    expect(screen.queryByText('poster.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shared_excluded rows render the not-shared chip', () => {
    const props = membersProps();
    props.items = [member({ shared_excluded: true })];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(
      within(screen.getByTestId('member-row-90210')).getByText("Not owner's file — not shared")
    ).toBeInTheDocument();
  });

  it('digest banner renders the one-line counts and expands', () => {
    const props = membersProps();
    props.digest = { added_since: 3, removed_since: 1 };
    renderWithProviders(<CollectionsListView {...props} />);
    const banner = screen.getByTestId('digest-banner');
    expect(within(banner).getByText(/\+3/)).toBeInTheDocument();
    expect(within(banner).getByText(/-1/)).toBeInTheDocument();
    expect(screen.queryByTestId('digest-details')).not.toBeInTheDocument();
    fireEvent.click(within(banner).getByTestId('digest-expand'));
    expect(screen.getByTestId('digest-details')).toBeInTheDocument();
  });

  it('no `since` digest data ⇒ no banner', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    expect(screen.queryByTestId('digest-banner')).not.toBeInTheDocument();
  });

  it('publish-pending banner shows the owner count with a batch action', () => {
    const props = membersProps();
    props.publishPendingCount = 5;
    renderWithProviders(<CollectionsListView {...props} />);
    const banner = screen.getByTestId('publish-pending-banner');
    expect(within(banner).getByText(/5/)).toBeInTheDocument();
    fireEvent.click(within(banner).getByTestId('publish-batch'));
    expect(props.onPublishBatch).toHaveBeenCalledTimes(1);
  });

  it('absent publish_pending_count (auto publish_mode / grantee) ⇒ no banner even with items', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    expect(screen.queryByTestId('publish-pending-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('member-row-90210')).toBeInTheDocument();
  });

  it('banner order: digest above publish-pending (both co-render)', () => {
    const props = membersProps();
    props.digest = { added_since: 2, removed_since: 0 };
    props.publishPendingCount = 4;
    const { container } = renderWithProviders(<CollectionsListView {...props} />);
    const digest = container.querySelector('[data-testid="digest-banner"]');
    const publish = container.querySelector('[data-testid="publish-pending-banner"]');
    expect(digest.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('cursor paging: load-more renders while nextCursor exists and calls onLoadMore', () => {
    const props = membersProps();
    props.nextCursor = 'cur-2';
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(screen.getByTestId('member-load-more'));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('no nextCursor ⇒ no load-more affordance', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    expect(screen.queryByTestId('member-load-more')).not.toBeInTheDocument();
  });

  it('member row menu trigger dispatches onMemberAction("menu", row)', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(
      within(screen.getByTestId('member-row-90210')).getByTestId('member-menu-button')
    );
    expect(props.onMemberAction).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ nodeId: 90210 })
    );
  });

  it('list mode regions are exclusive: no member rows while mode=list', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('collections-list-region')).toBeInTheDocument();
  });
});
