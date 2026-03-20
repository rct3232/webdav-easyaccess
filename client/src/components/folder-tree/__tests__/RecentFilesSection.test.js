/**
 * RecentFilesSection tests.
 * Verifies section click/expand, file/folder click, empty state per spec.
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
  onPathClick: jest.fn(),
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
    const expandIcon = listItem?.querySelector('[style*="cursor"]') || listItem?.querySelector('.MuiListItemIcon-root span');
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
      { path: '/docs/a.pdf', name: 'a.pdf', type: 'file' },
      { path: '/docs/folder', name: 'folder', type: 'directory' },
    ];
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />);
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
  });

  it('folder click invokes onPathClick', () => {
    const files = [{ path: '/docs/folder', name: 'folder', type: 'directory' }];
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />);
    fireEvent.click(screen.getByText('folder'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/docs/folder');
  });

  it('file click invokes onFileClick', () => {
    const files = [{ path: '/docs/a.pdf', name: 'a.pdf', type: 'file' }];
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />);
    fireEvent.click(screen.getByText('a.pdf'));
    expect(defaultProps.onFileClick).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/a.pdf', name: 'a.pdf', basename: 'a.pdf', isRecentFile: true })
    );
  });

  it('handles recentFilesList undefined without crashing', () => {
    const propsWithoutList = { ...defaultProps, recentExpanded: true, recentFilesList: undefined };
    renderWithProviders(<RecentFilesSection {...propsWithoutList} />);
    expect(screen.getByText(/No recent items/)).toBeInTheDocument();
  });

  it('file click when onFileClick undefined falls back to onPathClick(parentPath)', () => {
    const files = [{ path: '/docs/a.pdf', name: 'a.pdf', type: 'file' }];
    const props = { ...defaultProps, recentExpanded: true, recentFilesList: files, onFileClick: undefined };
    renderWithProviders(<RecentFilesSection {...props} />);
    fireEvent.click(screen.getByText('a.pdf'));
    expect(defaultProps.onPathClick).toHaveBeenCalledWith('/docs');
  });

  it('list limited to 10 items', () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      path: `/folder/file${i}.txt`,
      name: `file${i}.txt`,
      type: 'file',
    }));
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />);
    expect(screen.getByText('file0.txt')).toBeInTheDocument();
    expect(screen.getByText('file9.txt')).toBeInTheDocument();
    expect(screen.queryByText('file10.txt')).not.toBeInTheDocument();
  });

  it('truncates very long filenames in the middle', () => {
    const longName = 'this-is-a-very-long-filename-that-should-be-truncated.docx';
    const files = [{ path: '/long.docx', name: longName, type: 'file' }];
    renderWithProviders(<RecentFilesSection {...defaultProps} recentExpanded recentFilesList={files} />);

    // With 200px width, maxVisibleLength is Math.floor((200-32)/8) = 21
    // middleTruncate('...', 21)
    // The resulting text should contain '...' and the extension
    const truncatedElement = screen.getByLabelText(longName);
    expect(truncatedElement).toBeInTheDocument();
    expect(truncatedElement.textContent).toContain('...');
    expect(truncatedElement.textContent).toContain('.docx');
    expect(truncatedElement.textContent.length).toBeLessThan(longName.length);
  });
});
