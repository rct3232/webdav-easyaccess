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
    renderWithProviders(
      <FileGridItem {...itemProps(memberRow({ published: false, shared_excluded: true }))} />
    );
    const excluded = screen.getByTestId('member-excluded-badge-90210');
    const pending = screen.getByTestId('member-publish-pending-badge-90210');
    expect(excluded.getAttribute('aria-label')).toBe("Not owner's file — not shared");
    expect(pending.getAttribute('aria-label')).toBe('Awaiting publish');
    // TileCornerBadge plate geometry: 28px circle over the media
    expect(getComputedStyle(excluded).width).toBe('28px');
    // CardTile cornerBadges container: absolute top-left, opposite the More action
    const corner = excluded.parentElement;
    expect(getComputedStyle(corner).position).toBe('absolute');
    expect(getComputedStyle(corner).top).toBe('4px');
    expect(getComputedStyle(corner).left).toBe('4px');
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
      container.querySelector('[data-testid^="member-excluded-badge"], [data-testid^="member-publish-pending-badge"]')
    ).toBeNull();
  });
});
