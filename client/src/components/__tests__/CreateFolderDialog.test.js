import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateFolderDialog from '../dialogs/CreateFolderDialog';
import { createFolder } from '../../services/fileService';

// Mock fileService
jest.mock('../../services/fileService', () => ({
  createFolder: jest.fn(),
}));

describe('CreateFolderDialog', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    onComplete: jest.fn(),
    currentPath: '/',
    onProgress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render correctly', () => {
    render(<CreateFolderDialog {...defaultProps} />);
    expect(screen.getByText('새 폴더 만들기')).toBeInTheDocument();
    expect(screen.getByLabelText('폴더 이름')).toBeInTheDocument();
  });

  it('should handle successful folder creation', async () => {
    createFolder.mockResolvedValue({ success: true });
    render(<CreateFolderDialog {...defaultProps} />);

    const input = screen.getByLabelText('폴더 이름');
    fireEvent.change(input, { target: { value: 'New Folder' } });

    const createButton = screen.getByText('만들기');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('/New Folder');
    });

    await waitFor(() => {
      expect(defaultProps.onComplete).toHaveBeenCalledWith('/New Folder', 'New Folder');
    });
  });

  it('should show validation error for empty name', async () => {
    render(<CreateFolderDialog {...defaultProps} />);

    const createButton = screen.getByText('만들기');
    fireEvent.click(createButton);

    expect(screen.getByText('이름을 입력하세요')).toBeInTheDocument();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('should handle creation errors', async () => {
    const errorMessage = 'Folder already exists';
    createFolder.mockRejectedValue({
      response: { data: { error: errorMessage } }
    });
    
    render(<CreateFolderDialog {...defaultProps} />);

    const input = screen.getByLabelText('폴더 이름');
    fireEvent.change(input, { target: { value: 'Existing Folder' } });

    const createButton = screen.getByText('만들기');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(defaultProps.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: errorMessage,
        })
      );
    });
  });

  it('should call onClose when cancel button is clicked', () => {
    render(<CreateFolderDialog {...defaultProps} />);
    
    const cancelButton = screen.getByText('취소');
    fireEvent.click(cancelButton);
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
