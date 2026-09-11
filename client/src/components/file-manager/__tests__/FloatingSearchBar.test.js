/**
 * FloatingSearchBar tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FloatingSearchBar.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FloatingSearchBar from '../FloatingSearchBar';

const defaultProps = {
  searchQuery: '',
  setSearchQuery: jest.fn(),
  isMobile: false,
};

describe('FloatingSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('calls setSearchQuery on input change', () => {
    const setSearchQuery = jest.fn();
    renderWithProviders(<FloatingSearchBar {...defaultProps} setSearchQuery={setSearchQuery} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'test' } });
    expect(setSearchQuery).toHaveBeenCalledWith('test');
  });

  it('shows clear button when searchQuery non-empty and clears on click', () => {
    const setSearchQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar {...defaultProps} searchQuery="q" setSearchQuery={setSearchQuery} />
    );
    const clearButton = screen.getByRole('button', { name: /close|search close/i });
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });

  it('does not show clear button when searchQuery empty', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="" />);
    expect(screen.queryByRole('button', { name: /close|search close/i })).not.toBeInTheDocument();
  });

  it('reserves FAB space on desktop when fabVisible', () => {
    const { container } = renderWithProviders(<FloatingSearchBar {...defaultProps} fabVisible />);
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('116px');
  });

  it('expands to the screen offset on desktop when fab is not visible', () => {
    const { container } = renderWithProviders(
      <FloatingSearchBar {...defaultProps} fabVisible={false} />
    );
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('48px');
  });

  it('expands to the mobile offset when fab is not visible on mobile', () => {
    const { container } = renderWithProviders(
      <FloatingSearchBar {...defaultProps} isMobile fabVisible={false} />
    );
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('16px');
  });

  it('animates right position changes', () => {
    const { container } = renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).transition).toContain('right');
  });
});
