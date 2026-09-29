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
  showMoreButton: false,
  onMoreClick: jest.fn(),
  isMobile: false,
};

describe('FileGridItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders basename', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('does not render checkbox (selection shown by card background)', () => {
    renderWithProviders(<FileGridItem {...defaultProps} selectionMode isSelected />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows processing overlay when isProcessing', () => {
    renderWithProviders(<FileGridItem {...defaultProps} isProcessing />);
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('shows thumbnail or icon', () => {
    renderWithProviders(<FileGridItem {...defaultProps} />);
    expect(document.querySelector('.MuiSvgIcon-root')).toBeInTheDocument();
  });

  it('shows More button when showMoreButton', () => {
    renderWithProviders(<FileGridItem {...defaultProps} showMoreButton onMoreClick={jest.fn()} />);
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
  });

  it('hides More button when !showMoreButton', () => {
    renderWithProviders(
      <FileGridItem {...defaultProps} showMoreButton={false} onMoreClick={jest.fn()} />
    );
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });

  it('calls onMoreClick with file when More button clicked', () => {
    const onMoreClick = jest.fn();
    renderWithProviders(
      <FileGridItem {...defaultProps} showMoreButton onMoreClick={onMoreClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(onMoreClick).toHaveBeenCalledWith(mockFile, expect.any(Object));
  });
});

describe('FileGridItem — member tile slots (P-4)', () => {
  const memberRow = (overrides = {}) => ({
    nodeId: 90210,
    path: '',
    basename: 'poster.pdf',
    type: 'file',
    mime: 'application/pdf',
    isCollectionMember: true,
    published: false,
    shared_excluded: false,
    state: 'normal',
    moreButtonTestId: 'member-menu-button',
    ...overrides,
  });

  const itemProps = (file, overrides = {}) => ({
    file,
    isSelected: false,
    isDisabled: false,
    isProcessing: false,
    isDropTarget: false,
    isDragging: false,
    selectionMode: false,
    showMoreButton: true,
    onMoreClick: jest.fn(),
    isMobile: false,
    ...overrides,
  });

  it('More action carries file.moreButtonTestId', () => {
    const file = memberRow();
    const onMoreClick = jest.fn();
    renderWithProviders(<FileGridItem {...itemProps(file, { onMoreClick })} />);
    fireEvent.click(screen.getByTestId('member-menu-button'));
    expect(onMoreClick).toHaveBeenCalledWith(file, expect.any(Object));
  });

  it('a plain file tile renders NO more-button data-testid (regression anchor)', () => {
    const { container } = renderWithProviders(
      <FileGridItem {...itemProps({ path: '/a.txt', basename: 'a.txt', type: 'file' })} />
    );
    // MUI icons carry their own data-testid; scope the check to the member slots.
    expect(container.querySelector('[data-testid="member-menu-button"]')).toBeNull();
    expect(container.querySelector('[data-testid^="member-row-"]')).toBeNull();
  });
});
