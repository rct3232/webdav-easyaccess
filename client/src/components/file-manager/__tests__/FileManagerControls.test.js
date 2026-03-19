/**
 * FileManagerControls tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileManagerControls.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileManagerControls from '../FileManagerControls';
import { VIEW_MODES, SORT_MODES } from '../../../constants/fileManager';

const defaultProps = {
  isMobile: false,
  selectionMode: false,
  handleSelectAll: jest.fn(),
  handleDeselectAll: jest.fn(),
  selectedFiles: new Set(),
  sortMode: SORT_MODES.NAME_ASC,
  setSortMode: jest.fn(),
  viewMode: VIEW_MODES.LIST,
  setViewMode: jest.fn(),
};

const bulkActionProps = {
  handleBulkMove: jest.fn(),
  handleBulkCopy: jest.fn(),
  handleBulkDownload: jest.fn(),
  openBulkDeleteDialog: jest.fn(),
  bulkWritePermission: true,
  hasReadOnlyInSelection: false,
  bulkActionsDisabled: false,
  downloadOnly: false,
};

describe('FileManagerControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sort button', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    expect(screen.getByTitle(/sort/i)).toBeInTheDocument();
  });

  it('opens the sort menu from local control state', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);

    fireEvent.click(screen.getByTitle(/sort/i));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('shows select all and deselect all when selectionMode', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} selectionMode />);
    expect(screen.getAllByText(/select all/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/deselect all/i).length).toBeGreaterThan(0);
  });

  it('calls handleSelectAll when select all clicked', () => {
    const handleSelectAll = jest.fn();
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode handleSelectAll={handleSelectAll} />
    );
    fireEvent.click(screen.getAllByText(/select all/i)[0]);
    expect(handleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('calls handleDeselectAll when deselect all clicked', () => {
    const handleDeselectAll = jest.fn();
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode handleDeselectAll={handleDeselectAll} />
    );
    fireEvent.click(screen.getAllByText(/deselect all/i)[0]);
    expect(handleDeselectAll).toHaveBeenCalledTimes(1);
  });

  it('shows view mode buttons when !selectionMode', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    const viewButtons = screen.getAllByTitle(/list view|grid view|detail view/i);
    expect(viewButtons.length).toBeGreaterThan(0);
  });

  it('calls setViewMode when view mode button clicked', () => {
    const setViewMode = jest.fn();
    renderWithProviders(<FileManagerControls {...defaultProps} setViewMode={setViewMode} />);
    fireEvent.click(screen.getByTitle(/grid/i));
    expect(setViewMode).toHaveBeenCalledWith(VIEW_MODES.GRID);
  });

  it('shows detail view option on desktop', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} isMobile={false} />);
    expect(screen.getByTitle(/detail/i)).toBeInTheDocument();
  });

  it('disables selection actions when selectionActionsDisabled', () => {
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode selectionActionsDisabled {...bulkActionProps} />
    );
    const selectAllBtns = screen.getAllByText(/select all/i);
    expect(selectAllBtns[0].closest('button')).toBeDisabled();
  });

  it('hides sort button when selectionMode', () => {
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode selectedFiles={new Set(['/a.txt'])} {...bulkActionProps} />
    );
    expect(screen.queryByTitle(/sort/i)).not.toBeInTheDocument();
  });

  it('hides view mode buttons when selectionMode', () => {
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode selectedFiles={new Set(['/a.txt'])} {...bulkActionProps} />
    );
    expect(screen.queryByTitle(/list view/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/grid view/i)).not.toBeInTheDocument();
  });

  it('shows move, copy, download, delete when selectionMode with bulk handlers', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
      />
    );
    expect(screen.getByTitle(/move/i)).toBeInTheDocument();
    expect(screen.getByTitle(/copy/i)).toBeInTheDocument();
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();
  });

  it('hides move, copy, delete when selectionMode and downloadOnly', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        downloadOnly
      />
    );
    expect(screen.queryByTitle(/move/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/copy/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/delete/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
  });

  it('calls handleBulkMove when move clicked', () => {
    const handleBulkMove = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkMove={handleBulkMove}
      />
    );
    fireEvent.click(screen.getByTitle(/move/i));
    expect(handleBulkMove).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkCopy when copy clicked', () => {
    const handleBulkCopy = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkCopy={handleBulkCopy}
      />
    );
    fireEvent.click(screen.getByTitle(/copy/i));
    expect(handleBulkCopy).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkDownload when download clicked', () => {
    const handleBulkDownload = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkDownload={handleBulkDownload}
      />
    );
    fireEvent.click(screen.getByTitle(/download/i));
    expect(handleBulkDownload).toHaveBeenCalledTimes(1);
  });

  it('calls openBulkDeleteDialog with file paths when delete clicked', () => {
    const openBulkDeleteDialog = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt', '/b.txt'])}
        {...bulkActionProps}
        openBulkDeleteDialog={openBulkDeleteDialog}
      />
    );
    fireEvent.click(screen.getByTitle(/delete/i));
    expect(openBulkDeleteDialog).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
  });

  it('disables bulk action buttons when bulkActionsDisabled', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        bulkActionsDisabled
      />
    );
    expect(screen.getByTitle(/move/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/copy/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/download/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/delete/i).closest('button')).toBeDisabled();
  });

  it('disables move and delete when bulkWritePermission is false', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        bulkWritePermission={false}
      />
    );
    expect(screen.getByTitle(/move/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/delete/i).closest('button')).toBeDisabled();
  });

  it('shows read-only warning when hasReadOnlyInSelection', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        hasReadOnlyInSelection
      />
    );
    expect(screen.getByText(/read-only|selection/i)).toBeInTheDocument();
  });

  it('openBulkDeleteDialog not called when selectedFiles empty', () => {
    const openBulkDeleteDialog = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set()}
        {...bulkActionProps}
        openBulkDeleteDialog={openBulkDeleteDialog}
      />
    );
    const deleteBtn = screen.getByTitle(/delete/i);
    fireEvent.click(deleteBtn);
    expect(openBulkDeleteDialog).not.toHaveBeenCalled();
  });
});
