/**
 * FileDetail tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileDetail.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileDetail from '../FileDetail';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

const mockFiles = [
  { path: '/doc.pdf', basename: 'doc.pdf', size: 1024, lastmod: '2025-01-15T10:00:00Z', type: 'file', mime: 'application/pdf' },
  { path: '/folder', basename: 'folder', type: 'directory' },
];

const defaultProps = {
  files: mockFiles,
  onFileClick: jest.fn(),
  onContextMenu: jest.fn(),
  selectionMode: false,
  selectedFiles: new Set(),
  onFileCheck: jest.fn(),
  currentPath: '/',
  loading: false,
};

describe('FileDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders table with name, type, size, date columns', () => {
    renderWithProviders(<FileDetail {...defaultProps} />);
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
  });

  it('calls onFileClick when row clicked', () => {
    const onFileClick = jest.fn();
    renderWithProviders(<FileDetail {...defaultProps} onFileClick={onFileClick} />);
    fireEvent.click(screen.getByText('doc.pdf'));
    expect(onFileClick).toHaveBeenCalledWith(mockFiles[0]);
  });

  it('calls onContextMenu on right-click', () => {
    const onContextMenu = jest.fn();
    renderWithProviders(<FileDetail {...defaultProps} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByText('doc.pdf'));
    expect(onContextMenu).toHaveBeenCalledWith(expect.any(Object), mockFiles[0]);
  });

  it('shows FileDetailSkeleton when loading and files empty', () => {
    const { container } = renderWithProviders(
      <FileDetail {...defaultProps} files={[]} loading />
    );
    expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('shows noFiles message when files empty and not loading', () => {
    renderWithProviders(<FileDetail {...defaultProps} files={[]} />);
    expect(screen.getByText(/no files|noFiles/i)).toBeInTheDocument();
  });

  it('shows checkbox when selectionMode', () => {
    renderWithProviders(<FileDetail {...defaultProps} selectionMode />);
    expect(screen.getAllByRole('checkbox').length).toBe(2);
  });
});
