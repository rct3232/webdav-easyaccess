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
