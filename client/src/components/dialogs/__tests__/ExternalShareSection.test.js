/**
 * ExternalShareSection tests.
 * Verifies observable outcomes per spec: ExternalShareSection.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ExternalShareSection from '../ExternalShareSection';

const defaultProps = {
  externalShareLink: null,
  setExternalShareLink: jest.fn(),
  externalShareLoading: false,
  setExternalShareLoading: jest.fn(),
  externalShareExpiresInDays: 14,
  setExternalShareExpiresInDays: jest.fn(),
  externalShareUnlimited: false,
  setExternalShareUnlimited: jest.fn(),
  linkCopied: false,
  setLinkCopied: jest.fn(),
  createShareLink: jest.fn(),
  getShareLinkUrl: jest.fn((token) => `https://example.com/share/${token}`),
  onOpenShareLink: jest.fn(),
  filePath: '/docs/file.pdf',
  fileName: 'file.pdf',
  onMessage: jest.fn(),
};

describe('ExternalShareSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders external link section title', () => {
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    expect(screen.getByText(/external share link/i)).toBeInTheDocument();
  });

  it('shows create link for display name', () => {
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    expect(screen.getByText(/file\.pdf/i)).toBeInTheDocument();
  });

  it('shows expiry options when no link', () => {
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    expect(screen.getByRole('button', { name: /unlimited/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /specify/i })).toBeInTheDocument();
  });

  it('shows create link button when no link', () => {
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    expect(screen.getByRole('button', { name: /create link/i })).toBeInTheDocument();
  });

  it('calls setExternalShareUnlimited when unlimited clicked', () => {
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /unlimited/i }));
    expect(defaultProps.setExternalShareUnlimited).toHaveBeenCalledWith(true);
  });

  it('calls createShareLink when create button clicked', async () => {
    defaultProps.createShareLink.mockResolvedValue({
      token: 'sl_123',
      expiresAt: null,
    });
    renderWithProviders(<ExternalShareSection {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create link/i }));
    await waitFor(() => {
      expect(defaultProps.createShareLink).toHaveBeenCalledWith(
        '/docs/file.pdf',
        14
      );
    });
  });

  it('shows copy button when link exists', () => {
    renderWithProviders(
      <ExternalShareSection
        {...defaultProps}
        externalShareLink={{ token: 'sl_123', expiresAt: null }}
      />
    );
    expect(screen.getByTestId('ContentCopyIcon')).toBeInTheDocument();
  });

  it('shows new link button when link exists', () => {
    renderWithProviders(
      <ExternalShareSection
        {...defaultProps}
        externalShareLink={{ token: 'sl_123', expiresAt: null }}
      />
    );
    expect(screen.getByRole('button', { name: /new link/i })).toBeInTheDocument();
  });

  it('clears link when new link clicked', () => {
    renderWithProviders(
      <ExternalShareSection
        {...defaultProps}
        externalShareLink={{ token: 'sl_123', expiresAt: null }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /new link/i }));
    expect(defaultProps.setExternalShareLink).toHaveBeenCalledWith(null);
  });

  it('delegates link opening through onOpenShareLink', () => {
    const onOpenShareLink = jest.fn();

    renderWithProviders(
      <ExternalShareSection
        {...defaultProps}
        externalShareLink={{ token: 'sl_123', expiresAt: null }}
        getShareLinkUrl={() => 'https://example.com/share/sl_123'}
        onOpenShareLink={onOpenShareLink}
      />
    );

    fireEvent.click(screen.getByText('https://example.com/share/sl_123'));

    expect(onOpenShareLink).toHaveBeenCalledWith('https://example.com/share/sl_123');
  });
});
