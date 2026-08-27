/**
 * Breadcrumb tests.
 * Verifies observable outcomes per spec: ancestor chain, nodeId clicks, share mode, toggle folder tree.
 * @see docs/spec/client/components/file-manager/Breadcrumb.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import Breadcrumb from '../Breadcrumb';

const defaultProps = {
  ancestors: [],
  onNodeClick: jest.fn(),
  user: { id: '1', username: 'testuser', is_admin: false, rootNodeId: 1 },
  currentPath: '/',
};

describe('Breadcrumb', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a single home chip when the ancestor chain is empty', () => {
    renderWithProviders(<Breadcrumb {...defaultProps} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('calls onNodeClick with the home nodeId when home chip clicked', () => {
    renderWithProviders(<Breadcrumb {...defaultProps} />);
    fireEvent.click(screen.getByText('Home'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(1);
  });

  it('renders the ancestor chain for a nested folder', () => {
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        currentPath="/testuser/docs/project"
        ancestors={[
          { nodeId: 1, name: 'testuser' },
          { nodeId: 2, name: 'docs' },
          { nodeId: 3, name: 'project' },
        ]}
      />
    );
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('calls onNodeClick with the ancestor nodeId when a segment chip is clicked', () => {
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        currentPath="/testuser/docs/project"
        ancestors={[
          { nodeId: 1, name: 'testuser' },
          { nodeId: 2, name: 'docs' },
          { nodeId: 3, name: 'project' },
        ]}
      />
    );
    fireEvent.click(screen.getByText('docs'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(2);
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

  it('renders the recent virtual-root label when viewing recent files', () => {
    renderWithProviders(
      <Breadcrumb {...defaultProps} currentPath="/__recent__" />
    );
    expect(screen.getByText(/recent/i)).toBeInTheDocument();
  });
});
