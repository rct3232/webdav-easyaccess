/**
 * FileGridItem tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileGridItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileGridItem from '../FileGridItem';

const mockFile = {
  path: '/photo.jpg',
  basename: 'photo.jpg',
  size: 2048,
  lastmod: '2025-01-10T12:00:00Z',
  type: 'file',
};

const defaultProps = {
  file: mockFile,
  isSelected: false,
  isDisabled: false,
  isProcessing: false,
  isDropTarget: false,
  isDragging: false,
  selectionMode: false,
  showMoreButton: false,
  onMoreClick: jest.fn(),
  isMobile: false,
};

describe('FileGridItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders basename', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('does not render checkbox (selection shown by card background)', () => {
    renderWithProviders(<FileGridItem {...defaultProps} selectionMode isSelected />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows processing overlay when isProcessing', () => {
    renderWithProviders(<FileGridItem {...defaultProps} isProcessing />);
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows thumbnail or icon', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(document.querySelector('.MuiSvgIcon-root')).toBeInTheDocument();
  });

  it('shows More button when showMoreButton', () => {
    renderWithProviders(<FileGridItem {...defaultProps} showMoreButton onMoreClick={jest.fn()} />);
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
  });

  it('hides More button when !showMoreButton', () => {
    renderWithProviders(
      <FileGridItem {...defaultProps} showMoreButton={false} onMoreClick={jest.fn()} />
    );
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });

  it('calls onMoreClick with file when More button clicked', () => {
    const onMoreClick = jest.fn();
    renderWithProviders(
      <FileGridItem {...defaultProps} showMoreButton onMoreClick={onMoreClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(onMoreClick).toHaveBeenCalledWith(mockFile, expect.any(Object));
  });
});

describe('FileGridItem — member tile slots (P-4)', () => {
  const memberRow = (overrides = {}) => ({
    nodeId: 90210,
    path: '',
    basename: 'poster.pdf',
    type: 'file',
    mime: 'application/pdf',
    isCollectionMember: true,
    published: false,
    shared_excluded: false,
    state: 'normal',
    moreButtonTestId: 'member-menu-button',
    ...overrides,
  });

  const itemProps = (file, overrides = {}) => ({
    file,
    isSelected: false,
    isDisabled: false,
    isProcessing: false,
    isDropTarget: false,
    isDragging: false,
    selectionMode: false,
    showMoreButton: true,
    onMoreClick: jest.fn(),
    isMobile: false,
    ...overrides,
  });

  it('More action carries file.moreButtonTestId', () => {
    const file = memberRow();
    const onMoreClick = jest.fn();
    renderWithProviders(<FileGridItem {...itemProps(file, { onMoreClick })} />);
    fireEvent.click(screen.getByTestId('member-menu-button'));
    expect(onMoreClick).toHaveBeenCalledWith(file, expect.any(Object));
  });

  it('member-state badges render in the card TOP-LEFT corner slot (M-4 geometry mirror)', () => {
    const { unmount } = renderWithProviders(
      <FileGridItem {...itemProps(memberRow({ published: true, shared_excluded: true }))} />
    );
    const excluded = screen.getByTestId('member-excluded-badge-90210');
    // R2 (2026-10-01): publish-pending NEVER co-renders with shared_excluded.
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
    expect(excluded.getAttribute('aria-label')).toBe("Not owner's file — not shared");
    // TileCornerBadge plate geometry: 28px circle over the media
    expect(getComputedStyle(excluded).width).toBe('28px');
    // CardTile cornerBadges container: absolute top-left, opposite the More action
    // — 8px inset per the owner ruling (e483466; CardTile.md §cornerBadges)
    const corner = excluded.parentElement;
    expect(getComputedStyle(corner).position).toBe('absolute');
    expect(getComputedStyle(corner).top).toBe('8px');
    expect(getComputedStyle(corner).left).toBe('8px');
    unmount();
    renderWithProviders(<FileGridItem {...itemProps(memberRow())} />);
    const pending = screen.getByTestId('member-publish-pending-badge-90210');
    expect(pending.getAttribute('aria-label')).toBe('Awaiting publish');
  });

  it('pending badge disappears when published flips (memo comparator tracks the field)', () => {
    const { rerender } = renderWithProviders(<FileGridItem {...itemProps(memberRow())} />);
    expect(screen.getByTestId('member-publish-pending-badge-90210')).toBeInTheDocument();
    rerender(<FileGridItem {...itemProps(memberRow({ published: true }), { key: 'pub' })} />);
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).not.toBeInTheDocument();
  });

  it('revoked member tile renders NEITHER badge', () => {
    renderWithProviders(
      <FileGridItem
        {...itemProps(memberRow({ state: 'revoked', published: false, shared_excluded: true }))}
      />
    );
    expect(screen.queryByTestId('member-excluded-badge-90210')).toBeNull();
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
  });

  it('a plain file tile renders NO more-button data-testid (regression anchor)', () => {
    const { container } = renderWithProviders(
      <FileGridItem {...itemProps({ path: '/a.txt', basename: 'a.txt', type: 'file' })} />
    );
    // MUI icons carry their own data-testid; scope the check to the member slots.
    expect(container.querySelector('[data-testid="member-menu-button"]')).toBeNull();
    expect(container.querySelector('[data-testid^="member-row-"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid^="member-excluded-badge"], [data-testid^="member-publish-pending-badge"]'
      )
    ).toBeNull();
  });
});

describe('FileGridItem — search-server-row slots', () => {
  const searchRow = (overrides = {}) => ({
    nodeId: 77002,
    path: '',
    basename: 'movie-notes.pdf',
    type: 'file',
    isSearchServerRow: true,
    hasWritePermission: false,
    rowTestId: 'server-search-row-77002',
    ...overrides,
  });
  const itemProps = (file, overrides = {}) => ({
    file,
    isSelected: false,
    isDisabled: false,
    isProcessing: false,
    isDropTarget: false,
    isDragging: false,
    selectionMode: false,
    showMoreButton: false,
    onMoreClick: jest.fn(),
    isMobile: false,
    ...overrides,
  });

  it('renders the two-color highlight ranges inside the centered name', () => {
    const file = searchRow({
      highlights: [
        { start: 0, end: 5, kind: 'committed' },
        { start: 6, end: 11, kind: 'live' },
      ],
    });
    renderWithProviders(<FileGridItem {...itemProps(file)} />);
    expect(screen.getByTestId('search-highlight-range').textContent).toBe('movie');
    expect(screen.getByTestId('filter-highlight-range').textContent).toBe('notes');
    expect(getComputedStyle(screen.getByTestId('filter-highlight-range')).backgroundColor).toBe(
      'rgb(247, 209, 84)'
    );
  });

  it('read-only badge: EditOff plate at the thumbnail TOP-RIGHT', () => {
    renderWithProviders(<FileGridItem {...itemProps(searchRow())} />);
    const badge = screen.getByTestId('search-readonly-badge-77002');
    expect(badge.querySelector('.MuiSvgIcon-root')).toBeTruthy();
    const cluster = badge.parentElement;
    expect(getComputedStyle(cluster).position).toBe('absolute');
    expect(getComputedStyle(cluster).top).toBe('4px');
    expect(getComputedStyle(cluster).right).toBe('4px');
  });

  it('read-only badge sits BESIDE the More action, More rightmost', () => {
    renderWithProviders(<FileGridItem {...itemProps(searchRow(), { showMoreButton: true })} />);
    const badge = screen.getByTestId('search-readonly-badge-77002');
    const cluster = badge.parentElement;
    expect(cluster.lastElementChild).toBe(screen.getByRole('button', { name: /more actions/i }));
  });

  it('renders NO badge for hasWritePermission true or non-search rows', () => {
    const { unmount } = renderWithProviders(
      <FileGridItem {...itemProps(searchRow({ hasWritePermission: true }))} />
    );
    expect(screen.queryByTestId('search-readonly-badge-77002')).toBeNull();
    unmount();
    renderWithProviders(
      <FileGridItem {...itemProps({ path: '/a.txt', basename: 'a.txt', type: 'file' })} />
    );
    expect(screen.queryByTestId('search-readonly-badge-77002')).toBeNull();
  });

  it('a plain file tile keeps zero search-slot DOM (byte-identical)', () => {
    const { container } = renderWithProviders(
      <FileGridItem {...itemProps({ path: '/a.txt', basename: 'a.txt', type: 'file' })} />
    );
    expect(container.querySelector('[data-testid^="search-"]')).toBeNull();
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
  });

  it('memo comparator: highlights and permission flips re-render a tile whose name never changes', () => {
    const { rerender } = renderWithProviders(
      <FileGridItem
        {...itemProps(searchRow({ highlights: [{ start: 0, end: 5, kind: 'live' }] }))}
      />
    );
    expect(screen.getAllByTestId('filter-highlight-range')).toHaveLength(1);

    rerender(
      <FileGridItem
        {...itemProps(
          searchRow({
            hasWritePermission: true,
            highlights: [
              { start: 0, end: 5, kind: 'committed' },
              { start: 6, end: 11, kind: 'live' },
            ],
          })
        )}
      />
    );
    expect(screen.getByTestId('search-highlight-range')).toBeInTheDocument();
    expect(screen.getAllByTestId('filter-highlight-range')).toHaveLength(1);
    expect(screen.queryByTestId('search-readonly-badge-77002')).toBeNull();
  });
});
