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
  const unsubscribe = () => {};
  return {
    getRecentFiles: jest.fn().mockResolvedValue([]),
    onRecentFilesChange: () => unsubscribe,
  };
});

jest.mock('../../../services/permissionService', () => ({
  getUserPermissions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../services/fileService', () => ({
  listFiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../utils/localStorage', () => ({
  getShowHiddenFiles: () => false,
  setShowHiddenFiles: () => {},
  getViewMode: () => 'list',
  setViewMode: () => {},
  getSortMode: () => 'name_asc',
  setSortMode: () => {},
}));

const defaultProps = {
  currentPath: '/',
  onPathClick: jest.fn(),
  onFileClick: jest.fn(),
  user: { id: '1', username: 'testuser', is_admin: false },
  treeUpdateTrigger: null,
  onCreateFolder: jest.fn(),
  onUploadFile: jest.fn(),
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

  it('calls onCreateFolder when create folder button clicked', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTitle(/create folder/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle(/create folder/i));
    expect(defaultProps.onCreateFolder).toHaveBeenCalled();
  });

  it('calls onUploadFile when upload button clicked', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTitle(/upload file/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle(/upload file/i));
    expect(defaultProps.onUploadFile).toHaveBeenCalled();
  });

  it('disables create and upload when hasWritePermission false', async () => {
    renderWithProviders(<FolderTree {...defaultProps} hasWritePermission={false} />);
    await waitFor(() => {
      expect(screen.getByTitle(/create folder/i)).toBeDisabled();
      expect(screen.getByTitle(/upload file/i)).toBeDisabled();
    });
  });
});
