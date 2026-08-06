/**
 * ShareLinkSection tests.
 * Verifies observable outcomes per spec: node click, expand when current node in tree, root children loaded.
 * @see docs/spec/client/components/folder-tree/ShareLinkSection.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareLinkSection from '../ShareLinkSection';

jest.mock('../../../services/folderTreeGateway', () => ({
  __esModule: true,
  default: {
    listFolderChildren: jest.fn(),
  },
}));

import folderTreeGateway from '../../../services/folderTreeGateway';

const defaultProps = {
  shareRootNodeId: 7,
  shareRootPath: '/share-root',
  shareRootName: 'My Share',
  shareToken: 'token-123',
  currentNodeId: null,
  onNodeClick: jest.fn(),
};

describe('ShareLinkSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderTreeGateway.listFolderChildren.mockResolvedValue([
      {
        nodeId: 8,
        name: 'docs',
        hasReadPermission: true,
        hasWritePermission: false,
      },
    ]);
  });

  it('returns null when no shareRootNodeId and no shareToken', () => {
    renderWithProviders(
      <ShareLinkSection
        {...defaultProps}
        shareRootNodeId={undefined}
        shareToken=""
      />
    );
    expect(screen.queryByText('My Share')).not.toBeInTheDocument();
  });

  it('renders share root name and calls onNodeClick with the share root nodeId when header clicked', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('My Share')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('My Share'));
    expect(defaultProps.onNodeClick).toHaveBeenCalledWith(7);
  });

  it('loads and displays root children when expanded', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
    expect(folderTreeGateway.listFolderChildren).toHaveBeenCalledWith({
      nodeId: 7,
      listFilesOptions: { shareToken: 'token-123' },
      useHiddenFilesFilter: true,
    });
  });

  it('shows loaded children in tree', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });

  it('keeps the section expanded when currentNodeId is under the share root', async () => {
    renderWithProviders(
      <ShareLinkSection {...defaultProps} currentNodeId={7} />
    );
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });
});
