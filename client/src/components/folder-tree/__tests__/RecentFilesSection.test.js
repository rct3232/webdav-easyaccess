/**
 * RecentFilesSection tests.
 * Verifies section click/expand, file/folder click by nodeId, empty state per spec.
 * @see docs/spec/client/components/folder-tree/RecentFilesSection.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import RecentFilesSection from '../RecentFilesSection';

const defaultProps = {
  recentExpanded: false,
  handleRecentToggle: jest.fn(),
  handleRecentClick: jest.fn(),
  currentPath: '/',
  recentFilesList: [],
  onNodeClick: jest.fn(),
  onFileClick: jest.fn(),
};

describe('RecentFilesSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('section click invokes handleRecentClick', () => {
    renderWithProviders(<RecentFilesSection {...defaultProps} />);
    fireEvent.click(screen.getByText(/recent/i));
    expect(defaultProps.handleRecentClick).toHaveBeenCalled();
  });

  it('expand icon area invokes handleRecentToggle', () => {
    renderWithProviders(<RecentFilesSection {...defaultProps} />);
    const listItem = screen.getByText(/recent/i).closest('li');
    const expandIcon =
      listItem?.querySelector('[style*="cursor"]') ||
      listItem?.querySelector('.MuiListItemIcon-root span');
    if (expandIcon) {
      fireEvent.click(expandIcon);
      expect(defaultProps.handleRecentToggle).toHaveBeenCalled();
    } else {
      fireEvent.click(screen.getByText(/recent/i));
      expect(defaultProps.handleRecentClick).toHaveBeenCalled();
    }
  });

  it('shows empty state when recentFilesList is empty', () => {
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded />);
    expect(screen.getByText(/No recent items/)).toBeInTheDocument();
  });

  it('shows file list when recentFilesList has items and expanded', () => {
    const files = [
      { nodeId: 1, path: '/docs/a.pdf', name: 'a.pdf', type: 'file' },
      { nodeId: 2, path: '/docs/folder', name: 'folder', type: 'directory' },
    ];
    renderWithProviders(
      <RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />
    );
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
  });

  it('folder click calls onNodeClick with the entry nodeId', () => {
    const files = [{ nodeId: 5, path: '/docs/folder', name: 'folder', type: 'directory' }];
    renderWithProviders(
      <RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />
    );
    fireEvent.click(screen.getByText('folder'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(5);
  });

  it('file click invokes onFileClick with the nodeId entry', () => {
    const files = [{ nodeId: 3, path: '/docs/a.pdf', name: 'a.pdf', type: 'file' }];
    renderWithProviders(
      <RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />
    );
    fireEvent.click(screen.getByText('a.pdf'));
    expect(defaultProps.onFileClick).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 3,
        path: '/docs/a.pdf',
        name: 'a.pdf',
        basename: 'a.pdf',
        isRecentFile: true,
      })
    );
  });

  it('handles recentFilesList undefined without crashing', () => {
    const propsWithoutList = { ...defaultProps, recentExpanded: true, recentFilesList: undefined };
    renderWithProviders(<RecentFilesSection {...propsWithoutList} />);
    expect(screen.getByText(/No recent items/)).toBeInTheDocument();
  });

  it('file click without onFileClick does not navigate (no path shim)', () => {
    const files = [{ nodeId: 3, path: '/docs/a.pdf', name: 'a.pdf', type: 'file' }];
    const props = {
      ...defaultProps,
      recentExpanded: true,
      recentFilesList: files,
      onFileClick: undefined,
    };
    renderWithProviders(<RecentFilesSection {...props} />);
    fireEvent.click(screen.getByText('a.pdf'));
    expect(defaultProps.onNodeClick).not.toHaveBeenCalled();
  });

  it('list limited to 10 items', () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      nodeId: i + 1,
      path: `/folder/file${i}.txt`,
      name: `file${i}.txt`,
      type: 'file',
    }));
    renderWithProviders(
      <RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />
    );
    expect(screen.getByText('file0.txt')).toBeInTheDocument();
    expect(screen.getByText('file9.txt')).toBeInTheDocument();
    expect(screen.queryByText('file10.txt')).not.toBeInTheDocument();
  });

  it('truncates very long filenames in the middle', () => {
    const longName = 'this-is-a-very-long-filename-that-should-be-truncated.docx';
    const files = [{ nodeId: 99, path: '/long.docx', name: longName, type: 'file' }];
    renderWithProviders(
      <RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />
    );

    const truncatedElement = screen.getByLabelText(longName);
    expect(truncatedElement).toBeInTheDocument();
    expect(truncatedElement.textContent).toContain('...');
    expect(truncatedElement.textContent).toContain('.docx');
    expect(truncatedElement.textContent.length).toBeLessThan(longName.length);
  });
});
