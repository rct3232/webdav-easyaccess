/**
 * CollectionsListView tests.
 * @see docs/spec/client/components/file-manager/CollectionsListView.md (§2.3, §2.4, §2.5, §2.8)
 */
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import CollectionsListView from '../CollectionsListView';
import { useResponsive } from '../../../hooks/useResponsive';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  const base = createUseResponsiveModuleMock();
  return { ...base, useResponsive: jest.fn(base.useResponsive) };
});

jest.mock('../../../hooks/useThumbnailLazyLoad', () => ({
  __esModule: true,
  useThumbnailLazyLoad: jest.fn(),
}));

import { useThumbnailLazyLoad } from '../../../hooks/useThumbnailLazyLoad';

const card = (overrides = {}) => ({
  collection_id: 1,
  name: 'Roadtrip',
  item_count: 12,
  origin: 'user',
  status: 'active',
  granted_role: null,
  pinned: false,
  pinned_by: null,
  preview_items: [],
  ...overrides,
});

const listProps = () => ({
  mode: 'list',
  collections: [card()],
  sort: 'activity',
  onCardAction: jest.fn(),
  onCardClick: jest.fn(),
  onCardLongPressSelect: jest.fn(),
});

const openCardMenu = (id = 1) => {
  fireEvent.click(screen.getByTestId(`card-menu-button-${id}`));
};

beforeEach(() => {
  useResponsive.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true });
  useThumbnailLazyLoad.mockClear();
});

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

  it('renders NO sort control — the toolbar owns collections sort (P-2)', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.queryByTestId('collections-sort-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('collections-sort-options')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
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

  it('own ACTIVE card menu: rename/pin/archive/sharing — NO open, NO permanent delete (P-3)', () => {
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    ['rename', 'pin', 'archive', 'sharing'].forEach((action) => {
      expect(screen.getByTestId(`card-menu-option-${action}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-menu-option-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-delete-permanent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-restore')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('card-menu-option-rename'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'rename',
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

  it('viewer-received card menu is exactly revoke-permission, NO open/mutation entries', () => {
    const props = listProps();
    props.collections = [card({ granted_role: 'viewer' })];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    expect(screen.getByTestId('card-menu-option-revoke-permission')).toBeInTheDocument();
    expect(screen.getByText('Revoke permission')).toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-menu-option-leave')).not.toBeInTheDocument();
    ['rename', 'pin', 'unpin', 'archive', 'restore', 'sharing', 'delete-permanent'].forEach(
      (action) => {
        expect(screen.queryByTestId(`card-menu-option-${action}`)).not.toBeInTheDocument();
      }
    );
  });

  it('viewer-received menu mirrors the owner-side revoke label in BOTH locales (i18n mirror)', () => {
    // exact strings of dialogs.revokePermission (en.json/ko.json :356) — owner ruling P-1
    const en = require('../../../locales/en.json');
    const ko = require('../../../locales/ko.json');
    expect(en.fileManager.cardMenuRevokePermission).toBe('Revoke permission');
    expect(ko.fileManager.cardMenuRevokePermission).toBe('권한 반납');
    expect(en.fileManager.cardMenuRevokePermission).toBe(en.dialogs.revokePermission);
    expect(ko.fileManager.cardMenuRevokePermission).toBe(ko.dialogs.revokePermission);
    expect(en.fileManager.cardMenuLeave).toBeUndefined();
    expect(ko.fileManager.cardMenuLeave).toBeUndefined();
  });

  it('Revoke permission dispatches instantly (no confirm) and rows stay fetch-driven', () => {
    const props = listProps();
    props.collections = [
      card({ collection_id: 4, granted_role: 'viewer', name: 'Given' }),
      card({ collection_id: 1 }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu(4);
    fireEvent.click(screen.getByTestId('card-menu-option-revoke-permission'));
    expect(props.onCardAction).toHaveBeenCalledTimes(1);
    expect(props.onCardAction).toHaveBeenCalledWith(
      'revoke-permission',
      expect.objectContaining({ collection_id: 4 })
    );
    // instant: the mutation dispatches on the FIRST click (archive/delete only
    // dispatch after the hosted confirm), so no confirm step exists here
    // the former view-local hiddenIds hide is REMOVED: rows render from fetch
    // state, so the card stays until the next list read omits it
    expect(screen.getByTestId('collection-card-4')).toBeInTheDocument();
    expect(screen.getByTestId('collection-card-1')).toBeInTheDocument();
  });
});

describe('CollectionsListView — card click parity & previews (P-3)', () => {
  it('desktop: single click dispatches onCardClick; same-card double click opens', () => {
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    const cardEl = screen.getByTestId('collection-card-1');
    fireEvent.click(cardEl);
    expect(props.onCardClick).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 1 }),
      expect.any(Object)
    );
    fireEvent.click(cardEl);
    expect(props.onCardAction).toHaveBeenCalledWith(
      'open',
      expect.objectContaining({ collection_id: 1 })
    );
    expect(props.onCardClick).toHaveBeenCalledTimes(1);
  });

  it('desktop: two quick clicks on DIFFERENT cards select twice — never open', () => {
    const props = listProps();
    props.collections = [card({ collection_id: 1 }), card({ collection_id: 2, name: 'B' })];
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(screen.getByTestId('collection-card-1'));
    fireEvent.click(screen.getByTestId('collection-card-2'));
    expect(props.onCardAction).not.toHaveBeenCalledWith('open', expect.anything());
    expect(props.onCardClick).toHaveBeenCalledTimes(2);
  });

  it('mobile: tap opens directly (files parity — no selection dispatch)', () => {
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(screen.getByTestId('collection-card-1'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'open',
      expect.objectContaining({ collection_id: 1 })
    );
    expect(props.onCardClick).not.toHaveBeenCalled();
  });

  it('mobile: tap while selectionMode dispatches onCardClick (toggle semantics live shell-side)', () => {
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} selectionMode selectedFiles={new Set()} />);
    fireEvent.click(screen.getByTestId('collection-card-1'));
    expect(props.onCardClick).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 1 }),
      expect.any(Object)
    );
    expect(props.onCardAction).not.toHaveBeenCalledWith('open', expect.anything());
  });

  it('mobile: long-press dispatches onCardLongPressSelect', () => {
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    jest.useFakeTimers();
    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.touchStart(screen.getByTestId('collection-card-1'));
    jest.advanceTimersByTime(600);
    expect(props.onCardLongPressSelect).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 1 })
    );
    jest.useRealTimers();
  });

  it('card container carries the synthetic selection path key', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.getByTestId('collection-card-1')).toHaveAttribute(
      'data-file-path',
      '/__collections__/collection/1'
    );
  });

  it('selected card renders the shared tile selected background; menu action hides in selectionMode', () => {
    const props = listProps();
    renderWithProviders(
      <CollectionsListView
        {...props}
        selectionMode
        selectedFiles={new Set(['/__collections__/collection/1'])}
      />
    );
    const cardEl = screen.getByTestId('collection-card-1');
    expect(cardEl.querySelector('.MuiCard-root')).toHaveStyle({
      backgroundColor: 'rgba(65, 103, 186, 0.12)',
    });
    expect(screen.queryByTestId('card-menu-button-1')).not.toBeInTheDocument();
  });

  it('renders up to 4 preview cells with data-file-node-id icons and NO member filename labels', () => {
    const props = listProps();
    props.collections = [
      card({
        preview_items: [
          { node_id: 11, name: 'beach.jpg', type: 'file', mime: 'image/jpeg' },
          { node_id: 12, name: 'map.png', type: 'file', mime: 'image/png' },
          { node_id: 13, name: 'note.txt', type: 'file', mime: null },
          { node_id: 14, name: 'clip.mp4', type: 'file', mime: 'video/mp4' },
          { node_id: 15, name: 'never.jpg', type: 'file', mime: 'image/jpeg' },
        ],
      }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    [11, 12, 13, 14].forEach((id) => {
      const cell = screen.getByTestId(`collection-preview-${id}`);
      expect(cell).toHaveAttribute('data-file-node-id', String(id));
      expect(cell.querySelector('.MuiSvgIcon-root')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('collection-preview-15')).not.toBeInTheDocument();
    expect(screen.queryByText('beach.jpg')).not.toBeInTheDocument();
  });

  it('preview cell swaps icon→thumbnail from the shell-held previewThumbnails map', () => {
    const props = listProps();
    props.collections = [
      card({
        preview_items: [
          { node_id: 11, name: 'beach.jpg', type: 'file', mime: 'image/jpeg' },
          { node_id: 12, name: 'map.png', type: 'file', mime: 'image/png' },
        ],
      }),
    ];
    const rendered = renderWithProviders(<CollectionsListView {...props} />);
    rendered.rerender(
      <CollectionsListView {...props} previewThumbnails={new Map([[11, '/thumbs/11.jpg']])} />
    );
    const swapped = screen.getByTestId('collection-preview-11').querySelector('img');
    expect(swapped).toHaveAttribute('src', '/thumbs/11.jpg');
    expect(
      screen.getByTestId('collection-preview-12').querySelector('.MuiSvgIcon-root')
    ).toBeInTheDocument();
  });

  it('empty preview_items ⇒ placeholder glyph, no cells', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(document.querySelectorAll('[data-testid^="collection-preview-"]').length).toBe(0);
  });

  it('runs the batched lazy-load hook instance over the flattened preview rows', () => {
    const props = listProps();
    props.onPreviewThumbnailsLoaded = jest.fn();
    props.collections = [
      card({
        collection_id: 1,
        preview_items: [{ node_id: 11, name: 'a.jpg', type: 'file', mime: 'image/jpeg' }],
      }),
      card({
        collection_id: 2,
        name: 'B',
        preview_items: [{ node_id: 21, name: 'b.png', type: 'file', mime: null }],
      }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(useThumbnailLazyLoad).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 11 }),
        expect.objectContaining({ nodeId: 21 }),
      ]),
      props.onPreviewThumbnailsLoaded,
      {}
    );
  });

  it('bulk archive confirm: one hosted dialog listing names; confirm dispatches onBulkConfirm', () => {
    const props = {
      ...listProps(),
      bulkConfirm: { step: 'archive', ids: [1], names: ['Roadtrip'] },
      onBulkConfirm: jest.fn(),
      onBulkConfirmDismiss: jest.fn(),
    };
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByText(/\(Roadtrip\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.onBulkConfirm).toHaveBeenCalledTimes(1);
  });

  it('bulk permanent delete: the batch is covered by the two-step host (step prop drives copy)', () => {
    const props = {
      ...listProps(),
      bulkConfirm: { step: 'delete-1', ids: [1, 2], names: ['Roadtrip', 'Other'] },
      onBulkConfirm: jest.fn(),
      onBulkConfirmDismiss: jest.fn(),
    };
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByText(/Roadtrip, Other\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.onBulkConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(props.onBulkConfirmDismiss).toHaveBeenCalledTimes(1);
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

  it('member row menu trigger dispatches onMemberAction("menu", row, anchorEl)', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(
      within(screen.getByTestId('member-row-90210')).getByTestId('member-menu-button')
    );
    expect(props.onMemberAction).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ nodeId: 90210 }),
      expect.any(HTMLElement)
    );
  });

  it('list mode regions are exclusive: no member rows while mode=list', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('collections-list-region')).toBeInTheDocument();
  });
});
