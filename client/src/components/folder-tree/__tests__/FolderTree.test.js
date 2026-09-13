/**
 * FolderTree tests.
 * Verifies observable outcomes: home item, nodeId click, recent notification reload.
 * Mocks services only (recentFiles, permissionService, fileService, localStorage).
 * @see docs/spec/client/components/folder-tree/FolderTree.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FolderTree from '../FolderTree';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';
jest.mock('../../../services/recentFilesRepository', () => {
  const { createRecentFilesRepositoryMock } = require('../../../testing/mocks/serviceMocks');
  return createRecentFilesRepositoryMock();
});

jest.mock('../../../services/recentFilesNotifier', () => {
  const { createRecentFilesNotifierMock } = require('../../../testing/mocks/serviceMocks');
  return createRecentFilesNotifierMock();
});
jest.mock('../../../services/permissionService', () => {
  const { createPermissionServiceMock } = require('../../../testing/mocks/serviceMocks');
  return createPermissionServiceMock({
    getUserPermissions: jest.fn().mockResolvedValue([]),
  });
});
jest.mock('../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../testing/mocks/serviceMocks');
  return createFileServiceMock({
    listFiles: jest.fn().mockResolvedValue([]),
    resolvePath: jest.fn().mockResolvedValue({ nodeId: 3 }),
  });
});
jest.mock('../../../utils/localStorage', () => {
  const { createLocalStorageUiMock } = require('../../../testing/mocks/serviceMocks');
  return createLocalStorageUiMock({
    getSortMode: () => 'name_asc',
  });
});

const defaultProps = {
  currentNodeId: null,
  currentPath: '/',
  onNodeClick: jest.fn(),
  onFileClick: jest.fn(),
  user: { id: '1', username: 'testuser', is_admin: false, rootNodeId: 1 },
  treeUpdateTrigger: null,
  hasWritePermission: true,
  onExplorerDrop: jest.fn(),
  isMobile: false,
  ancestors: [],
};

describe('FolderTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onRecentFilesChange.mockImplementation(() => jest.fn());
  });

  it('renders the Home row for a non-admin user', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    expect(screen.queryByText('testuser')).not.toBeInTheDocument();
  });

  it('renders home label for admin user', async () => {
    renderWithProviders(
      <FolderTree {...defaultProps} user={{ id: '1', username: 'admin', is_admin: true }} />
    );
    await waitFor(() => {
      expect(screen.getByText(/home/i)).toBeInTheDocument();
    });
  });

  it('calls onNodeClick with the home nodeId when home clicked', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Home'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(1);
  });

  it('routes non-share section clicks through onLeaveShareClick when a share-link section is present', async () => {
    const onLeaveShareClick = jest.fn();
    renderWithProviders(
      <FolderTree
        {...defaultProps}
        shareLinkSection={{
          shareRootNodeId: 10,
          shareRootPath: '/shared',
          shareRootName: 'Shared',
          shareToken: 'st',
          onNodeClick: jest.fn(),
        }}
        onLeaveShareClick={onLeaveShareClick}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Home'));
    expect(onLeaveShareClick).toHaveBeenCalledWith(1);
    expect(defaultProps.onNodeClick).not.toHaveBeenCalledWith(1);
  });

  it('reloads recent section entries when recent-file notifications fire', async () => {
    let notifyRecentChange;
    onRecentFilesChange.mockImplementationOnce((callback) => {
      notifyRecentChange = callback;
      return jest.fn();
    });
    getRecentFiles
      .mockResolvedValueOnce([{ path: '/testuser/old.txt', name: 'old.txt', type: 'file' }])
      .mockResolvedValueOnce([{ path: '/testuser/new.txt', name: 'new.txt', type: 'file' }]);

    renderWithProviders(<FolderTree {...defaultProps} currentPath="/__recent__" />);

    await waitFor(() => {
      expect(screen.getByText('old.txt')).toBeInTheDocument();
    });

    expect(typeof notifyRecentChange).toBe('function');
    act(() => {
      notifyRecentChange();
    });

    await waitFor(() => {
      expect(screen.getByText('new.txt')).toBeInTheDocument();
    });
  });
  describe('bottom-pinned trash row (DEF-16 P9)', () => {
    it('renders the pinned trash row below the tree and navigates to /__trash__', () => {
      renderWithProviders(<FolderTree {...defaultProps} />);
      expect(screen.getByTestId('sidebar-trash')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-trash-icon')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Trash' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
      expect(defaultProps.onNodeClick).toHaveBeenCalledWith('/__trash__');
    });

    it('highlights the trash row when the trash view is active', () => {
      renderWithProviders(<FolderTree {...defaultProps} currentPath="/__trash__" />);
      expect(screen.getByRole('button', { name: 'Trash' }).className).toContain('Mui-selected');
    });

    it('is not rendered for anonymous share-link viewers', () => {
      renderWithProviders(
        <FolderTree
          {...defaultProps}
          user={null}
          shareLinkSection={{
            shareRootNodeId: 5,
            shareRootPath: '/shared',
            shareRootName: 'Shared',
            shareToken: 'tok',
            onNodeClick: jest.fn(),
          }}
        />
      );
      expect(screen.queryByTestId('sidebar-trash')).not.toBeInTheDocument();
    });
  });
});
