import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UploadDialog from '../UploadDialog';

// Mock react-dropzone
jest.mock('react-dropzone', () => ({
  useDropzone: ({ onDrop }) => ({
    getRootProps: jest.fn(),
    getInputProps: jest.fn(),
    isDragActive: false,
    onDrop, // for manual call if needed
  }),
}));

describe('UploadDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnUploadStart = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the dialog when open', () => {
    render(
      <UploadDialog
        open={true}
        onClose={mockOnClose}
        currentPath="/test"
        onUploadStart={mockOnUploadStart}
      />
    );

    expect(screen.getByText('파일 업로드')).toBeInTheDocument();
    expect(screen.getByText('파일을 드래그하거나 클릭하여 선택하세요')).toBeInTheDocument();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(
      <UploadDialog
        open={true}
        onClose={mockOnClose}
        currentPath="/test"
        onUploadStart={mockOnUploadStart}
      />
    );

    fireEvent.click(screen.getByText('취소'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  // Note: Testing onDrop is tricky with the mock, but we can test the UI state if we had real drop
});
