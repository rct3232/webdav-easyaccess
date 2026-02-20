/**
 * SharedFoldersSection tests.
 * Verifies observable outcomes per spec: non-admin with shared folders renders; admin/empty returns null; expand, path click.
 * @see docs/spec/client/components/folder-tree/SharedFoldersSection.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SharedFoldersSection from '../SharedFoldersSection';

jest.mock('../BaseFolderTreeItem', () => ({ node, onPathClick, onToggleExpand }) => (
  <div data-testid="base-folder-tree-item">
    <button onClick={() => onPathClick(node.path)}>{node.name}</button>
    <button onClick={() => onToggleExpand(node.path)}>Expand</button>
  </div>
));

const sharedFolders = [
  { folder_path: '/__shared__/docs', permission: 'read' },
  { folder_path: '/__shared__/project', permission: 'write' },
];

const defaultProps = {
  sharedFolders,
  sharedExpanded: false,
  handleSharedToggle: jest.fn(),
  handleSharedClick: jest.fn(),
  currentPath: '/',
  buildSharedFolderTree: () => [
    { path: '/__shared__/docs', name: 'docs' },
    { path: '/__shared__/project', name: 'project' },
  ],
  handleSharedFolderClick: jest.fn(),
  expandedPaths: new Set(),
  handleToggleExpand: jest.fn(),
  user: { id: '1', username: 'user', is_admin: false },
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

  it('calls handleSharedFolderClick when folder clicked', () => {
    renderWithProviders(
      <SharedFoldersSection {...defaultProps} sharedExpanded={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'docs' }));
    expect(defaultProps.handleSharedFolderClick).toHaveBeenCalledWith('/__shared__/docs');
  });
});
