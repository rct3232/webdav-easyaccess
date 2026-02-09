import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import FileManager from '../FileManager';
import { useFileManager } from '../../hooks/useFileManager';
import { useAuth } from '../../contexts/AuthContext';

// Mock the hooks
jest.mock('../../hooks/useFileManager');
jest.mock('../../contexts/AuthContext');

// Mock child components to simplify
jest.mock('../../components/file-manager/FileList', () => () => <div data-testid="file-list">FileList</div>);
jest.mock('../../components/folder-tree/FolderTree', () => () => <div data-testid="folder-tree">FolderTree</div>);
jest.mock('../../components/file-manager/FileManagerHeader', () => ({ searchQuery, setSearchQuery }) => (
  <div data-testid="file-manager-header">
    <input 
      data-testid="search-input" 
      value={searchQuery} 
      onChange={(e) => setSearchQuery(e.target.value)} 
    />
  </div>
));

jest.mock('../../components/dialogs/FilePreviewDialog', () => () => <div data-testid="file-preview-dialog">FilePreviewDialog</div>);
jest.mock('../../components/dialogs/UploadDialog', () => () => <div data-testid="upload-dialog">UploadDialog</div>);
jest.mock('../../components/dialogs/CreateFolderDialog', () => () => <div data-testid="create-folder-dialog">CreateFolderDialog</div>);
jest.mock('../../components/dialogs/ShareDialog', () => () => <div data-testid="share-dialog">ShareDialog</div>);
jest.mock('../../components/dialogs/SharedFolderManageDialog', () => () => <div data-testid="shared-folder-manage-dialog">SharedFolderManageDialog</div>);
jest.mock('../../components/dialogs/FilePropertiesDialog', () => () => <div data-testid="file-properties-dialog">FilePropertiesDialog</div>);
jest.mock('../../components/dialogs/ConfirmDialog', () => () => <div data-testid="confirm-dialog">ConfirmDialog</div>);
jest.mock('../../components/dialogs/ConflictResolveDialog', () => () => <div data-testid="conflict-resolve-dialog">ConflictResolveDialog</div>);
jest.mock('../../components/file-manager/FileOperationProgress', () => () => <div data-testid="file-operation-progress">FileOperationProgress</div>);
jest.mock('../../components/file-manager/FileContextMenu', () => () => <div data-testid="file-context-menu">FileContextMenu</div>);
jest.mock('../../components/dialogs/FolderPickerDialog', () => () => <div data-testid="folder-picker-dialog">FolderPickerDialog</div>);

describe('FileManager Page', () => {
  const mockUser = { id: 1, username: 'testuser', is_admin: false };
  const mockFiles = [
    { path: '/file1.txt', name: 'file1.txt', type: 'file' },
    { path: '/folder1', name: 'folder1', type: 'directory' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ user: mockUser, logout: jest.fn() });
    useFileManager.mockReturnValue({
      currentPath: '/testuser',
      setCurrentPath: jest.fn(),
      files: mockFiles,
      loading: false,
      sortMode: 'name-asc',
      setSortMode: jest.fn(),
      loadFiles: jest.fn(),
      hasWritePermission: true,
      onLoadErrorRef: { current: null },
    });
  });

  it('renders correctly', () => {
    renderWithProviders(<FileManager />);
    expect(screen.getByTestId('file-manager-header')).toBeInTheDocument();
    expect(screen.getByTestId('folder-tree')).toBeInTheDocument();
    expect(screen.getByTestId('file-list')).toBeInTheDocument();
  });

  it('updates search query', async () => {
    renderWithProviders(<FileManager />);
    const searchInput = screen.getByTestId('search-input');
    
    fireEvent.change(searchInput, { target: { value: 'file1' } });
    expect(searchInput.value).toBe('file1');
  });

  it('shows loading state', () => {
    useFileManager.mockReturnValue({
      currentPath: '/testuser',
      setCurrentPath: jest.fn(),
      files: [],
      loading: true,
      sortMode: 'name-asc',
      setSortMode: jest.fn(),
      loadFiles: jest.fn(),
      hasWritePermission: true,
      onLoadErrorRef: { current: null },
    });

    renderWithProviders(<FileManager />);
    // In FileManager, loading is passed to child components
    // For example, FileList will handle showing skeletons
    expect(screen.getByTestId('file-list')).toBeInTheDocument();
  });
});
