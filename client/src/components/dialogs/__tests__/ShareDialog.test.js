/**
 * ShareDialog tests.
 * Verifies observable outcomes: dialog visibility, title, buttons.
 * Uses MSW for API; no hook mocks.
 * @see docs/spec/client/components/dialogs/ShareDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ShareDialog from '../ShareDialog';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

describe('ShareDialog', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    mode: 'share',
    folderPath: '/my-folder',
    folderName: 'my-folder',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
  });

  it('renders dialog when open', async () => {
    renderWithProviders(<ShareDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows folder name in title when share mode', async () => {
    renderWithProviders(<ShareDialog {...defaultProps} folderName="MyFolder" />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/MyFolder/i);
    });
  });

  it('shows cancel and confirm buttons when not external share', async () => {
    renderWithProviders(<ShareDialog {...defaultProps} enableExternalShare={false} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    });
  });

  it('shows close button when enableExternalShare', async () => {
    renderWithProviders(
      <ShareDialog
        {...defaultProps}
        enableExternalShare
        fileNodeId={1}
        fileName="file.pdf"
      />
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
    });
  });

  it('mode admin shows permission settings in title', async () => {
    renderWithProviders(
      <ShareDialog
        {...defaultProps}
        mode="admin"
        userId="1"
        username="testuser"
      />
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/permission settings/i);
      expect(screen.getByRole('dialog')).toHaveTextContent(/testuser/i);
    });
  });

  it('mode review shows permission review in title', async () => {
    renderWithProviders(
      <ShareDialog
        {...defaultProps}
        mode="review"
        folderPath="/user/folder"
        folderName="folder"
      />
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/permission review/i);
      expect(screen.getByRole('dialog')).toHaveTextContent(/folder/i);
    });
  });

});
