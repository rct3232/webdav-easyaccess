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
    const { container } = renderWithProviders(<FileActionSheet {...defaultProps} file={null} />);
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

  describe('trash actions (DEF-16 P9)', () => {
    const trashedFile = { ...mockFile, isTrashed: true };

    it('renders restore and purge rows gated by write permission', () => {
      const onRestore = jest.fn();
      const onPurge = jest.fn();
      renderWithProviders(
        <FileActionSheet
          {...defaultProps}
          file={trashedFile}
          onRestore={onRestore}
          onPurge={onPurge}
        />
      );
      fireEvent.click(screen.getByTestId('trash-action-restore'));
      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(defaultProps.onClose).toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('trash-action-purge'));
      expect(onPurge).toHaveBeenCalledTimes(1);
    });

    it('withholds live-item rows when their callbacks are not provided', () => {
      renderWithProviders(
        <FileActionSheet
          {...defaultProps}
          file={trashedFile}
          onDownload={undefined}
          onRename={undefined}
          onMove={undefined}
          onCopy={undefined}
          onDelete={undefined}
          onShare={undefined}
          onPreview={undefined}
          onPurge={jest.fn()}
        />
      );
      expect(screen.queryByTestId('file-action-download')).not.toBeInTheDocument();
      expect(screen.queryByTestId('file-action-delete')).not.toBeInTheDocument();
      expect(screen.queryByTestId('trash-action-restore')).not.toBeInTheDocument();
      expect(screen.getByTestId('trash-action-purge')).toBeInTheDocument();
      expect(screen.getByTestId('file-action-properties')).toBeInTheDocument();
    });

    it('hides trash rows without write permission', () => {
      renderWithProviders(
        <FileActionSheet
          {...defaultProps}
          file={trashedFile}
          onRestore={jest.fn()}
          onPurge={jest.fn()}
          hasWritePermission={false}
        />
      );
      expect(screen.queryByTestId('trash-action-restore')).not.toBeInTheDocument();
      expect(screen.queryByTestId('trash-action-purge')).not.toBeInTheDocument();
    });
  });
});
