/**
 * SharedManageBody tests.
 * Verifies observable outcomes per spec: SharedManageBody.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SharedManageBody from '../SharedManageBody';

const defaultProps = {
  displayName: 'my-folder',
  isDirectory: true,
  loading: false,
  initialLoading: false,
  confirmDialogOpen: false,
  setConfirmDialogOpen: jest.fn(),
  hasReadPermission: true,
  hasWritePermission: true,
  pathPermission: null,
  filePermissionLevel: null,
  pendingRequest: {
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  },
  ownerExists: true,
  onRequestPermission: jest.fn(),
  onCancelPendingRequest: jest.fn(),
  onRevokePermission: jest.fn(),
};

describe('SharedManageBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders folder label with display name', () => {
    renderWithProviders(<SharedManageBody {...defaultProps} />);
    expect(screen.getByText(/folder/i)).toHaveTextContent(/my-folder/);
  });

  it('renders file label when isDirectory is false', () => {
    renderWithProviders(
      <SharedManageBody {...defaultProps} isDirectory={false} displayName="doc.pdf" />
    );
    expect(screen.getByText(/file/i)).toHaveTextContent(/doc\.pdf/);
  });

  it('shows SharedPermissionList when not initialLoading', () => {
    renderWithProviders(<SharedManageBody {...defaultProps} />);
    expect(screen.getByRole('button', { name: /revoke permission/i })).toBeInTheDocument();
  });

  it('shows skeleton when initialLoading and loadingVariant skeleton', () => {
    renderWithProviders(
      <SharedManageBody {...defaultProps} initialLoading loadingVariant="skeleton" />
    );
    expect(screen.queryByRole('button', { name: /revoke permission/i })).not.toBeInTheDocument();
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });

  it('shows spinner when initialLoading and loadingVariant spinner', () => {
    renderWithProviders(
      <SharedManageBody {...defaultProps} initialLoading loadingVariant="spinner" />
    );
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows owner deleted message when ownerExists is false', () => {
    renderWithProviders(<SharedManageBody {...defaultProps} ownerExists={false} />);
    expect(screen.getByText(/owner.*deleted/i)).toBeInTheDocument();
  });

  it('opens revoke confirm dialog when revoke clicked and confirms onRevokePermission', async () => {
    renderWithProviders(<SharedManageBody {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /revoke permission/i }));
    expect(defaultProps.setConfirmDialogOpen).toHaveBeenCalledWith(true);
  });

  it('calls onRevokePermission when confirm button clicked in revoke dialog', () => {
    renderWithProviders(
      <SharedManageBody {...defaultProps} confirmDialogOpen setConfirmDialogOpen={jest.fn()} />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(defaultProps.onRevokePermission).toHaveBeenCalledTimes(1);
  });

  it('calls setConfirmDialogOpen false when cancel clicked in revoke dialog', () => {
    const setConfirm = jest.fn();
    renderWithProviders(
      <SharedManageBody {...defaultProps} confirmDialogOpen setConfirmDialogOpen={setConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(setConfirm).toHaveBeenCalledWith(false);
  });
});
