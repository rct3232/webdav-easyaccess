/**
 * ShareFolderTree tests (nodeId-based).
 * Verifies observable outcomes per spec: ShareFolderTree.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareFolderTree from '../ShareFolderTree';

const createNode = (nodeId, name, children = []) => ({
  nodeId,
  name,
  path: `/display/${name}`,
  children,
});

const defaultProps = {
  rootNodeId: 1,
  folderTree: new Map([
    [1, createNode(1, 'docs', [{ nodeId: 2, name: 'sub', children: [] }])],
    [2, createNode(2, 'sub', [])],
  ]),
  expandedNodeIds: new Set(),
  loadingNodeIds: new Set(),
  toggleExpand: jest.fn(),
  folderPermissions: new Map(),
  isAdminMode: false,
  userInfoMap: new Map(),
  getUserName: jest.fn((id) => `user-${id}`),
  hasPermissionChanged: jest.fn(() => false),
  setFolderMenuAnchor: jest.fn(),
  setFolderMenuNodeId: jest.fn(),
  loadingPermissions: false,
  isMobile: false,
};

describe('ShareFolderTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when node is missing', () => {
    const { container } = renderWithProviders(
      <ShareFolderTree {...defaultProps} rootNodeId={999} folderTree={new Map()} />
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
    expect(defaultProps.toggleExpand).toHaveBeenCalledWith(1);
  });

  it('shows children when expanded', () => {
    renderWithProviders(<ShareFolderTree {...defaultProps} expandedNodeIds={new Set([1])} />);
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('opens folder menu when permission button clicked', () => {
    renderWithProviders(
      <ShareFolderTree
        {...defaultProps}
        folderPermissions={new Map([[1, new Map([['u1', 'read']])]])}
        users={[{ id: 'u2', username: 'user2', is_admin: false }]}
        user={{ id: 'me' }}
      />
    );
    const buttons = screen.getAllByRole('button');
    const permBtn = buttons[1];
    fireEvent.click(permBtn);
    expect(defaultProps.setFolderMenuNodeId).toHaveBeenCalledWith(1);
  });

  it('animates overflowing labels on hover and resets on leave', () => {
    renderWithProviders(<ShareFolderTree {...defaultProps} />);

    const label = screen.getByText('docs');
    const labelContainer = label.parentElement;

    Object.defineProperty(labelContainer, 'clientWidth', {
      configurable: true,
      value: 40,
    });
    Object.defineProperty(label, 'scrollWidth', {
      configurable: true,
      value: 140,
    });

    fireEvent.mouseEnter(labelContainer);
    expect(label.style.animation).toContain('shareFolderTreeLabelScroll');

    fireEvent.mouseLeave(labelContainer);
    expect(label.style.animation).toBe('none');
    expect(label.style.transform).toBe('translateX(0)');
  });
});
