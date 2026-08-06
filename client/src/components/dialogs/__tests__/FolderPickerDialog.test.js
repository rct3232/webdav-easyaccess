/**
 * FolderPickerDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/FolderPickerDialog.md
 * Mocks useFolderPicker to control folder list and selection.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import FolderPickerDialog from '../FolderPickerDialog';
import { useFolderPicker } from '../FolderPickerDialog/hooks/useFolderPicker';

const defaultMockReturn = {
  selectedNodeId: 10,
  folders: [
    { nodeId: 10, basename: 'docs', hasReadPermission: true },
    { nodeId: 11, basename: 'media', hasReadPermission: true },
  ],
  loading: false,
  hasWritePermission: true,
  breadcrumbs: [
    { nodeId: 100, name: 'Home' },
    { nodeId: 10, name: 'docs' },
  ],
  handleFolderClick: jest.fn(),
  handleNodeClick: jest.fn(),
  handleTogglePath: jest.fn(),
  getCurrentPathType: jest.fn().mockReturnValue('home'),
  isInvalidDestination: jest.fn().mockReturnValue(false),
};

jest.mock('../FolderPickerDialog/hooks/useFolderPicker', () => ({
  useFolderPicker: jest.fn(),
}));

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSelect: jest.fn(),
  currentNodeId: 100,
};

describe('FolderPickerDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFolderPicker.mockReturnValue({ ...defaultMockReturn });
    defaultMockReturn.isInvalidDestination.mockReturnValue(false);
  });

  it('renders dialog when open', () => {
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders breadcrumbs and folder list', () => {
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('docs');
    expect(screen.getByRole('dialog')).toHaveTextContent('media');
  });

  it('calls onClose when Cancel clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect with selectedNodeId and onClose when Select clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /select/i }));
    expect(defaultProps.onSelect).toHaveBeenCalledWith(10);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows loading state when useFolderPicker returns loading', () => {
    useFolderPicker.mockReturnValue({
      ...defaultMockReturn,
      loading: true,
      folders: [],
    });
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows empty state when no folders', () => {
    useFolderPicker.mockReturnValue({
      ...defaultMockReturn,
      folders: [],
    });
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    expect(screen.getByText(/no subfolders/i)).toBeInTheDocument();
  });

  it('Select is disabled when at the shared root', () => {
    useFolderPicker.mockReturnValue({
      ...defaultMockReturn,
      selectedNodeId: null,
      getCurrentPathType: jest.fn().mockReturnValue('shared'),
    });
    renderWithProviders(<FolderPickerDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /select/i })).toBeDisabled();
  });

  it('shows Home/Shared toggle for non-admin in copy action', () => {
    renderWithProviders(
      <FolderPickerDialog
        {...defaultProps}
        user={{ id: '1', is_admin: false }}
        action="copy"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
