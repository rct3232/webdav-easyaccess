/**
 * BaseFolderTreeItem tests.
 * Verifies observable outcomes per spec: expand/collapse, nodeId click, drop, permission-based disable.
 * @see docs/spec/client/components/folder-tree/BaseFolderTreeItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import BaseFolderTreeItem from '../BaseFolderTreeItem';

import folderTreeGateway from '../../../services/folderTreeGateway';

jest.mock('../../../services/folderTreeGateway', () => {
  const { createFolderTreeGatewayMock } = require('../../../testing/mocks/serviceMocks');
  return createFolderTreeGatewayMock();
});

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
  node: { nodeId: 10, name: 'testuser' },
  currentNodeId: null,
  onNodeClick: jest.fn(),
  expandedNodeIds: new Set(),
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

  it('calls onNodeClick with the nodeId when folder name clicked', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} />);
    fireEvent.click(screen.getByText('testuser'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(10);
  });

  it('calls onToggleExpand with the nodeId when expand icon clicked', () => {
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps}>
        {[
          {
            nodeId: 11,
            name: 'docs',
            hasReadPermission: true,
            hasWritePermission: true,
            isHidden: false,
          },
        ]}
      </BaseFolderTreeItem>
    );

    const button = screen.getByRole('button', { name: /testuser/i });
    const svgs = button.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    // First SVG corresponds to the expand/collapse chevron icon.
    fireEvent.click(svgs[0]);

    expect(defaultProps.onToggleExpand).toHaveBeenCalledWith(10);
  });

  it('loads children and shows them when expanded', async () => {
    const children = [
      {
        nodeId: 11,
        name: 'docs',
        hasReadPermission: true,
        hasWritePermission: true,
        isHidden: false,
      },
    ];
    folderTreeGateway.listFolderChildren.mockResolvedValue(children);
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} expandedNodeIds={new Set([10])}>
        {[]}
      </BaseFolderTreeItem>
    );
    await waitFor(() => {
      expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 10 })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });

  it('disables item when hasReadPermission is false', () => {
    renderWithProviders(<BaseFolderTreeItem {...defaultProps} hasReadPermission={false} />);
    const button = screen.getByRole('button', { name: /testuser/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onNodeClick when disabled and clicked', () => {
    const onNodeClick = jest.fn();
    renderWithProviders(
      <BaseFolderTreeItem {...defaultProps} hasReadPermission={false} onNodeClick={onNodeClick} />
    );
    const button = screen.getByRole('button', { name: /testuser/i });
    fireEvent.click(button);
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
