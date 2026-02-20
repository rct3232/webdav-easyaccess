/**
 * FileContextMenu tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileContextMenu.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileContextMenu from '../FileContextMenu';

const mockFile = { path: '/test.txt', basename: 'test.txt' };

const defaultProps = {
  contextMenu: { mouseX: 100, mouseY: 200 },
  onClose: jest.fn(),
  file: mockFile,
  hasWritePermission: true,
  onDownload: jest.fn(),
  onRename: jest.fn(),
  onMove: jest.fn(),
  onCopy: jest.fn(),
  onShare: jest.fn(),
  onProperties: jest.fn(),
  onDelete: jest.fn(),
};

describe('FileContextMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when contextMenu and file provided', () => {
    renderWithProviders(<FileContextMenu {...defaultProps} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('returns null when file is null', () => {
    const { container } = renderWithProviders(
      <FileContextMenu {...defaultProps} file={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onDownload with file when download clicked', () => {
    const onDownload = jest.fn();
    renderWithProviders(<FileContextMenu {...defaultProps} onDownload={onDownload} />);
    fireEvent.click(screen.getByText(/download/i));
    expect(onDownload).toHaveBeenCalledWith(mockFile);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when action clicked', () => {
    renderWithProviders(<FileContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/download/i));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables rename when !hasWritePermission', () => {
    renderWithProviders(<FileContextMenu {...defaultProps} hasWritePermission={false} />);
    const renameItem = screen.getByText(/rename/i).closest('[role="menuitem"]');
    expect(renameItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables move when !hasWritePermission', () => {
    renderWithProviders(<FileContextMenu {...defaultProps} hasWritePermission={false} />);
    const moveItem = screen.getByText(/move/i).closest('[role="menuitem"]');
    expect(moveItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables delete when !hasWritePermission', () => {
    renderWithProviders(<FileContextMenu {...defaultProps} hasWritePermission={false} />);
    const deleteItem = screen.getByText(/delete/i).closest('[role="menuitem"]');
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('uses file.hasWritePermission to override prop when defined', () => {
    const fileWithPermission = { ...mockFile, hasWritePermission: true };
    renderWithProviders(
      <FileContextMenu {...defaultProps} file={fileWithPermission} hasWritePermission={false} />
    );
    const renameItem = screen.getByText(/rename/i).closest('[role="menuitem"]');
    expect(renameItem).not.toHaveAttribute('aria-disabled');
  });
});
