/**
 * SharedFoldersSection tests.
 * Verifies observable outcomes per spec: non-admin with shared folders renders; admin/empty returns null; expand, node click.
 * @see docs/spec/client/components/folder-tree/SharedFoldersSection.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SharedFoldersSection from '../SharedFoldersSection';

jest.mock('../BaseFolderTreeItem', () =>
  function MockBaseFolderTreeItem({ node, onNodeClick, onToggleExpand }) {
    return (
      <div data-testid="base-folder-tree-item">
        <button onClick={() => onNodeClick(node.nodeId)}>{node.name}</button>
        <button onClick={() => onToggleExpand(node.nodeId)}>Expand</button>
      </div>
    );
  }
);

const sharedFolders = [
  { nodeId: 10, permission: 'read' },
  { nodeId: 20, permission: 'write' },
];

const defaultProps = {
  sharedFolders,
  sharedExpanded: false,
  handleSharedToggle: jest.fn(),
  handleSharedClick: jest.fn(),
  currentNodeId: null,
  buildSharedFolderTree: () => [
    { nodeId: 10, name: 'docs' },
    { nodeId: 20, name: 'project' },
  ],
  onNodeClick: jest.fn(),
  expandedNodeIds: new Set(),
  onToggleExpand: jest.fn(),
  user: { id: '1', username: 'user', is_admin: false, rootNodeId: 1 },
};

describe('SharedFoldersSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when user is admin', () => {
    renderWithProviders(
      <SharedFoldersSection {...defaultProps} user={{ ...defaultProps.user, is_admin: true }} />
    );
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });

  it('returns null when sharedFolders is empty', () => {
    renderWithProviders(
      <SharedFoldersSection {...defaultProps} sharedFolders={[]} />
    );
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });

  it('renders when non-admin and shared folders exist', () => {
    renderWithProviders(<SharedFoldersSection {...defaultProps} />);
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('calls handleSharedClick when section header clicked', () => {
    renderWithProviders(<SharedFoldersSection {...defaultProps} />);
    fireEvent.click(screen.getByText('Shared'));
    expect(defaultProps.handleSharedClick).toHaveBeenCalled();
  });

  it('calls handleSharedToggle when expand icon clicked', () => {
    renderWithProviders(<SharedFoldersSection {...defaultProps} />);
    const row = screen.getByRole('button', { name: /shared/i });
    const listItemIcons = row.querySelectorAll('.MuiListItemIcon-root');
    const expandBox = listItemIcons[0]?.firstElementChild;
    expect(expandBox).toBeTruthy();
    fireEvent.click(expandBox);
    expect(defaultProps.handleSharedToggle).toHaveBeenCalled();
  });

  it('renders BaseFolderTreeItem children when expanded', () => {
    renderWithProviders(
      <SharedFoldersSection {...defaultProps} sharedExpanded={true} />
    );
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'project' })).toBeInTheDocument();
  });

  it('calls onNodeClick with the shared folder nodeId when clicked', () => {
    renderWithProviders(
      <SharedFoldersSection {...defaultProps} sharedExpanded={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'docs' }));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(10);
  });
});
