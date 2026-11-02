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
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('trims the acting user home node so it never renders as an extra chip', () => {
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
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('testuser')).not.toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('renders the full ancestor chain for an admin (no home-node trimming)', () => {
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        user={{ id: '9', username: 'admin', is_admin: true, rootNodeId: 11 }}
        currentPath="/admin/docs/project"
        ancestors={[
          { nodeId: 11, name: 'admin' },
          { nodeId: 2, name: 'docs' },
          { nodeId: 3, name: 'project' },
        ]}
      />
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('routes the admin home chip to the filesystem root (null target)', () => {
    renderWithProviders(
      <Breadcrumb {...defaultProps} user={{ id: '9', username: 'admin', is_admin: true }} />
    );
    fireEvent.click(screen.getByText('Home'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(null);
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
    renderWithProviders(<Breadcrumb {...defaultProps} onToggleFolderTree={onToggleFolderTree} />);
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
    renderWithProviders(<Breadcrumb {...defaultProps} currentPath="/__recent__" />);
    expect(screen.getByText(/recent/i)).toBeInTheDocument();
  });
  it('renders the trash chip and navigable trail in the trash view', () => {
    const onNodeClick = jest.fn();
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        currentPath="/__trash__"
        ancestors={[
          { nodeId: 11, name: 'trashed-folder' },
          { nodeId: 12, name: 'nested' },
        ]}
        onNodeClick={onNodeClick}
      />
    );
    expect(screen.getByText('Trash')).toBeInTheDocument();
    expect(screen.getByText('trashed-folder')).toBeInTheDocument();
    expect(screen.getByText('nested')).toBeInTheDocument();
    screen.getByText('nested').click();
    expect(onNodeClick).toHaveBeenCalledWith(12);
  });
});

describe('Breadcrumb — collections crumbs (M-9, 2026-09-30)', () => {
  it('member route renders Collections › <name> — the Home chip is replaced, ancestors never render', () => {
    const onNodeClick = jest.fn();
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        onNodeClick={onNodeClick}
        currentPath="/__collections__/collection/5"
        collectionName="Roadtrip"
        ancestors={[{ nodeId: 42, name: 'should-not-render' }]}
      />
    );
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getByText('Roadtrip')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Collections'));
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__');
    fireEvent.click(screen.getByText('Roadtrip'));
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/collection/5');
  });

  it('unresolved name renders the TRANSIENT ellipsis segment (owner option (a) — never hides)', () => {
    renderWithProviders(
      <Breadcrumb {...defaultProps} currentPath="/__collections__/collection/5" />
    );
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('liked route renders Collections › Liked with the TREE PARITY labels (nav keys)', () => {
    const onNodeClick = jest.fn();
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        onNodeClick={onNodeClick}
        currentPath="/__collections__/liked"
      />
    );
    const en = require('../../../locales/en.json');
    expect(screen.getByText('Collections')).toBeInTheDocument();
    // tree parity: same i18n keys the sidebar section uses
    expect(en.nav.collections).toBe('Collections');
    expect(en.nav.collectionsLiked).toBe('Liked');
    expect(screen.getByText('Liked')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Liked'));
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/liked');
  });

  it('archive route renders Collections › Archive — static tree-parity label, NO Home chip (F2)', () => {
    const onNodeClick = jest.fn();
    renderWithProviders(
      <Breadcrumb
        {...defaultProps}
        onNodeClick={onNodeClick}
        currentPath="/__collections__/__archive__"
        ancestors={[{ nodeId: 42, name: 'should-not-render' }]}
      />
    );
    const en = require('../../../locales/en.json');
    // tree parity: the SAME key the sidebar ArchiveNode uses (static — no name resolution)
    expect(en.nav.collectionsArchive).toBe('Archive');
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Collections'));
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__');
    fireEvent.click(screen.getByText('Archive'));
    expect(onNodeClick).toHaveBeenCalledWith('/__collections__/__archive__');
  });

  it('collection/archive list routes keep the plain Home chip (unchanged surfaces)', () => {
    renderWithProviders(<Breadcrumb {...defaultProps} currentPath="/__collections__" />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
  });
});
