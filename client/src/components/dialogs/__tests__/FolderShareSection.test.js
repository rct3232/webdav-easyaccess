/**
 * FolderShareSection tests.
 * Verifies observable outcomes per spec: FolderShareSection.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FolderShareSection from '../FolderShareSection';

const defaultProps = {
  loadingAllFolders: false,
  folderTree: new Map([['/', { path: '/', name: 'root', children: [] }]]),
  isAdminMode: false,
  startFromUserHome: false,
  isShareMode: false,
  isReviewMode: false,
  rootPath: '/',
  renderFolderTreeWrapper: jest.fn((path) => <span data-testid="tree-node">{path}</span>),
};

describe('FolderShareSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading spinner when loadingAllFolders', () => {
    renderWithProviders(<FolderShareSection {...defaultProps} loadingAllFolders />);
    expect(screen.getByText(/loading folders/i)).toBeInTheDocument();
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows loading text when folderTree is empty', () => {
    renderWithProviders(
      <FolderShareSection {...defaultProps} folderTree={new Map()} />
    );
    expect(screen.getByText(/loading folders/i)).toBeInTheDocument();
  });

  it('calls renderFolderTreeWrapper with rootPath when tree has content', () => {
    renderWithProviders(<FolderShareSection {...defaultProps} />);
    expect(defaultProps.renderFolderTreeWrapper).toHaveBeenCalledWith('/', 0);
  });

  it('shows noSubfolders when user base node has no children', () => {
    const folderTree = new Map([
      ['/user1', { path: '/user1', name: 'user1', children: [] }],
    ]);
    renderWithProviders(
      <FolderShareSection
        {...defaultProps}
        folderTree={folderTree}
        rootPath="/user1"
        isAdminMode
        startFromUserHome
        username="user1"
      />
    );
    expect(screen.getByText(/no subfolders/i)).toBeInTheDocument();
  });

  it('calls renderFolderTreeWrapper for children when user base has children', () => {
    const folderTree = new Map([
      [
        '/user1',
        {
          path: '/user1',
          name: 'user1',
          children: [{ path: '/user1/docs', name: 'docs', children: [] }],
        },
      ],
    ]);
    renderWithProviders(
      <FolderShareSection
        {...defaultProps}
        folderTree={folderTree}
        rootPath="/user1"
        isAdminMode
        startFromUserHome
        username="user1"
      />
    );
    expect(defaultProps.renderFolderTreeWrapper).toHaveBeenCalledWith('/user1/docs', 0);
  });
});
