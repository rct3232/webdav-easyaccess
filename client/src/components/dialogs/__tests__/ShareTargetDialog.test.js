/**
 * ShareTargetDialog tests.
 * Verifies observable outcomes per spec: ShareTargetDialog.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareTargetDialog from '../ShareTargetDialog';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

const adminFile = {
  path: '/testuser/docs/file.pdf',
  basename: 'file.pdf',
  type: 'file',
  hasAdminPermission: true,
};

const adminFolder = {
  path: '/testuser/docs',
  basename: 'docs',
  type: 'directory',
  hasAdminPermission: true,
};

const nonAdminFile = {
  path: '/testuser/docs/file.pdf',
  basename: 'file.pdf',
  type: 'file',
  hasReadPermission: true,
};

const adminUser = { id: '1', username: 'admin', is_admin: true };
const nonAdminUser = { id: '1', username: 'user', is_admin: false };

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  file: adminFolder,
  user: adminUser,
  onMessage: jest.fn(),
  onSave: jest.fn(),
};

describe('ShareTargetDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
  });

  it('renders dialog when open', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows share with title and display name', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} file={adminFolder} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/docs/i);
      expect(screen.getByRole('dialog')).toHaveTextContent(/share|with/i);
    });
  });

  it('shows cancel and save when admin', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });
  });

  it('calls onClose when cancel clicked', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows user search when admin', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search|user/i)).toBeInTheDocument();
    });
  });

  it('shows SharedManageBody when non-admin', async () => {
    renderWithProviders(
      <ShareTargetDialog
        {...defaultProps}
        file={nonAdminFile}
        user={nonAdminUser}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('shows external share section when admin and file (not folder)', async () => {
    renderWithProviders(<ShareTargetDialog {...defaultProps} file={adminFile} />);
    await waitFor(() => {
      expect(screen.getByText(/external share link/i)).toBeInTheDocument();
    });
  });
});
