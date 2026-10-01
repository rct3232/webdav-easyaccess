/**
 * FileListItem tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileListItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileListItem from '../FileListItem';

const mockFile = {
  path: '/test.pdf',
  basename: 'test.pdf',
  size: 1024,
  lastmod: '2025-01-15T10:00:00Z',
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

describe('FileListItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders basename', () => {
    renderWithProviders(<FileListItem {...defaultProps} />);
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
  });

  it('renders file size for file type', () => {
    renderWithProviders(<FileListItem {...defaultProps} />);
    expect(screen.getByText(/1\.00 KB|1 KB/i)).toBeInTheDocument();
  });

  it('renders folder label instead of size for directory type', () => {
    const dirFile = { ...mockFile, type: 'directory', path: '/folder', basename: 'folder' };
    renderWithProviders(<FileListItem {...defaultProps} file={dirFile} />);
    expect(screen.getByText('Folder')).toBeInTheDocument();
  });

  it('does not render checkbox (selection shown by container background)', () => {
    renderWithProviders(<FileListItem {...defaultProps} selectionMode isSelected />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows processing overlay when isProcessing', () => {
    renderWithProviders(<FileListItem {...defaultProps} isProcessing />);
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows icon when no thumbnail', () => {
    renderWithProviders(<FileListItem {...defaultProps} />);
    expect(document.querySelector('.MuiSvgIcon-root, [class*="icon"]')).toBeTruthy();
  });

  it('shows More button when showMoreButton', () => {
    renderWithProviders(<FileListItem {...defaultProps} showMoreButton onMoreClick={jest.fn()} />);
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
  });

  it('hides More button when !showMoreButton', () => {
    renderWithProviders(
      <FileListItem {...defaultProps} showMoreButton={false} onMoreClick={jest.fn()} />
    );
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });

  it('calls onMoreClick with file when More button clicked', () => {
    const onMoreClick = jest.fn();
    renderWithProviders(
      <FileListItem {...defaultProps} showMoreButton onMoreClick={onMoreClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(onMoreClick).toHaveBeenCalledWith(mockFile, expect.any(Object));
  });
});

describe('FileListItem — member-row slots (P-4)', () => {
  const memberRow = (overrides = {}) => ({
    nodeId: 90210,
    path: '',
    basename: 'poster.pdf',
    name: 'poster.pdf',
    type: 'file',
    mime: 'application/pdf',
    lastmod: '2026-09-01T00:00:00Z',
    isCollectionMember: true,
    membership: 'stored',
    published: false,
    shared_excluded: false,
    state: 'normal',
    hasWritePermission: false,
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

  it('omits the size caption for a size-less member row (the wire carries no size)', () => {
    const { container } = renderWithProviders(<FileListItem {...itemProps(memberRow())} />);
    expect(container.textContent).not.toMatch(/KB|MB|0 B/);
    expect(screen.getByText('poster.pdf')).toBeInTheDocument();
  });

  it('renders the shared_excluded BADGE overlaying the leading icon column (VpnLock, §11 follow-up 3)', () => {
    renderWithProviders(<FileListItem {...itemProps(memberRow({ shared_excluded: true }))} />);
    const badge = screen.getByTestId('member-excluded-badge-90210');
    expect(badge.getAttribute('aria-label')).toBe("Not owner's file — not shared");
    // overlay geometry: absolute badge row inside the relative thumbnail column
    const overlayRow = badge.parentElement;
    expect(getComputedStyle(overlayRow).position).toBe('absolute');
    expect(getComputedStyle(overlayRow).zIndex).toBe('1');
    expect(screen.queryByTestId('member-excluded-chip-90210')).toBeNull();
  });

  it('renders the awaiting-publish BADGE ONLY while published === false', () => {
    const { rerender } = renderWithProviders(<FileListItem {...itemProps(memberRow())} />);
    expect(screen.getByTestId('member-publish-pending-badge-90210')).toBeInTheDocument();
    rerender(<FileListItem {...itemProps(memberRow({ published: true }), { key: 'pub' })} />);
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).not.toBeInTheDocument();
  });

  it('renders NEITHER badge for a revoked member row (chip-era pending leak fixed)', () => {
    renderWithProviders(
      <FileListItem
        {...itemProps(memberRow({ state: 'revoked', published: false, shared_excluded: true }))}
      />
    );
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
    expect(screen.queryByTestId('member-excluded-badge-90210')).toBeNull();
  });

  it('memo comparator: flipping published on a NEW row object re-renders the badge away', () => {
    const props = itemProps(memberRow());
    const { rerender } = renderWithProviders(
      <FileListItem {...props} file={memberRow({ published: false })} />
    );
    expect(screen.getByTestId('member-publish-pending-badge-90210')).toBeInTheDocument();
    rerender(<FileListItem {...props} file={memberRow({ published: true })} />);
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).not.toBeInTheDocument();
  });

  it('More button carries file.moreButtonTestId and dispatches onMoreClick(file, event)', () => {
    const onMoreClick = jest.fn();
    const file = memberRow();
    renderWithProviders(<FileListItem {...itemProps(file, { onMoreClick })} />);
    fireEvent.click(screen.getByTestId('member-menu-button'));
    expect(onMoreClick).toHaveBeenCalledWith(file, expect.any(Object));
  });

  it('a plain file row keeps the size caption and renders no member testids/chips/badges', () => {
    renderWithProviders(<FileListItem {...itemProps({ ...mockFile })} />);
    expect(screen.getByText(/1\.00 KB|1 KB/i)).toBeInTheDocument();
    expect(screen.queryByTestId('member-menu-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/member-.*-chip-90210/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/member-.*-badge-90210/)).not.toBeInTheDocument();
  });
});
