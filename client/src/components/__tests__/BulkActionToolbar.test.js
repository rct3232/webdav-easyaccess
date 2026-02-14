import React from 'react';
import { render, screen, fireEvent } from '../../test-utils';
import BulkActionToolbar from '../file-manager/BulkActionToolbar';

describe('BulkActionToolbar (F11-F14)', () => {
  const defaultProps = {
    selectedFiles: new Set(['/file1.txt', '/file2.txt', '/file3.txt']),
    handleBulkMove: jest.fn(),
    handleBulkCopy: jest.fn(),
    openBulkDeleteDialog: jest.fn(),
    handleBulkDownload: jest.fn(),
    hasWritePermission: true,
    isMobile: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('렌더링', () => {
    it('displays selected count', () => {
      render(<BulkActionToolbar {...defaultProps} />);
      expect(screen.getByText(/3개 선택/i)).toBeInTheDocument();
    });

    it('renders all action buttons', () => {
      const { container } = render(<BulkActionToolbar {...defaultProps} />);
      
      // Should have 4 icon buttons (move, copy, download, delete)
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(4);
    });
  });

  describe('사용자 상호작용', () => {
    it('calls handleBulkMove when move button clicked (F11)', () => {
      const { container } = render(<BulkActionToolbar {...defaultProps} />);
      
      // First button is move
      const buttons = container.querySelectorAll('button');
      fireEvent.click(buttons[0]);
      expect(defaultProps.handleBulkMove).toHaveBeenCalled();
    });

    it('calls handleBulkCopy when copy button clicked (F12)', () => {
      const { container } = render(<BulkActionToolbar {...defaultProps} />);
      
      // Second button is copy
      const buttons = container.querySelectorAll('button');
      fireEvent.click(buttons[1]);
      expect(defaultProps.handleBulkCopy).toHaveBeenCalled();
    });

    it('calls openBulkDeleteDialog when delete button clicked (F13)', () => {
      const { container } = render(<BulkActionToolbar {...defaultProps} />);
      
      // Fourth button is delete
      const buttons = container.querySelectorAll('button');
      fireEvent.click(buttons[3]);
      expect(defaultProps.openBulkDeleteDialog).toHaveBeenCalled();
    });

    it('calls handleBulkDownload when download button clicked (F14)', () => {
      const { container } = render(<BulkActionToolbar {...defaultProps} />);
      
      // Third button is download
      const buttons = container.querySelectorAll('button');
      fireEvent.click(buttons[2]);
      expect(defaultProps.handleBulkDownload).toHaveBeenCalled();
    });
  });

  describe('권한 처리', () => {
    it('disables move and delete when no write permission', () => {
      const { container } = render(
        <BulkActionToolbar {...defaultProps} hasWritePermission={false} />
      );
      
      const buttons = container.querySelectorAll('button');
      // Move (index 0) should be disabled
      expect(buttons[0]).toBeDisabled();
      // Delete (index 3) should be disabled
      expect(buttons[3]).toBeDisabled();
    });

    it('copy is enabled regardless of source permission (destination checked separately)', () => {
      const { container } = render(
        <BulkActionToolbar {...defaultProps} hasWritePermission={false} />
      );
      
      const buttons = container.querySelectorAll('button');
      // Copy (index 1) should not be disabled (destination permission checked separately)
      expect(buttons[1]).not.toBeDisabled();
    });

    it('download is always enabled regardless of permission', () => {
      const { container } = render(
        <BulkActionToolbar {...defaultProps} hasWritePermission={false} />
      );
      
      const buttons = container.querySelectorAll('button');
      // Download (index 2) should not be disabled
      expect(buttons[2]).not.toBeDisabled();
    });
  });

  describe('모바일 UI', () => {
    it('renders correctly on mobile', () => {
      const { container } = render(
        <BulkActionToolbar {...defaultProps} isMobile={true} />
      );
      
      // Should still render all action buttons
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(4);
    });
  });

  describe('선택 개수 표시', () => {
    it('displays correct count for single selection', () => {
      render(
        <BulkActionToolbar 
          {...defaultProps} 
          selectedFiles={new Set(['/file1.txt'])} 
        />
      );
      expect(screen.getByText(/1개 선택/i)).toBeInTheDocument();
    });

    it('displays correct count for multiple selections', () => {
      const manyFiles = new Set(Array.from({ length: 10 }, (_, i) => `/file${i}.txt`));
      render(
        <BulkActionToolbar 
          {...defaultProps} 
          selectedFiles={manyFiles} 
        />
      );
      expect(screen.getByText(/10개 선택/i)).toBeInTheDocument();
    });
  });
});
