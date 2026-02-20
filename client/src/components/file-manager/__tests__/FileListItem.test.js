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
  isMobile: false,
  onCheck: jest.fn(),
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

  it('shows checkbox when selectionMode', () => {
    renderWithProviders(<FileListItem {...defaultProps} selectionMode />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides checkbox when !selectionMode', () => {
    renderWithProviders(<FileListItem {...defaultProps} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('calls onCheck with (file, checked, e) when checkbox changed', () => {
    const onCheck = jest.fn();
    renderWithProviders(<FileListItem {...defaultProps} selectionMode onCheck={onCheck} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheck).toHaveBeenCalledWith(mockFile, true, expect.any(Object));
  });

  it('shows processing overlay when isProcessing', () => {
    renderWithProviders(<FileListItem {...defaultProps} isProcessing />);
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows icon when no thumbnail', () => {
    renderWithProviders(<FileListItem {...defaultProps} />);
    expect(document.querySelector('.MuiSvgIcon-root, [class*="icon"]')).toBeTruthy();
  });
});
