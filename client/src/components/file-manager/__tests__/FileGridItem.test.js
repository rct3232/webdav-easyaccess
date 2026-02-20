/**
 * FileGridItem tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileGridItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileGridItem from '../FileGridItem';

const mockFile = {
  path: '/photo.jpg',
  basename: 'photo.jpg',
  size: 2048,
  lastmod: '2025-01-10T12:00:00Z',
  type: 'file',
};

const defaultProps = {
  file: mockFile,
  isSelected: false,
  isDisabled: false,
  isProcessing: false,
  isDropTarget: false,
  isDragging: false,
  selectionMode: false,
  isMobile: false,
  onCheck: jest.fn(),
};

describe('FileGridItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders basename', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('shows checkbox when selectionMode', () => {
    renderWithProviders(<FileGridItem {...defaultProps} selectionMode />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides checkbox when !selectionMode', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('calls onCheck with (file, checked, e) when checkbox changed', () => {
    const onCheck = jest.fn();
    renderWithProviders(<FileGridItem {...defaultProps} selectionMode onCheck={onCheck} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheck).toHaveBeenCalledWith(mockFile, true, expect.any(Object));
  });

  it('shows processing overlay when isProcessing', () => {
    renderWithProviders(<FileGridItem {...defaultProps} isProcessing />);
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows thumbnail or icon', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(document.querySelector('.MuiSvgIcon-root')).toBeInTheDocument();
  });
});
