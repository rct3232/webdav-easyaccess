/**
 * FolderTreeActionBar tests.
 * Verifies create folder, upload, share link actions.
 * @see docs/spec/client/components/folder-tree/FolderTreeActionBar.md
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FolderTreeActionBar from '../FolderTreeActionBar';

const defaultProps = {
  onCreateFolder: jest.fn(),
  onUploadFile: jest.fn(),
  hasWritePermission: true,
};

describe('FolderTreeActionBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onCreateFolder when create folder button clicked', () => {
    renderWithProviders(<FolderTreeActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/create folder/i));
    expect(defaultProps.onCreateFolder).toHaveBeenCalled();
  });

  it('calls onUploadFile when upload button clicked', () => {
    renderWithProviders(<FolderTreeActionBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/upload file/i));
    expect(defaultProps.onUploadFile).toHaveBeenCalled();
  });

  it('disables create and upload when hasWritePermission false', () => {
    renderWithProviders(<FolderTreeActionBar {...defaultProps} hasWritePermission={false} />);
    expect(screen.getByTitle(/create folder/i)).toBeDisabled();
    expect(screen.getByTitle(/upload file/i)).toBeDisabled();
  });

  it('shows Add to shared when showShareLinkActions and user logged in', () => {
    const onAddToSharedClick = jest.fn();
    renderWithProviders(
      <FolderTreeActionBar
        showShareLinkActions
        shareLinkActions={{ user: { id: '1' }, onAddToSharedClick }}
      />
    );
    expect(screen.getByText(/add to shared/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/add to shared/i));
    expect(onAddToSharedClick).toHaveBeenCalled();
  });

  it('shows Login when showShareLinkActions and user not logged in', () => {
    const onLoginClick = jest.fn();
    renderWithProviders(
      <FolderTreeActionBar
        showShareLinkActions
        shareLinkActions={{ user: null, onLoginClick }}
      />
    );
    expect(screen.getByText(/login/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/login/i));
    expect(onLoginClick).toHaveBeenCalled();
  });
});
