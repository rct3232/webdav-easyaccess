/**
 * ShareFolderTree tests.
 * Verifies observable outcomes per spec: ShareFolderTree.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareFolderTree from '../ShareFolderTree';

const createNode = (path, name, children = []) => ({
  path,
  name,
  children,
});

const defaultProps = {
  rootPath: '/docs',
  folderTree: new Map([
    ['/docs', createNode('/docs', 'docs', [{ path: '/docs/sub', name: 'sub', children: [] }])],
    ['/docs/sub', createNode('/docs/sub', 'sub', [])],
  ]),
  expandedPaths: new Set(),
  loadingPaths: new Set(),
  toggleExpand: jest.fn(),
  folderPermissions: new Map(),
  isAdminMode: false,
  userInfoMap: new Map(),
  getUserName: jest.fn((id) => `user-${id}`),
  hasPermissionChanged: jest.fn(() => false),
  setFolderMenuAnchor: jest.fn(),
  setFolderMenuPath: jest.fn(),
  loadingPermissions: false,
  isMobile: false,
};

describe('ShareFolderTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when node is missing', () => {
    const { container } = renderWithProviders(
      <ShareFolderTree
        {...defaultProps}
        rootPath="/nonexistent"
        folderTree={new Map()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders folder name', () => {
    renderWithProviders(<ShareFolderTree {...defaultProps} />);
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('calls toggleExpand when expand button clicked', () => {
    renderWithProviders(<ShareFolderTree {...defaultProps} />);
    const expandBtn = screen.getByRole('button', { name: '' });
    fireEvent.click(expandBtn);
    expect(defaultProps.toggleExpand).toHaveBeenCalledWith('/docs');
  });

  it('shows children when expanded', () => {
    renderWithProviders(
      <ShareFolderTree
        {...defaultProps}
        expandedPaths={new Set(['/docs'])}
      />
    );
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('opens folder menu when permission button clicked', () => {
    renderWithProviders(
      <ShareFolderTree
        {...defaultProps}
        folderPermissions={new Map([['/docs', new Map([['u1', 'read']])]])}
        users={[{ id: 'u2', username: 'user2', is_admin: false }]}
        user={{ id: 'me' }}
      />
    );
    const buttons = screen.getAllByRole('button');
    const permBtn = buttons[1];
    fireEvent.click(permBtn);
    expect(defaultProps.setFolderMenuPath).toHaveBeenCalledWith('/docs');
  });
});
