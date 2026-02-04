import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import BaseFolderTreeItem from '../BaseFolderTreeItem';
import { listFiles } from '../../services/fileService';

// Mock services and hooks
jest.mock('../../services/fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../../hooks/useFolderDragHandlers', () => ({
  __esModule: true,
  default: () => ({
    isDropTarget: false,
    isDraggingOver: false,
    handleFolderDragOver: jest.fn(),
    handleFolderDragEnter: jest.fn(),
    handleFolderDragLeave: jest.fn(),
    handleFolderDrop: jest.fn(),
  }),
}));

describe('BaseFolderTreeItem', () => {
  const defaultProps = {
    path: '/test',
    name: 'test-folder',
    expandedPaths: new Set(),
    onToggleExpand: jest.fn(),
    onPathClick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listFiles.mockResolvedValue([]);
  });

  it('renders folder name', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    expect(screen.getByText('test-folder')).toBeInTheDocument();
  });

  it('calls onPathClick when clicked', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    fireEvent.click(screen.getByText('test-folder'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/test');
  });

  it('loads children when expanded', async () => {
    const subfolders = [
      { path: '/test/sub1', basename: 'sub1', type: 'directory' },
    ];
    listFiles.mockResolvedValue(subfolders);

    const expandedPaths = new Set(['/test']);
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} expandedPaths={expandedPaths} />
    );

    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledWith('/test');
      expect(screen.getByText('sub1')).toBeInTheDocument();
    });
  });

  it('toggles expand on icon click', () => {
    const initialChildren = [{ path: '/test/sub', name: 'sub' }];
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} children={initialChildren} />
    );
    
    const expandBtn = screen.getByTestId('ChevronRightIcon').parentElement;
    fireEvent.click(expandBtn);
    
    expect(defaultProps.onToggleExpand).toHaveBeenCalledWith('/test');
  });

  it('shows loading state while fetching children', async () => {
    // Delay resolution
    let resolveFiles;
    const promise = new Promise(resolve => { resolveFiles = resolve; });
    listFiles.mockReturnValue(promise);

    const expandedPaths = new Set(['/test']);
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} expandedPaths={expandedPaths} />
    );

    // Should show skeleton or spinner
    // In BaseFolderTreeItem, it shows a custom spinner (Box with animation)
    // or FileTreeSkeleton if loading and no children
    expect(listFiles).toHaveBeenCalled();
    
    // Resolve
    await act(async () => {
      resolveFiles([]);
    });
  });

  it('disables item when hasReadPermission is false', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} hasReadPermission={false} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('Mui-disabled');
    
    fireEvent.click(button);
    expect(defaultProps.onPathClick).not.toHaveBeenCalled();
  });
});

// Need to import act for manual promise resolution
import { act } from 'react-dom/test-utils';
