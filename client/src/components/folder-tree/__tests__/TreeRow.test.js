/**
 * TreeRow tests — the shared sidebar row primitive (owner ruling 2026-10-01, PLAN §12).
 * Primitive behavior (indent/selection/truncation/slots) + cross-section usage/indent
 * parity between recent, collections and shared-folder child rows.
 * @see docs/spec/client/components/folder-tree/TreeRow.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import TreeRow from '../TreeRow';
import RecentFilesSection from '../RecentFilesSection';
import CollectionsSection from '../CollectionsSection';
import SharedFoldersSection from '../SharedFoldersSection';

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

const longName = 'this-is-a-very-long-filename-that-should-be-truncated.docx';

const collectionRow = {
  collection_id: 1,
  name: 'Roadtrip',
  granted_role: null,
  pinned: false,
};

describe('TreeRow primitive', () => {
  it('indents by level: pl = level * 2 (0px / 16px / 32px)', () => {
    const { container } = renderWithProviders(
      <nav>
        <TreeRow level={0} name="zero" />
        <TreeRow level={1} name="one" />
        <TreeRow level={2} name="two" />
      </nav>
    );
    const rows = container.querySelectorAll('.MuiListItemButton-root[data-tree-row]');
    expect(rows).toHaveLength(3);
    expect(window.getComputedStyle(rows[0]).paddingLeft).toBe('0px');
    expect(window.getComputedStyle(rows[1]).paddingLeft).toBe('16px');
    expect(window.getComputedStyle(rows[2]).paddingLeft).toBe('32px');
  });

  it('fires onClick and applies the selected highlight (Mui-selected + bold name)', () => {
    const onClick = jest.fn();
    renderWithProviders(<TreeRow name="picked" selected onClick={onClick} />);
    const button = screen.getByRole('button', { name: /picked/i });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.className).toContain('Mui-selected');
    expect(screen.getByText('picked')).toHaveStyle({ fontWeight: 700 });
  });

  it('renders the leading, icon, secondary and trailing slots with the 24px geometry', () => {
    const { container } = renderWithProviders(
      <TreeRow
        name="slotted"
        leading={<span data-testid="row-leading">L</span>}
        icon={<span data-testid="row-icon">I</span>}
        secondary={<span data-testid="row-secondary">S</span>}
        trailing={<span data-testid="row-trailing">T</span>}
      />
    );
    expect(screen.getByTestId('row-leading')).toBeInTheDocument();
    expect(screen.getByTestId('row-icon')).toBeInTheDocument();
    expect(screen.getByTestId('row-secondary')).toBeInTheDocument();
    expect(screen.getByTestId('row-trailing')).toBeInTheDocument();
    const iconColumns = container.querySelectorAll('.MuiListItemIcon-root');
    expect(iconColumns.length).toBeGreaterThanOrEqual(2);
  });

  it('disables the button when disabled and suppresses the click', () => {
    const onClick = jest.fn();
    renderWithProviders(<TreeRow name="blocked" disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: /blocked/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('middle-truncates long names with a tooltip exposing the full name', () => {
    renderWithProviders(<TreeRow name={longName} />);
    const truncated = screen.getByLabelText(longName);
    expect(truncated.textContent).toContain('...');
    expect(truncated.textContent).toContain('.docx');
    expect(truncated.textContent.length).toBeLessThan(longName.length);
  });

  it('renders short names intact (no tooltip wrapper)', () => {
    renderWithProviders(<TreeRow name="a.pdf" />);
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('a.pdf')).not.toBeInTheDocument();
  });

  it('forwards buttonProps and listItemProps (testids land on button / wrapper)', () => {
    const { container } = renderWithProviders(
      <TreeRow
        name="keyed"
        buttonProps={{ 'data-testid': 'row-button' }}
        listItemProps={{ 'data-testid': 'row-item' }}
      />
    );
    expect(screen.getByTestId('row-item').tagName).toBe('LI');
    expect(screen.getByTestId('row-button')).toBe(
      container.querySelector('.MuiListItemButton-root[data-tree-row]')
    );
  });
});

describe('TreeRow cross-section indent parity (owner ruling 2026-10-01)', () => {
  const firstRowPadding = (container) => {
    const row = container.querySelector('.MuiListItemButton-root[data-tree-row]');
    expect(row).toBeTruthy();
    return window.getComputedStyle(row).paddingLeft;
  };

  it('recent / collections / shared-folder child rows all render TreeRow at the same indent', () => {
    const recent = renderWithProviders(
      <RecentFilesSection
        recentExpanded
        handleRecentToggle={jest.fn()}
        handleRecentClick={jest.fn()}
        currentPath="/"
        recentFilesList={[{ nodeId: 1, path: '/docs/a.pdf', name: 'a.pdf', type: 'file' }]}
        onNodeClick={jest.fn()}
        onFileClick={jest.fn()}
      />
    );
    const collections = renderWithProviders(
      <CollectionsSection
        collectionsExpanded
        onCollectionsToggle={jest.fn()}
        onCollectionsClick={jest.fn()}
        collections={[collectionRow]}
        currentPath="/"
        onCollectionClick={jest.fn()}
        onArchiveClick={jest.fn()}
        onLikesClick={jest.fn()}
        newCollectionIds={[]}
      />
    );
    const shared = renderWithProviders(
      <SharedFoldersSection
        sharedFolders={[{ nodeId: 10, permission: 'read' }]}
        sharedExpanded
        handleSharedToggle={jest.fn()}
        handleSharedClick={jest.fn()}
        currentNodeId={null}
        buildSharedFolderTree={() => [{ nodeId: 10, name: 'docs' }]}
        onNodeClick={jest.fn()}
        expandedNodeIds={new Set()}
        onToggleExpand={jest.fn()}
        user={{ id: '1', username: 'user', is_admin: false, rootNodeId: 1 }}
      />
    );

    const recentPadding = firstRowPadding(recent.container);
    const collectionsPadding = firstRowPadding(collections.container);
    const sharedPadding = firstRowPadding(shared.container);
    expect(recentPadding).toBe(sharedPadding);
    expect(collectionsPadding).toBe(sharedPadding);
    expect(sharedPadding).toBe('16px');
  });
});
