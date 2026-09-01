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

  it('renders home item for non-admin user', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
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
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('testuser'));
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
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('testuser'));
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
});
