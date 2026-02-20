/**
 * ShareLinkSection tests.
 * Verifies observable outcomes per spec: path click, expand when currentPath in tree, root children loaded.
 * Uses MSW for API (TESTING_STRATEGY: prefer network-layer mock for integration tests).
 * @see docs/spec/client/components/folder-tree/ShareLinkSection.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareLinkSection from '../ShareLinkSection';

jest.mock('../../../utils/localStorage', () => ({
  getShowHiddenFiles: () => false,
}));

const defaultProps = {
  shareRootPath: '/share-root',
  shareRootName: 'My Share',
  shareToken: 'token-123',
  currentPath: '/share-root',
  onShareLinkPathClick: jest.fn(),
};

describe('ShareLinkSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no shareRootPath and no shareToken', () => {
    renderWithProviders(
      <ShareLinkSection
        {...defaultProps}
        shareRootPath=""
        shareToken=""
      />
    );
    expect(screen.queryByText('My Share')).not.toBeInTheDocument();
  });

  it('renders share root name and calls onShareLinkPathClick when header clicked', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('My Share')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('My Share'));
    expect(defaultProps.onShareLinkPathClick).toHaveBeenCalledWith('/share-root');
  });

  it('loads and displays root children when expanded', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });

  it('shows loaded children in tree', async () => {
    renderWithProviders(<ShareLinkSection {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });

  it('expands parent paths when currentPath is under root', async () => {
    renderWithProviders(
      <ShareLinkSection {...defaultProps} currentPath="/share-root/docs" />
    );
    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
  });
});
