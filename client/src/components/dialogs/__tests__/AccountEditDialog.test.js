/**
 * AccountEditDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/AccountEditDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import AccountEditDialog from '../AccountEditDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  email: '',
  onEmailChange: jest.fn(),
  password: '',
  onPasswordChange: jest.fn(),
  confirmPassword: '',
  onConfirmPasswordChange: jest.fn(),
  loading: false,
  canSave: true,
  onSave: jest.fn(),
};

describe('AccountEditDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dialog with form fields and buttons when open', () => {
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('calls onSave when Save button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Save when canSave is false', () => {
    renderWithProviders(<AccountEditDialog {...defaultProps} canSave={false} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('disables Save and Cancel when loading', () => {
    renderWithProviders(<AccountEditDialog {...defaultProps} loading />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('shows message Alert when message.text is provided', () => {
    renderWithProviders(
      <AccountEditDialog
        {...defaultProps}
        message={{ text: 'Update failed', type: 'error' }}
      />
    );
    expect(screen.getByText('Update failed')).toBeInTheDocument();
  });

  it('shows password mismatch helper text when confirm differs from password', () => {
    renderWithProviders(
      <AccountEditDialog
        {...defaultProps}
        password="secret"
        confirmPassword="different"
      />
    );
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('calls onEmailChange when email input changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'a');
    expect(defaultProps.onEmailChange).toHaveBeenCalled();
  });

  it('calls onPasswordChange when new password input changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    await user.type(newPasswordInput, 'x');
    expect(defaultProps.onPasswordChange).toHaveBeenCalled();
  });

  it('calls onConfirmPasswordChange when confirm password input changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountEditDialog {...defaultProps} />);
    const confirmInput = screen.getByLabelText(/^confirm password$/i);
    await user.type(confirmInput, 'x');
    expect(defaultProps.onConfirmPasswordChange).toHaveBeenCalled();
  });
});
