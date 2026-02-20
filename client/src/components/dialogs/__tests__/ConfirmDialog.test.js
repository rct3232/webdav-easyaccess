/**
 * ConfirmDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/ConfirmDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import ConfirmDialog from '../ConfirmDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  title: 'Confirm',
  message: 'Are you sure?',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
};

describe('ConfirmDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title, message, confirm and cancel buttons when variant !== loading', () => {
    renderWithProviders(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConfirmDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConfirmDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when dialog closed via Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConfirmDialog {...defaultProps} />);
    await user.keyboard('{Escape}');
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('variant=loading shows only spinner', () => {
    renderWithProviders(
      <ConfirmDialog
        {...defaultProps}
        variant="loading"
        title="Title"
        message="Message"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Message')).not.toBeInTheDocument();
  });

  it('loading=true disables both buttons', () => {
    renderWithProviders(<ConfirmDialog {...defaultProps} loading />);
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('uses custom title, confirmText, cancelText when provided', () => {
    renderWithProviders(
      <ConfirmDialog
        {...defaultProps}
        title="Delete Item?"
        confirmText="Yes, Delete"
        cancelText="No, Keep"
      />
    );
    expect(screen.getByText('Delete Item?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no, keep/i })).toBeInTheDocument();
  });

  it('uses default i18n when title/confirmText/cancelText not provided', () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        message="Default test"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Default test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('confirmColor does not break rendering', () => {
    renderWithProviders(
      <ConfirmDialog {...defaultProps} confirmColor="error" />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });
});
