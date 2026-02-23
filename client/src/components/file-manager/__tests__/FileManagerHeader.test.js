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

  it('calls navigate when mypage icon clicked', () => {
    const navigate = jest.fn();
    renderWithProviders(<FileManagerHeader {...defaultProps} navigate={navigate} />);
    fireEvent.click(screen.getByTitle(/my page|mypage/i));
    expect(navigate).toHaveBeenCalledWith('/mypage');
  });

});
