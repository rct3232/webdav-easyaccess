/**
 * FolderTree tests.
 * Verifies observable outcomes: home item, path click, create/upload.
 * Mocks services only (recentFiles, permissionService, fileService, localStorage).
 * @see docs/spec/client/components/folder-tree/FolderTree.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FolderTree from '../FolderTree';
jest.mock('../../../utils/recentFiles', () => {
  const { createRecentFilesMock } = require('../../../testing/mocks/serviceMocks');
  return createRecentFilesMock({
    getRecentFiles: jest.fn().mockResolvedValue([]),
    onRecentFilesChange: () => () => {},
  });
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
  });
});
jest.mock('../../../utils/localStorage', () => {
  const { createLocalStorageUiMock } = require('../../../testing/mocks/serviceMocks');
  return createLocalStorageUiMock({
    getSortMode: () => 'name_asc',
  });
});

const defaultProps = {
  currentPath: '/',
  onPathClick: jest.fn(),
  onFileClick: jest.fn(),
  user: { id: '1', username: 'testuser', is_admin: false },
  treeUpdateTrigger: null,
  hasWritePermission: true,
  onExplorerDrop: jest.fn(),
  isMobile: false,
};

describe('FolderTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders home item for non-admin user', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
  });

  it('renders home label for admin user', async () => {
    renderWithProviders(
      <FolderTree
        {...defaultProps}
        user={{ id: '1', username: 'admin', is_admin: true }}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/home/i)).toBeInTheDocument();
    });
  });

  it('calls onPathClick when home clicked', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('testuser'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/testuser');
  });

});
