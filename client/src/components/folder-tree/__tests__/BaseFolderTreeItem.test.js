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

jest.mock('../../../services/folderTreeGateway', () => ({
  __esModule: true,
  default: {
    listFolderChildren: jest.fn(),
  },
}));

import folderTreeGateway from '../../../services/folderTreeGateway';

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
    folderTreeGateway.listFolderChildren.mockResolvedValue([]);
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
    renderWithProviders(
      <BaseFolderTreeItem
        {...defaultProps}
        children={[{ path: '/testuser/docs', name: 'docs', hasReadPermission: true, hasWritePermission: true, isHidden: false }]}
      />
    );

    const button = screen.getByRole('button', { name: /testuser/i });
    const svgs = button.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    // First SVG corresponds to the expand/collapse chevron icon.
    fireEvent.click(svgs[0]);

    expect(defaultProps.onToggleExpand).toHaveBeenCalledWith('/testuser');
  });

  it('loads children and shows them when expanded', async () => {
    const children = [
      { path: '/testuser/docs', name: 'docs', hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ];
    folderTreeGateway.listFolderChildren.mockResolvedValue(children);
    renderWithProviders(
      <BaseFolderTreeItem
        {...defaultProps}
        expandedPaths={new Set(['/testuser'])}
        children={[]}
      />
    );
    await waitFor(() => {
      expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/testuser' })
      );
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
