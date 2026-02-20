/**
 * ConflictResolveDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/ConflictResolveDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import ConflictResolveDialog from '../ConflictResolveDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onResolve: jest.fn(),
  conflicts: [
    { path: '/dest/file1.txt', type: 'file' },
    { path: '/dest/folder', type: 'directory' },
  ],
};

describe('ConflictResolveDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dialog when open', () => {
    renderWithProviders(<ConflictResolveDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders conflict list with path basenames', () => {
    renderWithProviders(<ConflictResolveDialog {...defaultProps} />);
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
  });

  it('calls onResolve with overwrite when Merge/Overwrite clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConflictResolveDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /merge.*overwrite/i }));
    expect(defaultProps.onResolve).toHaveBeenCalledWith('overwrite');
  });

  it('calls onResolve with skip when Skip duplicates clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConflictResolveDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /skip duplicates/i }));
    expect(defaultProps.onResolve).toHaveBeenCalledWith('skip');
  });

  it('calls onClose when Cancel clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConflictResolveDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders empty list when conflicts is empty', () => {
    renderWithProviders(<ConflictResolveDialog {...defaultProps} conflicts={[]} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('file1.txt')).not.toBeInTheDocument();
  });
});
