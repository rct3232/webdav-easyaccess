/**
 * FileManagerHeader tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileManagerHeader.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileManagerHeader from '../FileManagerHeader';

const defaultProps = {
  isMobile: false,
  isSearchMode: false,
  setIsSearchMode: jest.fn(),
  searchQuery: '',
  setSearchQuery: jest.fn(),
  navigate: jest.fn(),
};

describe('FileManagerHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders logo', () => {
    renderWithProviders(<FileManagerHeader {...defaultProps} />);
    expect(screen.getByRole('img', { name: /WebDAV|EasyAccess/i })).toBeInTheDocument();
  });

  it('renders search on desktop when !isMobile', () => {
    renderWithProviders(<FileManagerHeader {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('calls setSearchQuery on input change', () => {
    const setSearchQuery = jest.fn();
    renderWithProviders(<FileManagerHeader {...defaultProps} setSearchQuery={setSearchQuery} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'test' } });
    expect(setSearchQuery).toHaveBeenCalledWith('test');
  });

  it('calls setIsSearchMode(true) when search focused on desktop', () => {
    const setIsSearchMode = jest.fn();
    renderWithProviders(<FileManagerHeader {...defaultProps} setIsSearchMode={setIsSearchMode} />);
    fireEvent.focus(screen.getByPlaceholderText(/search/i));
    expect(setIsSearchMode).toHaveBeenCalledWith(true);
  });

  it('calls navigate when admin icon clicked', () => {
    const navigate = jest.fn();
    renderWithProviders(
      <FileManagerHeader {...defaultProps} user={{ is_admin: true }} navigate={navigate} />
    );
    fireEvent.click(screen.getByTitle(/admin/i));
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('calls navigate when mypage icon clicked', () => {
    const navigate = jest.fn();
    renderWithProviders(<FileManagerHeader {...defaultProps} navigate={navigate} />);
    fireEvent.click(screen.getByTitle(/my page|mypage/i));
    expect(navigate).toHaveBeenCalledWith('/mypage');
  });

  it('hides admin icon when !user?.is_admin', () => {
    renderWithProviders(<FileManagerHeader {...defaultProps} user={{ is_admin: false }} />);
    expect(screen.queryByTitle(/admin/i)).not.toBeInTheDocument();
  });

  it('mobile search mode: full-width search and close button', () => {
    const setIsSearchMode = jest.fn();
    const setSearchQuery = jest.fn();
    renderWithProviders(
      <FileManagerHeader
        {...defaultProps}
        isMobile
        isSearchMode
        searchQuery="q"
        setIsSearchMode={setIsSearchMode}
        setSearchQuery={setSearchQuery}
      />
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/close|search close/i));
    expect(setIsSearchMode).toHaveBeenCalledWith(false);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });
});
