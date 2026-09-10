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
import {
  getFolderStats,
  getFileVersions,
  restoreFileVersion,
  downloadFileVersion,
} from '../../../services/fileService';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

jest.mock('../../../services/permissionService', () => {
  const { createPermissionServiceMock } = require('../../../testing/mocks/serviceMocks');
  return createPermissionServiceMock({
    getFolderPermissions: jest.fn().mockResolvedValue([]),
    getUserPermissions: jest.fn().mockResolvedValue([]),
    grantPermission: jest.fn().mockResolvedValue(),
    revokePermission: jest.fn().mockResolvedValue(),
    checkPermission: jest.fn().mockResolvedValue({}),
    listFilePermissions: jest.fn().mockResolvedValue([]),
  });
});

jest.mock('../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../testing/mocks/serviceMocks');
  return createFileServiceMock({
    getFolderStats: jest.fn().mockResolvedValue({ fileCount: 42, totalSize: 2048 }),
    getFileVersions: jest.fn().mockResolvedValue({
      nodeId: 5,
      currentVersionNumber: 2,
      versions: [
        {
          versionNumber: 2,
          status: 'active',
          createdAt: '2026-09-10T10:00:00Z',
          size: 2048,
          isCurrent: true,
        },
        {
          versionNumber: 1,
          status: 'history',
          createdAt: '2026-09-09T10:00:00Z',
          size: 1024,
          isCurrent: false,
        },
      ],
    }),
  });
});

const fileProps = {
  nodeId: 5,
  parentNodeId: 1,
  path: '/docs/readme.txt',
  basename: 'readme.txt',
  name: 'readme.txt',
  type: 'file',
  size: 1024,
  lastmod: '2024-01-15T10:00:00Z',
  mime: 'text/plain',
};

const folderProps = {
  nodeId: 2,
  path: '/docs',
  basename: 'docs',
  name: 'docs',
  type: 'directory',
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  file: fileProps,
  activeFileStorage: 's3',
};

describe('FilePropertiesDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
    getFolderPermissions.mockResolvedValue([]);
    getFolderStats.mockResolvedValue({ fileCount: 42, totalSize: 2048 });
    // CRA jest config sets resetMocks: true — factory-level implementations
    // are wiped before every test, so re-seed the version mocks here.
    getFileVersions.mockResolvedValue({
      nodeId: 5,
      currentVersionNumber: 2,
      versions: [
        {
          versionNumber: 2,
          status: 'active',
          createdAt: '2026-09-10T10:00:00Z',
          size: 2048,
          isCurrent: true,
        },
        {
          versionNumber: 1,
          status: 'history',
          createdAt: '2026-09-09T10:00:00Z',
          size: 1024,
          isCurrent: false,
        },
      ],
    });
    restoreFileVersion.mockResolvedValue({
      messageCode: 'serverMessages.files.versionRestored',
      nodeId: 5,
      restoredVersionNumber: 1,
    });
    downloadFileVersion.mockResolvedValue(undefined);
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
    renderWithProviders(<FilePropertiesDialog {...defaultProps} file={folderProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('when directory, dialog shows folder stats (file count and size) after load', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} file={folderProps} />);
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

  it('for a file, fetches folder permissions with parent nodeId and the file nodeId', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
    await waitFor(() => {
      expect(getFolderPermissions).toHaveBeenCalledWith(1, 5);
    });
    expect(getFolderStats).not.toHaveBeenCalled();
  });

  it('for a directory, fetches folder permissions and stats by nodeId', async () => {
    renderWithProviders(<FilePropertiesDialog {...defaultProps} file={folderProps} />);
    await waitFor(() => {
      expect(getFolderPermissions).toHaveBeenCalledWith(2);
      expect(getFolderStats).toHaveBeenCalledWith(2);
    });
  });

  describe('version history tabs (DEF-11)', () => {
    it('renders the tab bar between title and body with info active by default', async () => {
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Info' })).toBeInTheDocument();
      });
      expect(screen.getByRole('tab', { name: 'Versions' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
    });

    it('hides the versions tab for a directory', async () => {
      renderWithProviders(<FilePropertiesDialog {...defaultProps} file={folderProps} />);
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Info' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('tab', { name: 'Versions' })).not.toBeInTheDocument();
    });

    it('hides the versions tab when activeFileStorage is not s3', async () => {
      renderWithProviders(<FilePropertiesDialog {...defaultProps} activeFileStorage="webdav" />);
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Info' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('tab', { name: 'Versions' })).not.toBeInTheDocument();
    });

    it('versions tab loads and lists versions via getFileVersions on activation', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);

      await user.click(screen.getByRole('tab', { name: 'Versions' }));

      await waitFor(() => {
        expect(getFileVersions).toHaveBeenCalledWith(5);
      });
      await waitFor(() => {
        expect(screen.getByText('v1')).toBeInTheDocument();
      });
      expect(screen.getByText('v2')).toBeInTheDocument();
      expect(screen.getByText('Current')).toBeInTheDocument();
    });

    it('download icon button triggers downloadFileVersion', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
      await user.click(screen.getByRole('tab', { name: 'Versions' }));
      await waitFor(() => {
        expect(screen.getByText('v1')).toBeInTheDocument();
      });

      // Rows render newest first (v2 current, then v1) — click the first.
      const downloadButtons = screen.getAllByRole('button', {
        name: /download this version/i,
      });
      await user.click(downloadButtons[0]);

      expect(downloadFileVersion).toHaveBeenCalledWith(5, 2);
    });

    it('restore icon button opens the confirm dialog and calls restoreFileVersion on confirm', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
      await user.click(screen.getByRole('tab', { name: 'Versions' }));
      await waitFor(() => {
        expect(screen.getByText('v1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /restore this version/i }));

      expect(await screen.findByText(/restore version 1 of this file/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^confirm$/i }));

      await waitFor(() => {
        expect(restoreFileVersion).toHaveBeenCalledWith(5, 1);
      });
      await waitFor(() => {
        expect(screen.getByText(/version 1 restored/i)).toBeInTheDocument();
      });
    });

    it('shows the load-failure message without crashing', async () => {
      getFileVersions.mockRejectedValueOnce(new Error('boom'));
      const user = userEvent.setup();
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
      await user.click(screen.getByRole('tab', { name: 'Versions' }));

      await waitFor(() => {
        expect(screen.getByText(/failed to load version history/i)).toBeInTheDocument();
      });
    });

    it('shows an empty-history message when no versions exist', async () => {
      getFileVersions.mockResolvedValue({
        nodeId: 5,
        currentVersionNumber: null,
        versions: [],
      });
      const user = userEvent.setup();
      renderWithProviders(<FilePropertiesDialog {...defaultProps} />);
      await user.click(screen.getByRole('tab', { name: 'Versions' }));

      await waitFor(() => {
        expect(screen.getByText(/no previous versions/i)).toBeInTheDocument();
      });
    });
  });
});
