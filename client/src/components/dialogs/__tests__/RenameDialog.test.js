/**
 * RenameDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/RenameDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import RenameDialog from '../RenameDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  value: 'original.txt',
  onChange: jest.fn(),
  onConfirm: jest.fn(),
};

describe('RenameDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dialog with value and onChange controlled correctly', () => {
    renderWithProviders(<RenameDialog {...defaultProps} />);
    const input = screen.getByLabelText(/new name/i);
    expect(input).toHaveValue('original.txt');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onChange when user types', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RenameDialog {...defaultProps} />);
    const input = screen.getByLabelText(/new name/i);
    await user.clear(input);
    await user.type(input, 'renamed.txt');
    expect(defaultProps.onChange).toHaveBeenCalled();
  });

  it('calls onConfirm when Change button clicked and value non-empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RenameDialog {...defaultProps} value="new-name.txt" />);
    await user.click(screen.getByRole('button', { name: /change/i }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RenameDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('loading disables both buttons', () => {
    renderWithProviders(<RenameDialog {...defaultProps} loading />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /change/i })).toBeDisabled();
  });

  it('empty value disables Confirm button', () => {
    renderWithProviders(<RenameDialog {...defaultProps} value="" />);
    expect(screen.getByRole('button', { name: /change/i })).toBeDisabled();
  });

  it('whitespace-only value disables Confirm button', () => {
    renderWithProviders(<RenameDialog {...defaultProps} value="   " />);
    expect(screen.getByRole('button', { name: /change/i })).toBeDisabled();
  });

  it('Enter key triggers onConfirm when not loading', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RenameDialog {...defaultProps} value="valid.txt" />);
    const input = screen.getByLabelText(/new name/i);
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows error and helperText when error prop set', () => {
    renderWithProviders(<RenameDialog {...defaultProps} error="Invalid file name" />);
    expect(screen.getByText(/invalid file name/i)).toBeInTheDocument();
  });

  it('calls onClearError on change when error exists', async () => {
    const onClearError = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <RenameDialog {...defaultProps} error="Error" onClearError={onClearError} />
    );
    const input = screen.getByLabelText(/new name/i);
    await user.type(input, 'x');
    expect(onClearError).toHaveBeenCalled();
  });
});
