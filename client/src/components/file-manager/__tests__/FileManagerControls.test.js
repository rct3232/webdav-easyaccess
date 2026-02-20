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
  handleToggleSelectionMode: jest.fn(),
  handleSelectAll: jest.fn(),
  handleDeselectAll: jest.fn(),
  selectedFiles: new Set(),
  setSortMenuAnchor: jest.fn(),
  sortMenuAnchor: null,
  sortMode: SORT_MODES.NAME_ASC,
  setSortMode: jest.fn(),
  setViewModeMenuAnchor: jest.fn(),
  viewModeMenuAnchor: null,
  viewMode: VIEW_MODES.LIST,
  setViewMode: jest.fn(),
};

describe('FileManagerControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sort button', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    expect(screen.getByTitle(/sort/i)).toBeInTheDocument();
  });

  it('calls handleToggleSelectionMode when selection toggle clicked', () => {
    const handleToggleSelectionMode = jest.fn();
    renderWithProviders(<FileManagerControls {...defaultProps} handleToggleSelectionMode={handleToggleSelectionMode} />);
    fireEvent.click(screen.getByTitle(/select|selection/i));
    expect(handleToggleSelectionMode).toHaveBeenCalledTimes(1);
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
      <FileManagerControls {...defaultProps} selectionMode selectionActionsDisabled />
    );
    const selectAllBtns = screen.getAllByText(/select all/i);
    expect(selectAllBtns[0].closest('button')).toBeDisabled();
  });
});
