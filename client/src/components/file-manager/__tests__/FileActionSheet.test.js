/**
 * FileActionSheet tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileActionSheet.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileActionSheet from '../FileActionSheet';

const mockFile = { path: '/test.txt', basename: 'test.txt', type: 'file' };

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  file: mockFile,
  onDownload: jest.fn(),
  onRename: jest.fn(),
  onMove: jest.fn(),
  onCopy: jest.fn(),
  onDelete: jest.fn(),
  onShare: jest.fn(),
  onProperties: jest.fn(),
};

describe('FileActionSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders file header with basename', () => {
    renderWithProviders(<FileActionSheet {...defaultProps} />);
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('returns null when file is null', () => {
    const { container } = renderWithProviders(
      <FileActionSheet {...defaultProps} file={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onDownload and onClose when download clicked', () => {
    const onDownload = jest.fn();
    renderWithProviders(<FileActionSheet {...defaultProps} onDownload={onDownload} />);
    fireEvent.click(screen.getByText(/download/i));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('hides rename when !fileWritePermission', () => {
    renderWithProviders(<FileActionSheet {...defaultProps} hasWritePermission={false} />);
    expect(screen.queryByText(/rename/i)).not.toBeInTheDocument();
  });

  it('hides move when !fileWritePermission', () => {
    renderWithProviders(<FileActionSheet {...defaultProps} hasWritePermission={false} />);
    expect(screen.queryByText(/move/i)).not.toBeInTheDocument();
  });

  it('hides delete when !fileWritePermission', () => {
    renderWithProviders(<FileActionSheet {...defaultProps} hasWritePermission={false} />);
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it('shows preview only when canPreview and onPreview', () => {
    const fileWithPreview = { ...mockFile, canPreview: true };
    const onPreview = jest.fn();
    renderWithProviders(
      <FileActionSheet {...defaultProps} file={fileWithPreview} onPreview={onPreview} />
    );
    expect(screen.getByText(/preview/i)).toBeInTheDocument();
  });

  it('uses file.basename or file.name for display', () => {
    const fileWithName = { path: '/x', name: 'display-name', type: 'file' };
    renderWithProviders(<FileActionSheet {...defaultProps} file={fileWithName} />);
    expect(screen.getByText('display-name')).toBeInTheDocument();
  });
});
