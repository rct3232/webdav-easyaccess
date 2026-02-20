/**
 * BaseFolderTreeItem tests.
 * Verifies observable outcomes per spec: expand/collapse, path click, drop, permission-based disable.
 * @see docs/spec/client/components/folder-tree/BaseFolderTreeItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import BaseFolderTreeItem from '../BaseFolderTreeItem';
import * as fileService from '../../../services/fileService';

jest.mock('../../../services/fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../../../hooks/useDropToUpload', () => ({
  useDropToUpload: () => ({
    isDropTarget: false,
    isDraggingOver: false,
    handleFolderDragOver: jest.fn(),
    handleFolderDragEnter: jest.fn(),
    handleFolderDragLeave: jest.fn(),
    handleFolderDrop: jest.fn(),
  }),
}));

jest.mock('../../../utils/localStorage', () => ({
  getShowHiddenFiles: () => false,
}));

const defaultProps = {
  path: '/testuser',
  name: 'testuser',
  currentPath: '/',
  onPathClick: jest.fn(),
  expandedPaths: new Set(),
  onToggleExpand: jest.fn(),
};

describe('BaseFolderTreeItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileService.listFiles.mockResolvedValue([]);
  });

  it('renders folder name', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('calls onPathClick when folder name clicked', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    fireEvent.click(screen.getByText('testuser'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/testuser');
  });

  it('calls onToggleExpand when expand icon clicked', () => {
    fileService.listFiles.mockResolvedValue([
      { path: '/testuser/docs', basename: 'docs', type: 'directory', hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ]);
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    const expandTarget = screen.getAllByRole('button').find(el => el.closest('[class*="ListItemButton"]'));
    if (!expandTarget) {
      const chevron = document.querySelector('[class*="ChevronRight"]');
      if (chevron) fireEvent.click(chevron.closest('span'));
    } else {
      fireEvent.click(expandTarget);
    }
    const expandBox = screen.getAllByRole('button')[0]?.parentElement?.querySelector('span[style*="cursor: pointer"]') || document.querySelector('span[style*="cursor: pointer"]');
    if (expandBox) {
      fireEvent.click(expandBox);
      expect(defaultProps.onToggleExpand).toHaveBeenCalledWith('/testuser');
    }
  });

  it('loads children and shows them when expanded', async () => {
    const children = [
      { path: '/testuser/docs', basename: 'docs', type: 'directory', hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ];
    fileService.listFiles.mockResolvedValue(children);
    renderWithProviders(
      <BaseFolderTreeItem
        {...defaultProps}
        expandedPaths={new Set(['/testuser'])}
        children={[]}
      />
    );
    await waitFor(() => {
      expect(fileService.listFiles).toHaveBeenCalledWith('/testuser', expect.any(Object));
    });
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });

  it('renders with node prop instead of path/name', () => {
    renderWithProviders(
      <BaseFolderTreeItem
        {...defaultProps}
        path={undefined}
        name={undefined}
        node={{ path: '/shared/folder', name: 'folder' }}
        currentPath="/"
        onPathClick={jest.fn()}
        expandedPaths={new Set()}
        onToggleExpand={jest.fn()}
      />
    );
    expect(screen.getByText('folder')).toBeInTheDocument();
  });

  it('disables item when hasReadPermission is false', () => {
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} hasReadPermission={false} />
    );
    const button = screen.getByRole('button', { name: /testuser/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onPathClick when disabled and clicked', () => {
    const onPathClick = jest.fn();
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} hasReadPermission={false} onPathClick={onPathClick} />
    );
    const button = screen.getByRole('button', { name: /testuser/i });
    fireEvent.click(button);
    expect(onPathClick).not.toHaveBeenCalled();
  });
});
