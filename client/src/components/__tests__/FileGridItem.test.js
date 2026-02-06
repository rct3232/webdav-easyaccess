import React from 'react';
import { render, screen, fireEvent } from '../../test-utils';
import FileGridItem from '../FileGridItem';

describe('FileGridItem', () => {
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
      render(<FileGridItem {...defaultProps} />);
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });

    it('should render folder name', () => {
      render(<FileGridItem {...defaultProps} file={mockFolder} />);
      expect(screen.getByText('folder')).toBeInTheDocument();
    });

    it('should render without crashing for file without thumbnail', () => {
      const { container } = render(<FileGridItem {...defaultProps} />);
      expect(container.querySelector('.MuiCard-root')).toBeInTheDocument();
    });

    it('should render thumbnail image when thumbnailUrl is available', () => {
      render(<FileGridItem {...defaultProps} file={mockImageFile} />);
      
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'http://example.com/thumb.jpg');
    });
  });

  describe('선택 모드', () => {
    it('should show checkbox in selection mode', () => {
      render(<FileGridItem {...defaultProps} selectionMode={true} />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('should not show checkbox when not in selection mode', () => {
      render(<FileGridItem {...defaultProps} selectionMode={false} />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('should check checkbox when isSelected is true', () => {
      render(
        <FileGridItem {...defaultProps} selectionMode={true} isSelected={true} />
      );
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('should call onCheck when checkbox is clicked', () => {
      const onCheck = jest.fn();
      render(
        <FileGridItem 
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

  describe('비활성화 상태', () => {
    it('should apply disabled styles when isDisabled', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isDisabled={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ opacity: '0.4' });
    });

    it('should have not-allowed cursor when disabled', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isDisabled={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ cursor: 'not-allowed' });
    });
  });

  describe('처리중 상태', () => {
    it('should show processing indicator when isProcessing', () => {
      render(
        <FileGridItem 
          {...defaultProps} 
          isProcessing={true} 
          processingType="move" 
        />
      );
      
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not show processing indicator when not processing', () => {
      render(<FileGridItem {...defaultProps} isProcessing={false} />);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('드롭 타겟 상태', () => {
    it('should apply drop target styles when isDropTarget', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isDropTarget={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ border: '2px solid' });
    });
  });

  describe('드래그 상태', () => {
    it('should apply dragging styles when isDragging', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isDragging={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ opacity: '0.5' });
    });
  });

  describe('모바일 스타일', () => {
    it('should apply pointer cursor on mobile', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isMobile={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });

    it('should have move cursor on desktop in non-selection mode', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isMobile={false} selectionMode={false} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ cursor: 'move' });
    });
  });

  describe('숨김 파일', () => {
    it('should apply hidden file styles', () => {
      const hiddenFile = { ...mockFile, isHidden: true };
      const { container } = render(
        <FileGridItem {...defaultProps} file={hiddenFile} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ opacity: '0.5' });
    });
  });

  describe('선택 상태', () => {
    it('should apply selected styles when isSelected', () => {
      const { container } = render(
        <FileGridItem {...defaultProps} isSelected={true} />
      );
      
      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ border: '2px solid' });
    });
  });

  describe('React.memo 최적화', () => {
    it('should have displayName set', () => {
      expect(FileGridItem.displayName).toBe('FileGridItem');
    });
  });
});
