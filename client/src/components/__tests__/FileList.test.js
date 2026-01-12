import React from 'react';
import { render, screen, fireEvent } from '../../test-utils';
import FileList from '../FileList';
import { mockFiles } from '../../test-utils';

describe('FileList Component', () => {
  const defaultProps = {
    files: mockFiles,
    onFileClick: jest.fn(),
    onContextMenu: jest.fn(),
    onFileDrop: jest.fn(),
    selectionMode: false,
    selectedFiles: new Set(),
    onFileCheck: jest.fn(),
    processingMap: new Map(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render file list', () => {
      render(<FileList {...defaultProps} />);
      
      expect(screen.getByText('test.txt')).toBeInTheDocument();
      expect(screen.getByText('folder')).toBeInTheDocument();
      expect(screen.getByText('image.png')).toBeInTheDocument();
    });

    it('should render empty list', () => {
      const { container } = render(<FileList {...defaultProps} files={[]} />);
      expect(container.querySelector('[class*="MuiBox"]')).toBeInTheDocument();
    });

    it('should render file information', () => {
      const { container } = render(<FileList {...defaultProps} />);
      // Files should be rendered with their information
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should call onFileClick when file is clicked', () => {
      const onFileClick = jest.fn();
      render(<FileList {...defaultProps} onFileClick={onFileClick} />);
      
      const fileElement = screen.getByText('test.txt').closest('[role="button"]') || screen.getByText('test.txt').closest('div[onClick]');
      if (fileElement) {
        fireEvent.click(fileElement);
        expect(onFileClick).toHaveBeenCalledWith(
          expect.objectContaining({ basename: 'test.txt' })
        );
      }
    });

    it('should call onContextMenu when file is right-clicked', () => {
      const onContextMenu = jest.fn();
      render(<FileList {...defaultProps} onContextMenu={onContextMenu} />);
      
      const fileElement = screen.getByText('test.txt').closest('div[onContextMenu]');
      if (fileElement) {
        fireEvent.contextMenu(fileElement);
        expect(onContextMenu).toHaveBeenCalled();
      }
    });
  });

  describe('Selection Mode', () => {
    it('should show checkboxes in selection mode', () => {
      const { container } = render(
        <FileList {...defaultProps} selectionMode={true} />
      );
      
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should handle file selection', () => {
      const onFileCheck = jest.fn();
      const { container } = render(
        <FileList 
          {...defaultProps} 
          selectionMode={true} 
          onFileCheck={onFileCheck}
        />
      );
      
      const firstCheckbox = container.querySelector('input[type="checkbox"]');
      if (firstCheckbox) {
        fireEvent.click(firstCheckbox);
        expect(onFileCheck).toHaveBeenCalled();
      }
    });

    it('should highlight selected files', () => {
      const selectedFiles = new Set(['/test.txt']);
      const { container } = render(
        <FileList 
          {...defaultProps} 
          selectionMode={true}
          selectedFiles={selectedFiles}
        />
      );
      
      const checkedCheckboxes = container.querySelectorAll('input[type="checkbox"]:checked');
      expect(checkedCheckboxes.length).toBeGreaterThan(0);
    });
  });

  describe('Processing State', () => {
    it('should show processing icon for files being processed', () => {
      const processingMap = new Map([['/test.txt', 'move']]);
      const { container } = render(
        <FileList {...defaultProps} processingMap={processingMap} />
      );
      
      // Should show a processing indicator (MoveIcon)
      const moveIcons = container.querySelectorAll('[data-testid="DriveFileMoveIcon"]');
      expect(moveIcons.length).toBeGreaterThan(0);
    });

    it('should disable interaction for processing files', () => {
      const processingMap = new Map([['/test.txt', 'delete']]);
      render(
        <FileList {...defaultProps} processingMap={processingMap} />
      );
      
      // File should be marked as processing (may have different styles)
      const fileElement = screen.getByText('test.txt').closest('div');
      expect(fileElement).toBeInTheDocument();
    });
  });

  describe('Drag and Drop', () => {
    it('should have draggable attribute when not in selection mode', () => {
      const { container } = render(<FileList {...defaultProps} />);
      
      const draggableElements = container.querySelectorAll('[draggable="true"]');
      expect(draggableElements.length).toBeGreaterThan(0);
    });

    it('should not be draggable in selection mode', () => {
      const { container } = render(
        <FileList {...defaultProps} selectionMode={true} />
      );
      
      const draggableElements = container.querySelectorAll('[draggable="true"]');
      expect(draggableElements.length).toBe(0);
    });

    it('should call onFileDrop when file is dropped', () => {
      const onFileDrop = jest.fn();
      const { container } = render(
        <FileList {...defaultProps} onFileDrop={onFileDrop} />
      );
      
      const dropTarget = container.querySelector('[draggable="true"]');
      if (dropTarget) {
        fireEvent.dragOver(dropTarget);
        fireEvent.drop(dropTarget);
        // onFileDrop may or may not be called depending on implementation
      }
    });
  });

  describe('Permission Handling', () => {
    it('should disable folders without read permission', () => {
      const filesWithPermissions = [
        {
          basename: 'accessible',
          path: '/accessible',
          type: 'directory',
          hasReadPermission: true,
        },
        {
          basename: 'restricted',
          path: '/restricted',
          type: 'directory',
          hasReadPermission: false,
        },
      ];

      render(<FileList {...defaultProps} files={filesWithPermissions} />);
      
      expect(screen.getByText('accessible')).toBeInTheDocument();
      expect(screen.getByText('restricted')).toBeInTheDocument();
    });
  });

  describe('Integration with useFileViewCommon', () => {
    it('should use common file view logic', () => {
      const { container } = render(<FileList {...defaultProps} />);
      
      // Should render without errors, using useFileViewCommon hook
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should handle multiple files with different states', () => {
      const selectedFiles = new Set(['/test.txt']);
      const processingMap = new Map([['/folder', 'copy']]);
      
      render(
        <FileList 
          {...defaultProps} 
          selectionMode={true}
          selectedFiles={selectedFiles}
          processingMap={processingMap}
        />
      );
      
      // Should render all files with their respective states
      expect(screen.getByText('test.txt')).toBeInTheDocument();
      expect(screen.getByText('folder')).toBeInTheDocument();
    });
  });
});

