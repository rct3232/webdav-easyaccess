/**
 * DesktopPathBar tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/DesktopPathBar.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import DesktopPathBar from '../DesktopPathBar';

describe('DesktopPathBar', () => {
  it('renders label', () => {
    renderWithProviders(<DesktopPathBar label="Home" />);
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
  });

  it('renders startIcon when provided', () => {
    const StartIcon = () => <span data-testid="start-icon" />;
    renderWithProviders(<DesktopPathBar label="Back" startIcon={<StartIcon />} />);
    expect(screen.getByTestId('start-icon')).toBeInTheDocument();
  });

  it('calls onClick when button clicked', () => {
    const onClick = jest.fn();
    renderWithProviders(<DesktopPathBar label="Home" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /home/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('button is disabled when disabled prop is true', () => {
    renderWithProviders(<DesktopPathBar label="Home" disabled />);
    expect(screen.getByRole('button', { name: /home/i })).toBeDisabled();
  });

  it('renders without startIcon when not provided', () => {
    renderWithProviders(<DesktopPathBar label="Shared" />);
    expect(screen.getByRole('button', { name: /shared/i })).toBeInTheDocument();
  });
});
