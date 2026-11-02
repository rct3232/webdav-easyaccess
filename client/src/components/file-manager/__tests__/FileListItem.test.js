/**
 * FileListItem tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileListItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
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

describe('FileListItem — search-server-row slots', () => {
  // Mirrors the test-utils theme palette so the committed green (secondary.light,
  // auto-derived) resolves exactly like in the rendered marks.
  const REF_THEME = createTheme({
    palette: { primary: { main: '#4167ba' }, secondary: { main: '#52c597' } },
  });
  const hexToRgb = (hex) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  // MUI auto-derives `light` as an rgb() string — normalize both sides.
  const asRgb = (color) => (color.startsWith('#') ? hexToRgb(color) : color).replace(/\s+/g, ' ');
  const LIVE_YELLOW_RGB = 'rgb(247, 209, 84)'; // theme.palette.highlight.main

  const searchRow = (overrides = {}) => ({
    nodeId: 77001,
    path: '',
    basename: 'movie-notes.pdf',
    type: 'file',
    size: 2048,
    lastmod: '2026-01-01T00:00:00Z',
    isSearchServerRow: true,
    hasWritePermission: false,
    rowTestId: 'server-search-row-77001',
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

  it('renders committed and live ranges in the name — per-kind testids and colors', () => {
    const file = searchRow({
      highlights: [
        { start: 0, end: 5, kind: 'committed' },
        { start: 6, end: 11, kind: 'live' },
      ],
    });
    renderWithProviders(<FileListItem {...itemProps(file)} />);

    const committed = screen.getByTestId('search-highlight-range');
    const live = screen.getByTestId('filter-highlight-range');
    expect(committed.textContent).toBe('movie');
    expect(live.textContent).toBe('notes');
    expect(getComputedStyle(committed).backgroundColor).toBe(
      asRgb(REF_THEME.palette.secondary.light)
    );
    expect(getComputedStyle(live).backgroundColor).toBe(LIVE_YELLOW_RGB);
  });

  it('re-computes ranges against the TRUNCATED name: segments concatenate to the rendered text', () => {
    const longName = 'movie-annual-report-with-a-lot-of-words.pdf'; // > 192px budget → truncated
    const file = searchRow({
      basename: longName,
      highlights: [
        { start: 0, end: 5, kind: 'committed' }, // 'movie' — survives in the prefix
        { start: longName.length - 3, end: longName.length, kind: 'live' }, // 'pdf' — suffix
        { start: 13, end: 19, kind: 'live' }, // 'report' — swallowed by the ellipsis
      ],
    });
    const { container } = renderWithProviders(<FileListItem {...itemProps(file)} />);

    const typography = container.querySelector('.MuiTypography-body2');
    // jsdom canvas fallback: 8px/char → 15 prefix chars + '...' + 6 suffix chars
    expect(typography.textContent).toBe('movie-annual-re...ds.pdf');
    expect(screen.getByTestId('search-highlight-range').textContent).toBe('movie');
    const live = screen.getAllByTestId('filter-highlight-range').map((el) => el.textContent);
    expect(live).toEqual(['pdf']);
  });

  it('keeps the full-name Tooltip intact on a truncated highlighted row', async () => {
    const longName = 'movie-annual-report-with-a-lot-of-words.pdf';
    const file = searchRow({
      basename: longName,
      highlights: [{ start: 0, end: 5, kind: 'live' }],
    });
    const { container } = renderWithProviders(<FileListItem {...itemProps(file)} />);
    const typography = container.querySelector('.MuiTypography-body2');
    fireEvent.mouseOver(typography);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(longName);
  });

  it('shows the EditOff read-only badge at the leading icon column corner', () => {
    renderWithProviders(<FileListItem {...itemProps(searchRow())} />);
    const badge = screen.getByTestId('search-readonly-badge-77001');
    expect(getComputedStyle(badge).position).toBe('absolute');
    expect(badge.querySelector('.MuiSvgIcon-root')).toBeTruthy();
  });

  it('renders NO badge for hasWritePermission true or a non-search row', () => {
    const { unmount } = renderWithProviders(
      <FileListItem {...itemProps(searchRow({ hasWritePermission: true }))} />
    );
    expect(screen.queryByTestId('search-readonly-badge-77001')).toBeNull();
    unmount();
    renderWithProviders(<FileListItem {...itemProps(searchRow({ isSearchServerRow: false }))} />);
    expect(screen.queryByTestId('search-readonly-badge-77001')).toBeNull();
  });

  it('suppresses the size caption while an un-enriched search FILE row has no size; directories keep the folder label', () => {
    const { container, unmount } = renderWithProviders(
      <FileListItem {...itemProps(searchRow({ size: null }))} />
    );
    expect(container.textContent).not.toMatch(/0 B|KB|MB/);
    unmount();
    renderWithProviders(
      <FileListItem {...itemProps(searchRow({ type: 'directory', size: null }))} />
    );
    expect(screen.getByText('Folder')).toBeInTheDocument();
  });

  it('a plain file row keeps zero search-slot DOM (byte-identical name render)', () => {
    const { container } = renderWithProviders(<FileListItem {...itemProps({ ...mockFile })} />);
    expect(container.querySelector('[data-testid^="search-"]')).toBeNull();
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByText(/1\.00 KB|1 KB/i)).toBeInTheDocument();
  });

  it('memo comparator: highlights/permission/isSearchServerRow/size changes re-render an unchanged-name row', () => {
    const { container, rerender } = renderWithProviders(
      <FileListItem
        {...itemProps(searchRow({ highlights: [{ start: 0, end: 5, kind: 'live' }] }))}
      />
    );
    expect(container.querySelectorAll('mark')).toHaveLength(1);

    rerender(
      <FileListItem
        {...itemProps(
          searchRow({
            size: null,
            hasWritePermission: true,
            highlights: [
              { start: 0, end: 5, kind: 'committed' },
              { start: 6, end: 11, kind: 'live' },
            ],
          })
        )}
      />
    );
    expect(screen.getByTestId('search-highlight-range').textContent).toBe('movie');
    expect(screen.getByTestId('filter-highlight-range').textContent).toBe('notes');
    expect(container.textContent).not.toMatch(/0 B|KB|MB/);
    expect(screen.queryByTestId('search-readonly-badge-77001')).toBeNull();

    rerender(<FileListItem {...itemProps(searchRow({ size: 4096, hasWritePermission: false }))} />);
    expect(screen.getByTestId('search-readonly-badge-77001')).toBeInTheDocument();
    expect(container.textContent).toMatch(/4\.00 KB|4 KB/);
  });

  it('memo comparator: isSearchServerRow flip removes the badge', () => {
    const { rerender } = renderWithProviders(<FileListItem {...itemProps(searchRow())} />);
    expect(screen.getByTestId('search-readonly-badge-77001')).toBeInTheDocument();
    rerender(
      <FileListItem {...itemProps(searchRow({ isSearchServerRow: false, highlights: [] }))} />
    );
    expect(screen.queryByTestId('search-readonly-badge-77001')).not.toBeInTheDocument();
  });
});
