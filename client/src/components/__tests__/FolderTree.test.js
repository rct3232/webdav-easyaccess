import React from 'react';
import { renderWithProviders, screen, waitFor, fireEvent } from '../../test-utils';
import FolderTree from '../FolderTree';
import { listFiles } from '../../services/fileService';
import { getRecentFiles, onRecentFilesChange } from '../../utils/recentFiles';
import axios from 'axios';

jest.mock('axios');

jest.mock('../../services/fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../../utils/recentFiles', () => ({
  getRecentFiles: jest.fn(),
  onRecentFilesChange: jest.fn(),
}));

describe('FolderTree Component', () => {
  const mockUser = {
    id: 1,
    username: 'testuser',
    is_admin: false,
  };

  const defaultProps = {
    currentPath: '/testuser',
    onPathClick: jest.fn(),
    onFileClick: jest.fn(),
    user: mockUser,
    treeUpdateTrigger: null,
    onCreateFolder: jest.fn(),
    onUploadFile: jest.fn(),
    hasWritePermission: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listFiles.mockResolvedValue([]);
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockReturnValue(() => {}); // Explicitly return a function
    axios.get.mockResolvedValue({ data: [] });
  });

  it('renders home directory for regular user', async () => {
    renderWithProviders(<FolderTree {...defaultProps} />);
    
    expect(await screen.findByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('최근 항목')).toBeInTheDocument();
  });

  it('renders home directory for admin user', async () => {
    const adminUser = { ...mockUser, is_admin: true };
    renderWithProviders(<FolderTree {...defaultProps} user={adminUser} />);
    
    expect(await screen.findByText('홈')).toBeInTheDocument();
  });

  it('loads and displays subfolders when expanded', async () => {
    const subfolders = [
      { path: '/testuser/folder1', basename: 'folder1', type: 'directory', hasReadPermission: true },
      { path: '/testuser/folder2', basename: 'folder2', type: 'directory', hasReadPermission: true },
    ];
    listFiles.mockResolvedValue(subfolders);

    renderWithProviders(<FolderTree {...defaultProps} />);

    // Click expand icon (ChevronRight)
    const expandIcon = await screen.findByTestId('ChevronRightIcon');
    fireEvent.click(expandIcon);

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeInTheDocument();
      expect(screen.getByText('folder2')).toBeInTheDocument();
    });
  });

  it('calls onPathClick when a folder is clicked', async () => {
    const subfolders = [
      { path: '/testuser/folder1', basename: 'folder1', type: 'directory', hasReadPermission: true },
    ];
    listFiles.mockResolvedValue(subfolders);

    renderWithProviders(<FolderTree {...defaultProps} />);

    // Expand
    const expandIcon = await screen.findByTestId('ChevronRightIcon');
    fireEvent.click(expandIcon);
    
    const folder1 = await screen.findByText('folder1');
    fireEvent.click(folder1);

    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/testuser/folder1');
  });

  it('displays recent files when expanded', async () => {
    const recentFiles = [
      { path: '/testuser/recent.txt', name: 'recent.txt', type: 'file' },
    ];
    getRecentFiles.mockResolvedValue(recentFiles);

    renderWithProviders(<FolderTree {...defaultProps} />);

    // Click expand icon for "최근 항목"
    const recentItems = await screen.findByText('최근 항목');
    const expandIcon = recentItems.closest('div').parentElement.querySelector('[data-testid="ChevronRightIcon"]');
    fireEvent.click(expandIcon);

    await waitFor(() => {
      expect(screen.getByText('recent.txt')).toBeInTheDocument();
    });
  });

  it('loads shared folders for regular user', async () => {
    axios.get.mockResolvedValue({
      data: [
        { folder_path: '/other/shared', permission: 'read' }
      ]
    });

    renderWithProviders(<FolderTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('공유됨')).toBeInTheDocument();
    });

    // Expand "공유됨"
    const sharedItem = screen.getByText('공유됨');
    const expandIcon = sharedItem.closest('div').parentElement.querySelector('[data-testid="ChevronRightIcon"]');
    fireEvent.click(expandIcon);

    await waitFor(() => {
      expect(screen.getByText('shared')).toBeInTheDocument();
    });
  });

  it('handles refresh trigger', async () => {
    const { rerender } = renderWithProviders(<FolderTree {...defaultProps} />);
    
    // Rerender with refresh trigger
    rerender(<FolderTree {...defaultProps} treeUpdateTrigger={{ type: 'refresh' }} />);
    
    await waitFor(() => {
      expect(listFiles).toHaveBeenCalled();
    });
  });
});
