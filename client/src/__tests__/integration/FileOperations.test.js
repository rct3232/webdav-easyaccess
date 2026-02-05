import React from 'react';
import { renderWithProviders, screen, fireEvent } from '../../test-utils';
import FileContextMenu from '../../components/FileContextMenu';

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
    user: mockUser,
    hasWritePermission: true,
    onDownload: jest.fn(),
    onRename: jest.fn(),
    onMove: jest.fn(),
    onCopy: jest.fn(),
    onShare: jest.fn(),
    onManageShared: jest.fn(),
    onDelete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('File Delete', () => {
    it('should call onClose and onDelete with file when delete is clicked', () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const deleteMenuItem = screen.getByRole('menuitem', { name: '삭제' });
      fireEvent.click(deleteMenuItem);

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onDelete).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('File Rename', () => {
    it('should call onClose and onRename with file when rename is clicked', () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const renameMenuItem = screen.getByRole('menuitem', { name: '이름 변경' });
      fireEvent.click(renameMenuItem);

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onRename).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('File Move/Copy', () => {
    it('should call onClose and onMove with file when move is clicked', () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const moveButton = screen.getByText('이동');
      fireEvent.click(moveButton);

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onMove).toHaveBeenCalledWith(mockFile);
    });

    it('should call onClose and onCopy with file when copy is clicked', () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const copyButton = screen.getByText('복사');
      fireEvent.click(copyButton);

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onCopy).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('File Download', () => {
    it('should call onClose and onDownload with file when download is clicked', () => {
      renderWithProviders(<FileContextMenu {...defaultProps} />);

      const downloadMenuItem = screen.getByRole('menuitem', { name: '다운로드' });
      fireEvent.click(downloadMenuItem);

      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onDownload).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('Permission Checks', () => {
    it('should disable write operations when no write permission', () => {
      renderWithProviders(
        <FileContextMenu {...defaultProps} hasWritePermission={false} />
      );

      const deleteButton = screen.getByText('삭제');
      const moveButton = screen.getByText('이동');

      expect(deleteButton.closest('li')).toHaveClass('Mui-disabled');
      expect(moveButton.closest('li')).toHaveClass('Mui-disabled');
    });

    it('should allow download without write permission', () => {
      renderWithProviders(
        <FileContextMenu {...defaultProps} hasWritePermission={false} />
      );

      const downloadButton = screen.getByText('다운로드');
      expect(downloadButton).toBeInTheDocument();
      expect(downloadButton.closest('li')).not.toHaveClass('Mui-disabled');
    });
  });
});
