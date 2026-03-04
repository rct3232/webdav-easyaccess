/**
 * ProgressSummary tests.
 * @see docs/spec/client/components/file-manager/FileOperationProgress/ProgressSummary.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test-utils';
import ProgressSummary from '../ProgressSummary';

jest.mock('../../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

describe('ProgressSummary', () => {
  it('renders primaryLabel and secondaryLabel', () => {
    renderWithProviders(
      <ProgressSummary primaryLabel="Moving" secondaryLabel="3 items" />
    );
    expect(screen.getByText('Moving')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders status icon when renderStatusIcon provided', () => {
    renderWithProviders(
      <ProgressSummary
        primaryLabel="Uploading"
        secondaryLabel="1 file"
        renderStatusIcon={() => <span data-testid="status-icon">Icon</span>}
      />
    );
    expect(screen.getByTestId('status-icon')).toBeInTheDocument();
  });

  it('renders as button when variant is appbar', () => {
    renderWithProviders(
      <ProgressSummary
        variant="appbar"
        primaryLabel="Done"
        secondaryLabel="2 items"
      />
    );
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('calls onOpenDrawer when clicked', () => {
    const onOpenDrawer = jest.fn();
    renderWithProviders(
      <ProgressSummary
        variant="appbar"
        primaryLabel="Progress"
        secondaryLabel="1 item"
        onOpenDrawer={onOpenDrawer}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
  });

  it('calls onExpand when onOpenDrawer not provided', () => {
    const onExpand = jest.fn();
    renderWithProviders(
      <ProgressSummary
        variant="appbar"
        primaryLabel="Progress"
        secondaryLabel="1 item"
        onExpand={onExpand}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
