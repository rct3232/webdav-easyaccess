import React from 'react';
import { render, screen, fireEvent } from '../../test-utils';
import { Box } from '@mui/material';
import FileListItem, { getFileListItemContainerStyles } from '../FileListItem';

// FileListItem returns a Fragment, so wrap it in a Box for testing
const FileListItemWrapper = (props) => (
  <Box data-testid="file-list-item-wrapper">
    <FileListItem {...props} />
  </Box>
);

describe('FileListItem', () => {
  const mockFile = {
    path: '/test.txt',
    basename: 'test.txt',
    type: 'file',
    size: 1024,
    lastmod: '2024-01-01T00:00:00Z',
    isHidden: false,
  };

  const mockFolder = {
    path: '/folder',
    basename: 'folder',
    type: 'directory',
    size: 0,
    lastmod: '2024-01-01T00:00:00Z',
    isHidden: false,
  };

  const mockImageFile = {
    path: '/image.png',
    basename: 'image.png',
    type: 'file',
    size: 2048,
    lastmod: '2024-01-01T00:00:00Z',
    isHidden: false,
    thumbnailUrl: 'http://example.com/thumb.jpg',
  };

  const defaultProps = {
    file: mockFile,
    isSelected: false,
    isDisabled: false,
    isProcessing: false,
    processingType: null,
    isDropTarget: false,
    isDragging: false,
    selectionMode: false,
    isMobile: false,
    onCheck: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('기본 렌더링', () => {
    it('should render file name', () => {
      render(<FileListItemWrapper {...defaultProps} />);
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });

    it('should render folder name', () => {
      render(<FileListItemWrapper {...defaultProps} file={mockFolder} />);
      expect(screen.getByText('folder')).toBeInTheDocument();
    });

    it('should render "폴더" for directories', () => {
      render(<FileListItemWrapper {...defaultProps} file={mockFolder} />);
      expect(screen.getByText('폴더')).toBeInTheDocument();
    });

    it('should render thumbnail as Avatar when available', () => {
      render(<FileListItemWrapper {...defaultProps} file={mockImageFile} />);
      
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('src', 'http://example.com/thumb.jpg');
    });
  });

  describe('선택 모드', () => {
    it('should show checkbox in selection mode', () => {
      render(<FileListItemWrapper {...defaultProps} selectionMode={true} />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('should not show checkbox when not in selection mode', () => {
      render(<FileListItemWrapper {...defaultProps} selectionMode={false} />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('should check checkbox when isSelected is true', () => {
      render(
        <FileListItemWrapper {...defaultProps} selectionMode={true} isSelected={true} />
      );
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('should call onCheck when checkbox is clicked', () => {
      const onCheck = jest.fn();
      render(
        <FileListItemWrapper 
          {...defaultProps} 
          selectionMode={true} 
          onCheck={onCheck}
        />
      );
      
      fireEvent.click(screen.getByRole('checkbox'));
      expect(onCheck).toHaveBeenCalledWith(
        mockFile,
        true,
        expect.any(Object)
      );
    });
  });

  describe('처리중 상태', () => {
    it('should show processing indicator when isProcessing', () => {
      render(
        <FileListItemWrapper 
          {...defaultProps} 
          isProcessing={true} 
          processingType="move" 
        />
      );
      
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not show processing indicator when not processing', () => {
      render(<FileListItemWrapper {...defaultProps} isProcessing={false} />);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('React.memo 최적화', () => {
    it('should have displayName set', () => {
      expect(FileListItem.displayName).toBe('FileListItem');
    });
  });
});

describe('getFileListItemContainerStyles', () => {
  it('should return base styles', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: false,
      isDragging: false,
      isHidden: false,
      isMobile: false,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('display', 'flex');
    expect(styles).toHaveProperty('alignItems', 'center');
    expect(styles).toHaveProperty('cursor', 'move');
  });

  it('should apply disabled styles', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: true,
      isDropTarget: false,
      isDragging: false,
      isHidden: false,
      isMobile: false,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('cursor', 'not-allowed');
    expect(styles).toHaveProperty('opacity', 0.4);
  });

  it('should apply drop target styles', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: true,
      isDragging: false,
      isHidden: false,
      isMobile: false,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('backgroundColor', 'primary.main');
  });

  it('should apply dragging styles', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: false,
      isDragging: true,
      isHidden: false,
      isMobile: false,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('opacity', 0.5);
  });

  it('should apply hidden file styles', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: false,
      isDragging: false,
      isHidden: true,
      isMobile: false,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('opacity', 0.5);
  });

  it('should apply mobile pointer cursor', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: false,
      isDragging: false,
      isHidden: false,
      isMobile: true,
      selectionMode: false,
    });

    expect(styles).toHaveProperty('cursor', 'pointer');
  });

  it('should apply selection mode pointer cursor', () => {
    const styles = getFileListItemContainerStyles({
      isDisabled: false,
      isDropTarget: false,
      isDragging: false,
      isHidden: false,
      isMobile: false,
      selectionMode: true,
    });

    expect(styles).toHaveProperty('cursor', 'pointer');
  });
});
