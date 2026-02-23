/**
 * BulkActionToolbar tests.
 * Verifies visible outcome: toolbar renders, action buttons.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import BulkActionToolbar from '../BulkActionToolbar';

const defaultProps = {
  selectedFiles: new Set(['/a.txt', '/b.txt']),
  handleBulkMove: jest.fn(),
  handleBulkCopy: jest.fn(),
  handleBulkDownload: jest.fn(),
  openBulkDeleteDialog: jest.fn(),
  hasWritePermission: true,
  hasReadOnlyInSelection: false,
  disabled: false,
  downloadOnly: false,
};

describe('BulkActionToolbar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows move button when not downloadOnly', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByTitle(/move/i)).toBeInTheDocument();
  });

  it('shows copy button when not downloadOnly', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByTitle(/copy/i)).toBeInTheDocument();
  });

  it('shows download button', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
  });

  it('shows delete button when not downloadOnly', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();
  });

  it('hides move copy delete when downloadOnly', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} downloadOnly />);
    expect(screen.queryByTitle(/move/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/copy/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/delete/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
  });

  it('calls handleBulkMove when move clicked', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/move/i));
    expect(defaultProps.handleBulkMove).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkCopy when copy clicked', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/copy/i));
    expect(defaultProps.handleBulkCopy).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkDownload when download clicked', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/download/i));
    expect(defaultProps.handleBulkDownload).toHaveBeenCalledTimes(1);
  });

  it('calls openBulkDeleteDialog when delete clicked', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/delete/i));
    expect(defaultProps.openBulkDeleteDialog).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
  });

  it('shows read-only warning when hasReadOnlyInSelection', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} hasReadOnlyInSelection />);
    expect(screen.getByText(/read-only|selection/i)).toBeInTheDocument();
  });

  it('disables move/delete when hasWritePermission is false', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} hasWritePermission={false} />);
    const moveBtn = screen.getByTitle(/move/i);
    const deleteBtn = screen.getByTitle(/delete/i);
    expect(moveBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });

  it('disables all when disabled prop is true', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} disabled />);
    expect(screen.getByTitle(/move/i)).toBeDisabled();
    expect(screen.getByTitle(/copy/i)).toBeDisabled();
    expect(screen.getByTitle(/download/i)).toBeDisabled();
    expect(screen.getByTitle(/delete/i)).toBeDisabled();
  });

  it('openBulkDeleteDialog not called when selectedFiles empty', () => {
    renderWithProviders(
      <BulkActionToolbar {...defaultProps} selectedFiles={new Set()} downloadOnly={false} />
    );
    const deleteBtn = screen.getByTitle(/delete/i);
    fireEvent.click(deleteBtn);
    expect(defaultProps.openBulkDeleteDialog).not.toHaveBeenCalled();
  });

  it('renders toolbar with action buttons', () => {
    renderWithProviders(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByTitle(/move/i)).toBeInTheDocument();
  });
});
