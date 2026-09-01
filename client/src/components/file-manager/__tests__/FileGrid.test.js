/**
 * FileGrid tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileGrid.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileGrid from '../FileGrid';

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

describe('FileGrid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders FileGridItem for each file', () => {
    renderWithProviders(<FileGrid {...defaultProps} />);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
  });

  it('calls onFileClick when card clicked', () => {
    const onFileClick = jest.fn();
    renderWithProviders(<FileGrid {...defaultProps} onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('a.txt'));
    expect(onFileClick).toHaveBeenCalledWith(mockFiles[0], expect.any(Object), 0);
  });

  it('calls onContextMenu on right-click', () => {
    const onContextMenu = jest.fn();
    renderWithProviders(<FileGrid {...defaultProps} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByText('a.txt'));
    expect(onContextMenu).toHaveBeenCalledWith(expect.any(Object), mockFiles[0]);
  });

  it('shows FileGridSkeleton when loading and files empty', () => {
    const { container } = renderWithProviders(<FileGrid {...defaultProps} files={[]} loading />);
    expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('shows noFiles message when files empty and not loading', () => {
    renderWithProviders(<FileGrid {...defaultProps} files={[]} />);
    expect(screen.getByText(/no files|noFiles/i)).toBeInTheDocument();
  });

  it('renders loadMoreRef when hasMore', () => {
    const loadMoreRef = { current: null };
    renderWithProviders(<FileGrid {...defaultProps} hasMore loadMoreRef={loadMoreRef} />);
    expect(loadMoreRef.current).toBeTruthy();
  });

  it('calls onFileClick when card is clicked in selection mode', () => {
    const onFileClick = jest.fn();
    renderWithProviders(
      <FileGrid
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        onFileClick={onFileClick}
      />
    );
    fireEvent.click(screen.getByText('a.txt'));
    expect(onFileClick).toHaveBeenCalledWith(mockFiles[0], expect.any(Object), 0);
  });

  it('does not show checkbox in selection mode', () => {
    renderWithProviders(<FileGrid {...defaultProps} selectionMode selectedFiles={new Set()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
