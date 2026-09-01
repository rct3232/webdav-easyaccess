/**
 * FileOperationProgress tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileOperationProgress.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test-utils';
import FileOperationProgress from '../FileOperationProgress';

jest.mock('../../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

const mockItems = [
  { id: '1', type: 'download', status: 'completed', name: 'file1.txt' },
  {
    id: '2',
    type: 'upload',
    status: 'error',
    name: 'file2.txt',
    failedItems: [{ fileName: 'file2.txt', error: 'err' }],
  },
];

const defaultProps = {
  items: mockItems,
  drawerOpen: true,
  onDrawerOpen: jest.fn(),
  onDrawerClose: jest.fn(),
  onClose: jest.fn(),
  onRetry: jest.fn(),
};

describe('FileOperationProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when items empty', () => {
    const { container } = renderWithProviders(
      <FileOperationProgress
        items={[]}
        drawerOpen={false}
        onDrawerOpen={jest.fn()}
        onDrawerClose={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when items null', () => {
    const { container } = renderWithProviders(
      <FileOperationProgress
        items={null}
        drawerOpen={false}
        onDrawerOpen={jest.fn()}
        onDrawerClose={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders progress title', () => {
    renderWithProviders(<FileOperationProgress {...defaultProps} />);
    expect(screen.getByText(/progress|progressTitle/i)).toBeInTheDocument();
  });

  it('renders item names', () => {
    const itemsNoError = [
      { id: '1', type: 'download', status: 'completed', name: 'file1.txt' },
      { id: '2', type: 'upload', status: 'completed', name: 'file2.txt' },
    ];
    renderWithProviders(<FileOperationProgress {...defaultProps} items={itemsNoError} />);
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

  it('calls showError when item has error status and showError provided', () => {
    const showError = jest.fn();
    const showWarning = jest.fn();
    renderWithProviders(
      <FileOperationProgress {...defaultProps} showError={showError} showWarning={showWarning} />
    );
    expect(showError).toHaveBeenCalled();
    expect(showError.mock.calls[0][0]).toMatch(/error|err/i);
  });

  it('calls showWarning when item has warning status and showWarning provided', () => {
    const showError = jest.fn();
    const showWarning = jest.fn();
    const warningItems = [
      { id: '1', type: 'upload', status: 'warning', name: 'test.zip', error: 'Skipped: 2' },
    ];
    renderWithProviders(
      <FileOperationProgress
        items={warningItems}
        drawerOpen={true}
        onDrawerOpen={jest.fn()}
        onDrawerClose={jest.fn()}
        showError={showError}
        showWarning={showWarning}
      />
    );
    expect(showWarning).toHaveBeenCalledWith('Skipped: 2');
  });
});
