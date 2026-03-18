/**
 * UploadDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/UploadDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import UploadDialog from '../UploadDialog';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  currentPath: '/uploads',
  onUploadStart: jest.fn(),
};

describe('UploadDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dialog with dropzone and buttons when open', () => {
    renderWithProviders(<UploadDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/drag and drop|drop files/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('Upload button is disabled when no files selected', () => {
    renderWithProviders(<UploadDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled();
  });

  it('calls onClose when Cancel clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UploadDialog {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('accepts files via dropzone input and shows file list', async () => {
    const user = userEvent.setup();
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    renderWithProviders(<UploadDialog {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    await user.upload(input, file);
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('calls onUploadStart with fileList and currentPath when Upload clicked', async () => {
    const user = userEvent.setup();
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    renderWithProviders(<UploadDialog {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /upload/i }));
    expect(defaultProps.onUploadStart).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(File)]),
      '/uploads'
    );
  });

  it('calls onClose after upload', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    renderWithProviders(<UploadDialog {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /upload/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('removes file when remove button clicked', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], 'remove-me.txt', { type: 'text/plain' });
    renderWithProviders(<UploadDialog {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    expect(screen.getByText('remove-me.txt')).toBeInTheDocument();
    const list = screen.getByRole('list');
    const removeBtn = within(list).getByRole('button');
    await user.click(removeBtn);
    expect(screen.queryByText('remove-me.txt')).not.toBeInTheDocument();
  });

  it('resets files when dialog closes and reopens', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], 'temp.txt', { type: 'text/plain' });
    const { rerender } = renderWithProviders(
      <UploadDialog {...defaultProps} open />
    );
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    expect(screen.getByText('temp.txt')).toBeInTheDocument();
    rerender(<UploadDialog {...defaultProps} open={false} />);
    rerender(<UploadDialog {...defaultProps} open />);
    expect(screen.queryByText('temp.txt')).not.toBeInTheDocument();
  });
});
