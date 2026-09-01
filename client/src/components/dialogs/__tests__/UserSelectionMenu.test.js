/**
 * UserSelectionMenu tests.
 * Verifies observable outcomes per spec: UserSelectionMenu.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import UserSelectionMenu from '../UserSelectionMenu';

let anchorEl;
beforeEach(() => {
  anchorEl = document.createElement('div');
  document.body.appendChild(anchorEl);
});
afterEach(() => {
  if (anchorEl?.parentNode) {
    anchorEl.parentNode.removeChild(anchorEl);
  }
});

const defaultProps = {
  folderMenuAnchor: null,
  onClose: jest.fn(),
  folderMenuPath: '/docs',
  folderPermissions: new Map([['/docs', new Map([['u1', 'read']])]]),
  isAdminMode: false,
  user: { id: 'me' },
  userInfoMap: new Map([['u1', { username: 'user1', is_admin: false }]]),
  users: [
    { id: 'u1', username: 'user1', email: 'u1@ex.com', is_admin: false },
    { id: 'u2', username: 'user2', email: 'u2@ex.com', is_admin: false },
  ],
  getUserName: jest.fn((id) => (id === 'u1' ? 'user1' : `user-${id}`)),
  handleTogglePermission: jest.fn(),
  handleRemoveUser: jest.fn(),
  folderMenuView: 'manage',
  setFolderMenuView: jest.fn(),
  isShareMode: true,
  isReviewMode: false,
};

function renderWithAnchor(props = {}) {
  return renderWithProviders(
    <UserSelectionMenu {...defaultProps} folderMenuAnchor={anchorEl} {...props} />
  );
}

describe('UserSelectionMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when folderMenuPath is empty', () => {
    renderWithProviders(
      <UserSelectionMenu {...defaultProps} folderMenuPath="" folderMenuAnchor={null} />
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders manage view with add user option', () => {
    renderWithAnchor();
    expect(screen.getByRole('menuitem', { name: /add user/i })).toBeInTheDocument();
  });

  it('shows add user option in manage view', () => {
    renderWithAnchor();
    expect(screen.getByText(/add user/i)).toBeInTheDocument();
  });

  it('calls setFolderMenuView with selectUser when add user clicked in share mode', () => {
    renderWithAnchor();
    fireEvent.click(screen.getByText(/add user/i));
    expect(defaultProps.setFolderMenuView).toHaveBeenCalledWith('selectUser');
  });

  it('renders select user view with back option', () => {
    renderWithAnchor({ folderMenuView: 'selectUser' });
    expect(screen.getByText(/back/i)).toBeInTheDocument();
  });

  it('calls setFolderMenuView with manage when back clicked in selectUser view', () => {
    renderWithAnchor({ folderMenuView: 'selectUser' });
    fireEvent.click(screen.getByText(/back/i));
    expect(defaultProps.setFolderMenuView).toHaveBeenCalledWith('manage');
  });

  it('shows available users in selectUser view', () => {
    renderWithAnchor({ folderMenuView: 'selectUser' });
    expect(screen.getByText('user2')).toBeInTheDocument();
  });

  it('shows the requester-only option in review mode', () => {
    renderWithAnchor({
      folderMenuView: 'selectUser',
      isReviewMode: true,
      permissionRequest: {
        requester_id: 'u3',
        requester_username: 'requester',
      },
    });

    expect(screen.getByText('requester')).toBeInTheDocument();
    expect(screen.getByText(/applicant/i)).toBeInTheDocument();
  });
});
