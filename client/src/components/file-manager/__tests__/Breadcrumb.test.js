/**
 * Breadcrumb tests.
 * Verifies observable outcomes per spec: path segments, chip click, share mode, toggle folder tree.
 * @see docs/spec/client/components/file-manager/Breadcrumb.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import Breadcrumb from '../Breadcrumb';

jest.mock('../../../services/permissionService', () => ({
  getUserPermissions: jest.fn().mockResolvedValue([]),
}));

const defaultProps = {
  currentPath: '/testuser',
  onPathClick: jest.fn(),
  user: { id: '1', username: 'testuser', is_admin: false },
};

describe('Breadcrumb', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders home chip for non-admin user', () => {
    renderWithProviders(<Breadcrumb {...defaultProps} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('calls onPathClick with home path when home chip clicked', () => {
    renderWithProviders(<Breadcrumb {...defaultProps} />);
    fireEvent.click(screen.getByText('Home'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/testuser');
  });

  it('renders path segments for nested path', () => {
    renderWithProviders(
      <Breadcrumb {...defaultProps} currentPath="/testuser/docs/project" />
    );
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('calls onPathClick with segment path when segment chip clicked', () => {
    renderWithProviders(
      <Breadcrumb {...defaultProps} currentPath="/testuser/docs/project" />
    );
    fireEvent.click(screen.getByText('docs'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/testuser/docs');
  });

  it('shows folder tree toggle when onToggleFolderTree provided', () => {
    const onToggleFolderTree = jest.fn();
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        onToggleFolderTree={onToggleFolderTree}
      />
    );
    const toggleButton = screen.getByRole('button', { name: /folder tree/i });
    expect(toggleButton).toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(onToggleFolderTree).toHaveBeenCalled();
  });

  it('renders share root as home in share mode', () => {
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        shareRootPath="/shared/folder"
        shareRootName="Shared Folder"
        currentPath="/shared/folder"
        user={null}
      />
    );
    expect(screen.getByText('Shared Folder')).toBeInTheDocument();
  });
});
