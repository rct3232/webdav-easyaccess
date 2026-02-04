import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BulkActionToolbar from '../BulkActionToolbar';

describe('BulkActionToolbar', () => {
  const defaultProps = {
    isMobile: false,
    selectedFiles: new Set(['/file1.txt', '/file2.txt']),
    handleBulkMove: jest.fn(),
    handleBulkCopy: jest.fn(),
    handleBulkDownload: jest.fn(),
    openBulkDeleteDialog: jest.fn(),
    hasWritePermission: true,
  };

  it('renders correctly with selected files count', () => {
    render(<BulkActionToolbar {...defaultProps} />);
    expect(screen.getByText('2개')).toBeInTheDocument();
  });

  it('calls bulk actions when buttons are clicked', () => {
    render(<BulkActionToolbar {...defaultProps} />);
    
    fireEvent.click(screen.getByTitle('이동'));
    expect(defaultProps.handleBulkMove).toHaveBeenCalled();
    
    fireEvent.click(screen.getByTitle('복사'));
    expect(defaultProps.handleBulkCopy).toHaveBeenCalled();
    
    fireEvent.click(screen.getByTitle('다운로드'));
    expect(defaultProps.handleBulkDownload).toHaveBeenCalled();
    
    fireEvent.click(screen.getByTitle('삭제'));
    expect(defaultProps.openBulkDeleteDialog).toHaveBeenCalledWith(['/file1.txt', '/file2.txt']);
  });

  it('disables move and delete buttons when hasWritePermission is false', () => {
    render(<BulkActionToolbar {...defaultProps} hasWritePermission={false} />);
    
    expect(screen.getByTitle('이동')).toBeDisabled();
    expect(screen.getByTitle('삭제')).toBeDisabled();
    
    // Copy and Download should still be enabled
    expect(screen.getByTitle('복사')).not.toBeDisabled();
    expect(screen.getByTitle('다운로드')).not.toBeDisabled();
  });

  it('adjusts styles for mobile', () => {
    const { container } = render(<BulkActionToolbar {...defaultProps} isMobile={true} />);
    const paper = container.firstChild;
    expect(paper).toHaveStyle('bottom: 0px');
    expect(paper).toHaveStyle('width: 100%');
  });
});
