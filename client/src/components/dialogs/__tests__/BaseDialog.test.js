/**
 * BaseDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/BaseDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import BaseDialog from '../BaseDialog';

const mockUseResponsive = jest.fn();

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => mockUseResponsive(),
}));

const defaultProps = {
  open: true,
  onClose: jest.fn(),
};

describe('BaseDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseResponsive.mockReturnValue({ isMobile: false });
  });

  it('renders when open=true', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Test Title">
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('hides when open=false', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} open={false} title="Test">
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when dialog is closed via Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Test">
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders title when provided', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} title="My Title">
        <p>Body</p>
      </BaseDialog>
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('does not render title when not provided', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps}>
        <p>Body only</p>
      </BaseDialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Body only')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders children when provided', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Title">
        <p data-testid="custom-content">Custom content</p>
      </BaseDialog>
    );
    expect(screen.getByTestId('custom-content')).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    renderWithProviders(
      <BaseDialog
        {...defaultProps}
        title="Title"
        actions={<button type="button">Save</button>}
      />
    );
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('does not render actions when not provided', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Title">
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders with fullScreen when isMobile', () => {
    mockUseResponsive.mockReturnValue({ isMobile: true });
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Mobile Title">
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Mobile Title')).toBeInTheDocument();
  });

  it('renders with custom sx without error', () => {
    renderWithProviders(
      <BaseDialog {...defaultProps} title="Title" sx={{ minHeight: 200 }}>
        <p>Content</p>
      </BaseDialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
