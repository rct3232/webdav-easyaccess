/**
 * FileList tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileList.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileList from '../FileList';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

const mockFiles = [
  { path: '/a.txt', basename: 'a.txt', size: 100, lastmod: '2025-01-01T00:00:00Z', type: 'file' },
  { path: '/b.txt', basename: 'b.txt', size: 200, lastmod: '2025-01-02T00:00:00Z', type: 'file' },
];

const defaultProps = {
  files: mockFiles,
  onFileClick: jest.fn(),
  onMoreClick: jest.fn(),
  onLongPressSelect: jest.fn(),
  onContextMenu: jest.fn(),
  selectionMode: false,
  selectedFiles: new Set(),
  onFileCheck: jest.fn(),
  currentPath: '/',
  loading: false,
};

describe('FileList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders FileListItem for each file', () => {
    renderWithProviders(<FileList {...defaultProps} />);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
  });

  it('calls onFileClick when file row clicked', () => {
    const onFileClick = jest.fn();
    renderWithProviders(<FileList {...defaultProps} onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('a.txt'));
    expect(onFileClick).toHaveBeenCalledWith(mockFiles[0], expect.any(Object), 0);
  });

  it('calls onContextMenu on right-click', () => {
    const onContextMenu = jest.fn();
    renderWithProviders(<FileList {...defaultProps} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByText('a.txt'));
    expect(onContextMenu).toHaveBeenCalledWith(expect.any(Object), mockFiles[0]);
  });

  it('shows FileListSkeleton when loading and files empty', () => {
    const { container } = renderWithProviders(<FileList {...defaultProps} files={[]} loading />);
    expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('shows noFiles message when files empty and not loading', () => {
    renderWithProviders(<FileList {...defaultProps} files={[]} />);
    expect(screen.getByText(/no files|noFiles/i)).toBeInTheDocument();
  });

  it('renders loadMoreRef when hasMore', () => {
    const loadMoreRef = { current: null };
    renderWithProviders(<FileList {...defaultProps} hasMore loadMoreRef={loadMoreRef} />);
    expect(loadMoreRef.current).toBeTruthy();
  });

  it('does not render checkboxes when selectionMode (selection shown by row background)', () => {
    renderWithProviders(<FileList {...defaultProps} selectionMode />);
    expect(screen.queryAllByRole('checkbox').length).toBe(0);
  });
});

describe('FileList — member row slots (P-4)', () => {
  const memberRow = (overrides = {}) => ({
    nodeId: 90210,
    path: '',
    basename: 'poster.pdf',
    type: 'file',
    mime: 'application/pdf',
    lastmod: '2026-09-01T00:00:00Z',
    isCollectionMember: true,
    published: false,
    shared_excluded: false,
    state: 'normal',
    hasWritePermission: false,
    rowTestId: 'member-row-90210',
    moreButtonTestId: 'member-menu-button',
    ...overrides,
  });

  it('renders file.rowTestId as the row container data-testid', () => {
    renderWithProviders(<FileList {...defaultProps} files={[memberRow()]} />);
    expect(screen.getByTestId('member-row-90210')).toBeInTheDocument();
  });

  it('plain file rows carry NO container data-testid (zero DOM delta)', () => {
    const { container } = renderWithProviders(<FileList {...defaultProps} />);
    // MUI icons carry their own data-testid; scope the check to the member slot.
    expect(container.querySelector('[data-testid^="member-row-"]')).toBeNull();
  });

  it('a revoked member row is disabled: click does not dispatch onFileClick', () => {
    const onFileClick = jest.fn();
    renderWithProviders(
      <FileList
        {...defaultProps}
        files={[memberRow({ state: 'revoked' })]}
        onFileClick={onFileClick}
      />
    );
    fireEvent.click(screen.getByTestId('member-row-90210'));
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('member rows are non-draggable (hasWritePermission:false → draggable=false)', () => {
    renderWithProviders(<FileList {...defaultProps} files={[memberRow()]} />);
    expect(screen.getByTestId('member-row-90210')).toHaveAttribute('draggable', 'false');
  });
});
