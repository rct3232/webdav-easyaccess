import React from 'react';
import { renderWithProviders, screen, waitFor, fireEvent } from '../../test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import FileContextMenu from '../../components/FileContextMenu';
import * as fileService from '../../services/fileService';

describe('File Operations Integration Tests', () => {
  const mockFile = {
    basename: 'test.txt',
    path: '/test.txt',
    type: 'file',
    size: 1024,
    mtime: '2024-01-01T00:00:00Z',
  };

  const mockUser = {
    id: 1,
    username: 'testuser',
    is_admin: false,
  };

  const defaultProps = {
    contextMenu: { mouseX: 100, mouseY: 100 },
    onClose: jest.fn(),
    file: mockFile,
    onActionComplete: jest.fn(),
    user: mockUser,
    currentPath: '/',
    onMessage: jest.fn(),
    onProgress: jest.fn(),
    hasWritePermission: true,
    onProcessingStart: jest.fn(),
    onProcessingEnd: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('File Delete', () => {
    it('should delete a file successfully', async () => {
      const { rerender } = renderWithProviders(
        <FileContextMenu {...defaultProps} />
      );

      // Click delete button
      const deleteButton = screen.getByText('삭제');
      fireEvent.click(deleteButton);

      // Wait for delete confirmation
      await waitFor(() => {
        expect(defaultProps.onActionComplete).toHaveBeenCalled();
      });
    });

    it('should handle delete errors', async () => {
      // Mock delete failure
      server.use(
        http.delete('/api/files/delete', () => {
          return new HttpResponse(null, {
            status: 500,
            statusText: 'Internal Server Error',
          });
        })
      );

      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const deleteButton = screen.getByText('삭제');
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(defaultProps.onMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          })
        );
      }, { timeout: 3000 });
    });
  });

  describe('File Rename', () => {
    it('should rename a file successfully', async () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      // Click rename button
      const renameButton = screen.getByText('이름 변경');
      fireEvent.click(renameButton);

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Enter new name
      const input = screen.getByDisplayValue('test.txt');
      fireEvent.change(input, { target: { value: 'renamed.txt' } });

      // Submit
      const submitButton = screen.getByText('변경');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(defaultProps.onActionComplete).toHaveBeenCalled();
      });
    });

    it('should validate empty file name', async () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const renameButton = screen.getByText('이름 변경');
      fireEvent.click(renameButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const input = screen.getByDisplayValue('test.txt');
      fireEvent.change(input, { target: { value: '' } });

      const submitButton = screen.getByText('변경');
      fireEvent.click(submitButton);

      // Dialog should still be open (validation failed)
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('File Move/Copy', () => {
    it('should open folder picker for move operation', async () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const moveButton = screen.getByText('이동');
      fireEvent.click(moveButton);

      // Check if processing started
      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('should open folder picker for copy operation', async () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const copyButton = screen.getByText('복사');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });
  });

  describe('Progress Tracking', () => {
    it('should call processing callbacks during delete operation', async () => {
      const onProcessingStart = jest.fn();
      const onProcessingEnd = jest.fn();
      const onActionComplete = jest.fn();
      
      renderWithProviders(
        <FileContextMenu 
          {...defaultProps} 
          onProcessingStart={onProcessingStart}
          onProcessingEnd={onProcessingEnd}
          onActionComplete={onActionComplete}
        />
      );

      // Trigger delete operation
      const deleteButton = screen.getByText('삭제');
      fireEvent.click(deleteButton);

      // Wait for action to complete
      await waitFor(() => {
        expect(onActionComplete).toHaveBeenCalled();
      }, { timeout: 5000 });
      
      // Processing callbacks should have been called
      expect(onProcessingStart).toHaveBeenCalledWith([mockFile.path], 'delete');
      expect(onProcessingEnd).toHaveBeenCalledWith([mockFile.path]);
    });
  });

  describe('Permission Checks', () => {
    it('should disable write operations when no write permission', () => {
      renderWithProviders(
        <FileContextMenu {...defaultProps} hasWritePermission={false} />
      );

      // Write operations should be disabled
      const deleteButton = screen.getByText('삭제');
      const moveButton = screen.getByText('이동');

      // Check if buttons have disabled class (MUI style)
      expect(deleteButton.closest('li')).toHaveClass('Mui-disabled');
      expect(moveButton.closest('li')).toHaveClass('Mui-disabled');
    });

    it('should allow download without write permission', () => {
      renderWithProviders(
        <FileContextMenu {...defaultProps} hasWritePermission={false} />
      );

      // Download should still be available and not disabled
      const downloadButton = screen.getByText('다운로드');
      expect(downloadButton).toBeInTheDocument();
      expect(downloadButton.closest('li')).not.toHaveClass('Mui-disabled');
    });
  });
});

