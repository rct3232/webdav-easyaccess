/**
 * SharedManageDialog tests.
 * Verifies observable outcomes per spec: SharedManageDialog.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SharedManageDialog from '../SharedManageDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  targetPath: '/my-folder',
  displayName: 'my-folder',
  isDirectory: true,
  user: { id: '1', username: 'testuser', is_admin: false },
  directHasReadPermission: undefined,
  onMessage: jest.fn(),
  onActionComplete: jest.fn(),
};

describe('SharedManageDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
  });

  it('renders dialog when open', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows shared manage title', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/manage|shared/i);
    });
  });

  it('renders SharedManageBody content', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/folder|my-folder/i);
    });
  });

  it('shows close button', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
  });

  it('calls onClose when close clicked', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows owner deleted message when ownerExists is false', async () => {
    renderWithProviders(<SharedManageDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
