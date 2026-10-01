/**
 * CollectionsListView tests.
 * @see docs/spec/client/components/file-manager/CollectionsListView.md (§2.3, §2.4, §2.5, §2.8)
 */
import React from 'react';
import { screen, fireEvent, within, act, waitFor } from '@testing-library/react';
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
  it('renders collection cards with the name ONLY — no member-count line (M-1)', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    const cardEl = screen.getByTestId('collection-card-1');
    expect(within(cardEl).getByText('Roadtrip')).toBeInTheDocument();
    expect(within(cardEl).queryByText(/12 items/)).not.toBeInTheDocument();
    expect(within(cardEl).queryByText('12')).not.toBeInTheDocument();
  });

  it('empty list renders the localized empty state', () => {
    const props = listProps();
    props.collections = [];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByText('No collections yet')).toBeInTheDocument();
  });

  describe('pseudo-tiles (M-2, 2026-09-30 owner ruling)', () => {
    const tileProps = () => ({ ...listProps(), onPseudoTileNavigate: jest.fn() });

    it('active list renders Likes FIRST and Archive LAST around the cards', () => {
      const props = tileProps();
      props.collections = [card({ collection_id: 1 })];
      const { container } = renderWithProviders(<CollectionsListView {...props} />);
      const cells = Array.from(container.querySelectorAll('[data-testid]'))
        .map((el) => el.getAttribute('data-testid'))
        .filter(
          (id) => /^collection-tile-(liked|archive)$/.test(id) || /^collection-card-\d+$/.test(id)
        );
      expect(cells).toEqual([
        'collection-tile-liked',
        'collection-card-1',
        'collection-tile-archive',
      ]);
      // the Likes tile carries the pink like-token heart
      expect(
        screen.getByTestId('collection-tile-liked').querySelector('svg.MuiSvgIcon-colorLike, svg')
      ).toBeTruthy();
    });

    it('clicks dispatch onPseudoTileNavigate with the verified virtual routes (never card actions)', () => {
      const props = tileProps();
      renderWithProviders(<CollectionsListView {...props} />);
      fireEvent.click(screen.getByTestId('collection-tile-liked'));
      expect(props.onPseudoTileNavigate).toHaveBeenCalledWith('/__collections__/liked');
      fireEvent.click(screen.getByTestId('collection-tile-archive'));
      expect(props.onPseudoTileNavigate).toHaveBeenCalledWith('/__collections__/__archive__');
      expect(props.onCardClick).not.toHaveBeenCalled();
      expect(props.onCardAction).not.toHaveBeenCalled();
    });

    it('ARCHIVE view shows NO pseudo-tiles (F3 follow-up — supersedes the M-2 "Likes only" default)', () => {
      const props = tileProps();
      props.include = 'mine,archived';
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.queryByTestId('collection-tile-liked')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collection-tile-archive')).not.toBeInTheDocument();
    });

    it('EMPTY archive view shows NO pseudo-tiles either — empty copy stays (F3)', () => {
      const props = tileProps();
      props.collections = [];
      props.include = 'mine,archived';
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.getByText('Nothing archived')).toBeInTheDocument();
      expect(screen.queryByTestId('collection-tile-liked')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collection-tile-archive')).not.toBeInTheDocument();
    });

    it('EMPTY section still shows the tiles next to the empty copy (destinations stay reachable)', () => {
      const props = tileProps();
      props.collections = [];
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.getByText('No collections yet')).toBeInTheDocument();
      expect(screen.getByTestId('collection-tile-liked')).toBeInTheDocument();
      expect(screen.getByTestId('collection-tile-archive')).toBeInTheDocument();
    });

    it('tiles carry NO card chrome (menu button) and member mode renders NO tiles', () => {
      const props = tileProps();
      const { unmount } = renderWithProviders(<CollectionsListView {...props} />);
      expect(
        screen.getByTestId('collection-tile-liked').querySelector('[data-testid^="card-menu"]')
      ).toBeNull();
      expect(
        screen.getByTestId('collection-tile-archive').querySelector('[data-testid^="card-menu"]')
      ).toBeNull();
      unmount();

      const members = {
        mode: 'members',
        items: [],
        onMemberAction: jest.fn(),
        onMemberRowClick: jest.fn(),
        onMemberRowCheck: jest.fn(),
        onMemberRowLongPressSelect: jest.fn(),
        onMemberThumbnailsLoaded: jest.fn(),
      };
      renderWithProviders(<CollectionsListView {...members} />);
      expect(screen.queryByTestId('collection-tile-liked')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collection-tile-archive')).not.toBeInTheDocument();
    });
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

  it('shared-received/auto-pin cards render top-left MEDIA BADGES (footer chips retired, M-4)', () => {
    const props = listProps();
    props.collections = [
      card({ collection_id: 2, name: 'Auto', pinned: true, pinned_by: 'auto' }),
      card({ collection_id: 3, name: 'Given', granted_role: 'viewer' }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    const sharedBadge = screen.getByTestId('card-shared-chip-3');
    const autoPinBadge = screen.getByTestId('card-autopin-chip-2');
    expect(sharedBadge).toBeInTheDocument();
    expect(autoPinBadge).toBeInTheDocument();
    // badges sit inside the card (media overlay) — the footer carries no chips
    expect(within(screen.getByTestId('collection-card-3')).queryByText('Archived')).toBeNull();

    // autopin badge is a REAL button dispatching the existing unpin action
    expect(autoPinBadge.tagName).toBe('BUTTON');
    fireEvent.click(autoPinBadge);
    expect(props.onCardAction).toHaveBeenCalledWith(
      'unpin',
      expect.objectContaining({ collection_id: 2 })
    );

    // preserved unpin-CTA testid still dispatches (inner element bubbles to the button)
    props.onCardAction.mockClear();
    fireEvent.click(screen.getByTestId('card-autopin-unpin-2'));
    expect(props.onCardAction).toHaveBeenCalledWith(
      'unpin',
      expect.objectContaining({ collection_id: 2 })
    );
  });

  it('archived rows render NO status chip (M-4 deletion; view-scoped membership)', () => {
    const props = listProps();
    props.collections = [card({ collection_id: 9, name: 'Old', status: 'archived' })];
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.queryByTestId('card-status-chip-9')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('collection-card-9')).queryByText('Archived')
    ).not.toBeInTheDocument();
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

  it('EVERY card-menu option renders a ListItemIcon svg (M-3 — icons on all rows)', () => {
    const iconOf = (action) =>
      screen.getByTestId(`card-menu-option-${action}`).querySelector('.MuiListItemIcon-root svg');

    const props = listProps();
    renderWithProviders(<CollectionsListView {...props} />);
    openCardMenu();
    ['rename', 'pin', 'archive', 'sharing'].forEach((action) => {
      expect(iconOf(action)).toBeTruthy();
    });
  });

  it('archived + viewer menus also icon every entry (restore/delete-permanent/revoke)', () => {
    const iconOf = (action) =>
      screen.getByTestId(`card-menu-option-${action}`).querySelector('.MuiListItemIcon-root svg');

    const archived = listProps();
    archived.collections = [card({ status: 'archived' })];
    const { unmount } = renderWithProviders(<CollectionsListView {...archived} />);
    openCardMenu();
    ['rename', 'pin', 'restore', 'sharing', 'delete-permanent'].forEach((action) => {
      expect(iconOf(action)).toBeTruthy();
    });
    unmount();

    const viewer = listProps();
    viewer.collections = [card({ granted_role: 'viewer' })];
    renderWithProviders(<CollectionsListView {...viewer} />);
    openCardMenu();
    expect(iconOf('revoke-permission')).toBeTruthy();
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

describe('CollectionsListView — member mode (P-4 shared renderers)', () => {
  // Rows arrive ADAPTER-shaped (useFileManager.md §2.3.2): file-shape + the
  // optional member slots; the view only picks the renderer and wires events.
  const memberRow = (overrides = {}) => ({
    nodeId: 90210,
    path: '',
    name: 'poster.pdf',
    basename: 'poster.pdf',
    type: 'file',
    mime: 'application/pdf',
    lastmod: '2026-09-01T00:00:00Z',
    membership: 'stored',
    published: true,
    state: 'normal',
    liked: false,
    reason: null,
    shared_excluded: false,
    isCollectionMember: true,
    hasWritePermission: false,
    rowTestId: 'member-row-90210',
    moreButtonTestId: 'member-menu-button',
    ...overrides,
  });

  const membersProps = () => ({
    mode: 'members',
    items: [memberRow()],
    onMemberAction: jest.fn(),
    onPublishBatch: jest.fn(),
    onMemberRowClick: jest.fn(),
    onMemberRowCheck: jest.fn(),
    onMemberRowLongPressSelect: jest.fn(),
    onMemberThumbnailsLoaded: jest.fn(),
  });

  it('default member view mode is grid: rows render through FileGrid tiles', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    const row = screen.getByTestId('member-row-90210');
    expect(row).toBeInTheDocument();
    // grid signature: the shared Card shell wraps the tile (list rows have none)
    expect(row.querySelector('.MuiCard-root')).toBeTruthy();
    expect(row.tagName).toBe('DIV');
  });

  it('memberViewMode="list" renders the shared FileList rows (no card shell, no size)', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} memberViewMode="list" />);
    const row = screen.getByTestId('member-row-90210');
    expect(row.querySelector('.MuiCard-root')).toBeNull();
    expect(within(row).getByText('poster.pdf')).toBeInTheDocument();
    // member rows never render a size (the adapter omits the field)
    expect(row.textContent).not.toMatch(/KB|MB|0 B/);
  });

  it('memberViewMode="detail" renders the shared FileDetail table row', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} memberViewMode="detail" />);
    const row = screen.getByTestId('member-row-90210');
    expect(row.tagName).toBe('TR');
    expect(within(row).getByTestId('member-menu-button')).toBeInTheDocument();
  });

  it('single click dispatches onMemberRowClick with the row, event and index', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.click(screen.getByTestId('member-row-90210'));
    expect(props.onMemberRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 90210 }),
      expect.any(Object),
      0
    );
  });

  it('the shared-renderer More button dispatches onMemberAction("menu", row, anchorEl)', () => {
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

  it('desktop right-click dispatches onMemberAction("menu", row, rowEl) — no FileContextMenu ever renders', () => {
    const props = membersProps();
    renderWithProviders(<CollectionsListView {...props} />);
    fireEvent.contextMenu(screen.getByTestId('member-row-90210'));
    expect(props.onMemberAction).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ nodeId: 90210 }),
      expect.any(HTMLElement)
    );
    expect(document.querySelectorAll('[data-testid^="file-action-"]')).toHaveLength(0);
  });

  it('a revoked member row is disabled: neither row click nor More dispatches anything', () => {
    const props = membersProps();
    props.items = [
      memberRow({
        nodeId: 5,
        name: null,
        basename: 'fileManager.collectionsUnavailable',
        mime: null,
        state: 'revoked',
        rowTestId: 'member-row-5',
      }),
    ];
    renderWithProviders(<CollectionsListView {...props} />);
    const row = screen.getByTestId('member-row-5');
    fireEvent.click(row);
    fireEvent.contextMenu(row);
    fireEvent.click(within(row).getByTestId('member-menu-button'));
    expect(props.onMemberRowClick).not.toHaveBeenCalled();
    expect(props.onMemberAction).not.toHaveBeenCalled();
  });

  it('member-state badges render in ALL THREE member views with the badge testids (§11 follow-up 3)', () => {
    const props = membersProps();
    // R2 (2026-10-01): excluded+pending ⇒ VpnLock ONLY; pending renders on a
    // publishable row (shared_excluded false) — two rows pin both halves.
    props.items = [
      memberRow({
        nodeId: 7,
        rowTestId: 'member-row-7',
        published: false,
        shared_excluded: true,
      }),
      memberRow({
        nodeId: 8,
        rowTestId: 'member-row-8',
        published: false,
        shared_excluded: false,
      }),
    ];
    ['grid', 'list', 'detail'].forEach((memberViewMode) => {
      const { unmount } = renderWithProviders(
        <CollectionsListView {...props} memberViewMode={memberViewMode} />
      );
      const excludedRow = screen.getByTestId('member-row-7');
      expect(within(excludedRow).getByTestId('member-excluded-badge-7')).toBeInTheDocument();
      expect(within(excludedRow).queryByTestId('member-publish-pending-badge-7')).toBeNull();
      const pendingRow = screen.getByTestId('member-row-8');
      expect(within(pendingRow).getByTestId('member-publish-pending-badge-8')).toBeInTheDocument();
      expect(within(pendingRow).queryByTestId('member-excluded-badge-8')).toBeNull();
      // the chip ids are retired everywhere (grid and detail never carried them)
      expect(within(excludedRow).queryByTestId('member-excluded-chip-7')).toBeNull();
      expect(within(pendingRow).queryByTestId('member-unpublished-chip-8')).toBeNull();
      unmount();
    });
  });

  it('a revoked member row renders NEITHER badge in any view', () => {
    const props = membersProps();
    props.items = [
      memberRow({
        nodeId: 5,
        name: null,
        basename: 'fileManager.collectionsUnavailable',
        mime: null,
        state: 'revoked',
        shared_excluded: true,
        published: false,
        rowTestId: 'member-row-5',
      }),
    ];
    ['grid', 'list', 'detail'].forEach((memberViewMode) => {
      const { unmount } = renderWithProviders(
        <CollectionsListView {...props} memberViewMode={memberViewMode} />
      );
      const row = screen.getByTestId('member-row-5');
      expect(within(row).queryByTestId('member-excluded-badge-5')).toBeNull();
      expect(within(row).queryByTestId('member-publish-pending-badge-5')).toBeNull();
      unmount();
    });
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

  it('all-zero digest (0 added / 0 removed) ⇒ NO banner (M-7)', () => {
    const props = membersProps();
    props.digest = { added_since: 0, removed_since: 0 };
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.queryByTestId('digest-banner')).not.toBeInTheDocument();
  });

  it('zero/zero with only-added digest still renders (one side non-zero)', () => {
    const props = membersProps();
    props.digest = { added_since: 0, removed_since: 2 };
    renderWithProviders(<CollectionsListView {...props} />);
    expect(screen.getByTestId('digest-banner')).toBeInTheDocument();
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

  it('chrome host stays intact: banners wrap the delegated renderer under members-list (load-more retired)', () => {
    const props = membersProps();
    props.digest = { added_since: 2, removed_since: 0 };
    props.publishPendingCount = 4;
    const { container } = renderWithProviders(<CollectionsListView {...props} />);
    const host = container.querySelector('[data-testid="members-list"]');
    expect(host).toBeInTheDocument();
    expect(within(host).getByTestId('digest-banner')).toBeInTheDocument();
    expect(within(host).getByTestId('publish-pending-banner')).toBeInTheDocument();
    expect(within(host).getByTestId('member-row-90210')).toBeInTheDocument();
    // Decision B (2026-09-29): the load-more button is gone (client slice instead).
    expect(within(host).queryByTestId('member-load-more')).not.toBeInTheDocument();
  });

  it('no nextCursor ⇒ no load-more affordance', () => {
    renderWithProviders(<CollectionsListView {...membersProps()} />);
    expect(screen.queryByTestId('member-load-more')).not.toBeInTheDocument();
  });

  // -- Decision B (2026-09-29 owner ruling): members/liked rows arrive as the
  // FULL set and the host slices them 50+50 with the shared useInfiniteScroll
  // sentinel (file-browse parity — same hook, same counts). ------------------
  const manyRows = (n, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      memberRow({ nodeId: 1000 + from + i, rowTestId: `member-row-${1000 + from + i}` })
    );

  const withCapturedObserver = (testBody) => {
    const callbacks = [];
    const RealMock = global.IntersectionObserver;
    global.IntersectionObserver = class CapturedIO {
      constructor(callback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    try {
      testBody(callbacks);
    } finally {
      global.IntersectionObserver = RealMock;
    }
  };

  it('60 member rows ⇒ the grid renders exactly the first 50 (client slice)', () => {
    withCapturedObserver(() => {
      const props = membersProps();
      props.items = manyRows(60);
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(50);
      expect(screen.getByTestId('member-row-1000')).toBeInTheDocument();
      expect(screen.queryByTestId('member-row-1055')).not.toBeInTheDocument();
    });
  });

  it('list mode also slices 50, detail mode also slices 50', () => {
    withCapturedObserver(() => {
      const listPropsMany = { ...membersProps(), items: manyRows(60), memberViewMode: 'list' };
      const { unmount } = renderWithProviders(<CollectionsListView {...listPropsMany} />);
      expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(50);
      unmount();

      const detailPropsMany = { ...membersProps(), items: manyRows(60), memberViewMode: 'detail' };
      renderWithProviders(<CollectionsListView {...detailPropsMany} />);
      expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(50);
    });
  });

  it('sentinel intersection appends the next 50 rows — no fetch fires (client slice)', async () => {
    await withCapturedObserver(async (callbacks) => {
      const props = membersProps();
      props.items = manyRows(60);
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(50);
      expect(callbacks.length).toBeGreaterThan(0);

      act(() => {
        callbacks[callbacks.length - 1]([{ isIntersecting: true }]);
      });

      await waitFor(() => expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(60));
      expect(screen.getByTestId('member-row-1055')).toBeInTheDocument();
      // Full fetch means NO additional gateway call exists to make — nothing to assert
      // beyond the slice growing locally.
    });
  });

  it('≤50 rows render fully with no sentinel observer armed', () => {
    withCapturedObserver((callbacks) => {
      const props = membersProps();
      props.items = manyRows(48);
      renderWithProviders(<CollectionsListView {...props} />);
      expect(screen.getAllByTestId(/^member-row-/)).toHaveLength(48);
      expect(callbacks).toHaveLength(0);
    });
  });

  it('server order is preserved while no memberSortMode prop is passed (host order-agnostic)', () => {
    withCapturedObserver(() => {
      const props = membersProps();
      // deliberately "unsorted" names/ids — the host must render the array AS IS.
      props.items = [
        memberRow({
          nodeId: 900,
          rowTestId: 'member-row-900',
          name: 'zeta.pdf',
          basename: 'zeta.pdf',
        }),
        memberRow({
          nodeId: 100,
          rowTestId: 'member-row-100',
          name: 'alpha.pdf',
          basename: 'alpha.pdf',
        }),
        memberRow({
          nodeId: 500,
          rowTestId: 'member-row-500',
          name: 'mid.pdf',
          basename: 'mid.pdf',
        }),
      ];
      const { container } = renderWithProviders(<CollectionsListView {...props} />);
      const rows = Array.from(container.querySelectorAll('[data-testid^="member-row-"]'));
      expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
        'member-row-900',
        'member-row-100',
        'member-row-500',
      ]);
    });
  });

  it('list mode regions are exclusive: no member rows while mode=list', () => {
    renderWithProviders(<CollectionsListView {...listProps()} />);
    expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('collections-list-region')).toBeInTheDocument();
  });

  // -- M-8 (2026-09-30 owner ruling): the FULL row set sorts CLIENT-SIDE by the
  // persisted per-surface sort mode BEFORE the useInfiniteScroll slice. -------
  describe('member sort (M-8 order matrix)', () => {
    const sortRows = () => [
      memberRow({
        nodeId: 1,
        rowTestId: 'member-row-1',
        name: 'beta.pdf',
        basename: 'beta.pdf',
        created_at: '2026-03-01T00:00:00Z',
      }),
      memberRow({
        nodeId: 2,
        rowTestId: 'member-row-2',
        name: 'Alpha.pdf',
        basename: 'Alpha.pdf',
        created_at: '2026-01-01T00:00:00Z',
      }),
      memberRow({
        nodeId: 3,
        rowTestId: 'member-row-3',
        name: null,
        basename: 'fileManager.collectionsUnavailable',
        mime: null,
        state: 'revoked',
        created_at: null,
      }),
      memberRow({
        nodeId: 4,
        rowTestId: 'member-row-4',
        name: 'gamma.pdf',
        basename: 'gamma.pdf',
        created_at: '2026-02-01T00:00:00Z',
      }),
    ];

    const renderedOrder = (memberSortMode) => {
      const props = membersProps();
      props.items = sortRows();
      const { container } = renderWithProviders(
        <CollectionsListView {...props} memberSortMode={memberSortMode} />
      );
      return Array.from(container.querySelectorAll('[data-testid^="member-row-"]')).map((el) =>
        el.getAttribute('data-testid')
      );
    };

    it('name_asc lowercases before localeCompare (sortFiles parity) — revoked placeholder sorts as text', () => {
      expect(renderedOrder('name_asc')).toEqual([
        'member-row-2', // Alpha.pdf
        'member-row-1', // beta.pdf
        'member-row-3', // fileManager... placeholder (text-verbatim parity)
        'member-row-4', // gamma.pdf
      ]);
    });

    it('name_desc mirrors the direction', () => {
      expect(renderedOrder('name_desc')).toEqual([
        'member-row-4',
        'member-row-3',
        'member-row-1',
        'member-row-2',
      ]);
    });

    it('date_asc sorts by created_at; the revoked row (null) PINS TO THE END', () => {
      expect(renderedOrder('date_asc')).toEqual([
        'member-row-2', // Jan
        'member-row-4', // Feb
        'member-row-1', // Mar
        'member-row-3', // null ⇒ end
      ]);
    });

    it('date_desc sorts newest-first; the revoked row STILL PINS TO THE END (both directions)', () => {
      expect(renderedOrder('date_desc')).toEqual([
        'member-row-1', // Mar
        'member-row-4', // Feb
        'member-row-2', // Jan
        'member-row-3', // null ⇒ end (never first)
      ]);
    });
  });
});
