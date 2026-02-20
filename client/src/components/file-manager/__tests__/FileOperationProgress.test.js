/**
 * FileOperationProgress tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileOperationProgress.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileOperationProgress from '../FileOperationProgress';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

const mockItems = [
  { id: '1', type: 'download', status: 'completed', name: 'file1.txt' },
  { id: '2', type: 'upload', status: 'error', name: 'file2.txt', failedItems: [{ fileName: 'file2.txt', error: 'err' }] },
];

const defaultProps = {
  items: mockItems,
  onClose: jest.fn(),
  onRetry: jest.fn(),
};

describe('FileOperationProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when items empty', () => {
    const { container } = renderWithProviders(<FileOperationProgress items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when items null', () => {
    const { container } = renderWithProviders(<FileOperationProgress items={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders progress title', () => {
    renderWithProviders(<FileOperationProgress {...defaultProps} />);
    expect(screen.getByText(/progress|progressTitle/i)).toBeInTheDocument();
  });

  it('renders item names', () => {
    renderWithProviders(<FileOperationProgress {...defaultProps} />);
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    expect(screen.getAllByText('file2.txt').length).toBeGreaterThan(0);
  });

  it('calls onClose when confirm button clicked', async () => {
    renderWithProviders(<FileOperationProgress {...defaultProps} />);
    const confirmBtn = screen.getAllByRole('button', { name: /confirm/i })[0];
    fireEvent.click(confirmBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows retry button for error items when onRetry provided', () => {
    renderWithProviders(<FileOperationProgress {...defaultProps} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('calls onRetry when retry clicked', () => {
    const onRetry = jest.fn();
    renderWithProviders(<FileOperationProgress {...defaultProps} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledWith('2');
  });
});
