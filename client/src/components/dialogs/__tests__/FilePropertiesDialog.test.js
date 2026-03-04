/**
 * FilePropertiesDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/FilePropertiesDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import FilePropertiesDialog from '../FilePropertiesDialog';
import { getFolderPermissions } from '../../../services/permissionService';
import { getFolderStats } from '../../../services/fileService';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

jest.mock('../../../services/permissionService', () => ({
  getFolderPermissions: jest.fn().mockResolvedValue([]),
  getUserPermissions: jest.fn().mockResolvedValue([]),
  grantPermission: jest.fn().mockResolvedValue(),
  revokePermission: jest.fn().mockResolvedValue(),
  checkPermission: jest.fn().mockResolvedValue({}),
  listFilePermissions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../services/fileService', () => ({
  getFolderStats: jest.fn().mockResolvedValue({ fileCount: 42, totalSize: 2048 }),
}));

const fileProps = {
  path: '/docs/readme.txt',
  basename: 'readme.txt',
  name: 'readme.txt',
  type: 'file',
  size: 1024,
  lastmod: '2024-01-15T10:00:00Z',
  mime: 'text/plain',
};

const folderProps = {
  path: '/docs',
  basename: 'docs',
  name: 'docs',
  type: 'directory',
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  file: fileProps,
};

describe('FilePropertiesDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
    getFolderPermissions.mockResolvedValue([]);
    getFolderStats.mockResolvedValue({ fileCount: 42, totalSize: 2048 });
  });

  it('returns null when file is not provided', () => {
    const { container } = renderWithProviders(
      <FilePropertiesDialog {...defaultProps} file={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with file properties when open', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
    expect(screen.getByText(/properties/i)).toBeInTheDocument();
  });

  it('shows file type and path', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('/docs/readme.txt')).toBeInTheDocument();
  });

  it('calls onClose when Close button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders folder type for directory', async () => {
    renderWithProviders(
      <FilePropertiesDialog {...defaultProps} file={folderProps} />
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('when directory, dialog shows folder stats (file count and size) after load', async () => {
    renderWithProviders(
      <FilePropertiesDialog {...defaultProps} file={folderProps} />
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });
    expect(screen.getByText(/2\s*KB/i)).toBeInTheDocument();
  });

  it('when file, size row shows file size not folder stats', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/1\s*KB/i)).toBeInTheDocument();
  });
});
