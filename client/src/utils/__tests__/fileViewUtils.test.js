import React from 'react';
import {
  renderProcessingIcon,
  getFileItemState,
  getDropTargetStyles,
} from '../fileViewUtils';

describe('fileViewUtils', () => {
  describe('renderProcessingIcon', () => {
    it('should return valid JSX element for move type', () => {
      const icon = renderProcessingIcon('move');
      expect(icon).toBeTruthy();
      expect(React.isValidElement(icon)).toBe(true);
      expect(icon.props.fontSize).toBe('small');
      expect(icon.props.color).toBe('primary');
    });

    it('should return valid JSX element for copy type', () => {
      const icon = renderProcessingIcon('copy');
      expect(icon).toBeTruthy();
      expect(React.isValidElement(icon)).toBe(true);
      expect(icon.props.fontSize).toBe('small');
      expect(icon.props.color).toBe('primary');
    });

    it('should return valid JSX element for delete type', () => {
      const icon = renderProcessingIcon('delete');
      expect(icon).toBeTruthy();
      expect(React.isValidElement(icon)).toBe(true);
      expect(icon.props.fontSize).toBe('small');
      expect(icon.props.color).toBe('primary');
    });

    it('should return null for unknown type', () => {
      expect(renderProcessingIcon('unknown')).toBeNull();
      expect(renderProcessingIcon(null)).toBeNull();
      expect(renderProcessingIcon(undefined)).toBeNull();
      expect(renderProcessingIcon('')).toBeNull();
    });

    it('should render icons with correct props', () => {
      const moveIcon = renderProcessingIcon('move');
      expect(moveIcon.props.fontSize).toBe('small');
      expect(moveIcon.props.color).toBe('primary');
    });
  });

  describe('getFileItemState', () => {
    const mockFile = {
      path: '/test/file.txt',
      basename: 'file.txt',
      type: 'file',
      size: 1024,
    };

    const mockDirectory = {
      path: '/test/folder',
      basename: 'folder',
      type: 'directory',
    };

    describe('selection state', () => {
      it('should return isSelected true when file is selected', () => {
        const selectedFiles = new Set(['/test/file.txt']);
        const result = getFileItemState(mockFile, true, selectedFiles, null);
        
        expect(result.isSelected).toBe(true);
      });

      it('should return isSelected false when file is not selected', () => {
        const selectedFiles = new Set(['/other/file.txt']);
        const result = getFileItemState(mockFile, true, selectedFiles, null);
        
        expect(result.isSelected).toBe(false);
      });

      it('should return isSelected false when not in selection mode', () => {
        const selectedFiles = new Set(['/test/file.txt']);
        const result = getFileItemState(mockFile, false, selectedFiles, null);
        
        expect(result.isSelected).toBe(false);
      });

      it('should handle null selectedFiles', () => {
        const result = getFileItemState(mockFile, true, null, null);
        
        // When selectedFiles is null, the result will be falsy (null or false)
        expect(result.isSelected).toBeFalsy();
      });
    });

    describe('permission state', () => {
      it('should disable directory without read permission', () => {
        const dirWithoutPermission = {
          ...mockDirectory,
          hasReadPermission: false,
        };
        const result = getFileItemState(dirWithoutPermission, false, null, null);
        
        expect(result.isPermissionDisabled).toBe(true);
        expect(result.isDisabled).toBe(true);
      });

      it('should not disable directory with read permission', () => {
        const dirWithPermission = {
          ...mockDirectory,
          hasReadPermission: true,
        };
        const result = getFileItemState(dirWithPermission, false, null, null);
        
        expect(result.isPermissionDisabled).toBe(false);
        expect(result.isDisabled).toBe(false);
      });

      it('should not disable files regardless of permission', () => {
        const fileWithoutPermission = {
          ...mockFile,
          hasReadPermission: false,
        };
        const result = getFileItemState(fileWithoutPermission, false, null, null);
        
        expect(result.isPermissionDisabled).toBe(false);
      });
    });

    describe('processing state', () => {
      it('should return processing state when file is being processed', () => {
        const processingMap = new Map([['/test/file.txt', 'move']]);
        const result = getFileItemState(mockFile, false, null, processingMap);
        
        expect(result.isProcessing).toBe(true);
        expect(result.processingType).toBe('move');
        expect(result.isDisabled).toBe(true);
      });

      it('should return different processing types', () => {
        const moveMap = new Map([['/test/file.txt', 'move']]);
        const copyMap = new Map([['/test/file.txt', 'copy']]);
        const deleteMap = new Map([['/test/file.txt', 'delete']]);
        
        expect(getFileItemState(mockFile, false, null, moveMap).processingType).toBe('move');
        expect(getFileItemState(mockFile, false, null, copyMap).processingType).toBe('copy');
        expect(getFileItemState(mockFile, false, null, deleteMap).processingType).toBe('delete');
      });

      it('should return not processing when processingMap is null', () => {
        const result = getFileItemState(mockFile, false, null, null);
        
        expect(result.isProcessing).toBe(false);
        expect(result.processingType).toBeUndefined();
      });

      it('should return not processing when file is not in map', () => {
        const processingMap = new Map([['/other/file.txt', 'move']]);
        const result = getFileItemState(mockFile, false, null, processingMap);
        
        expect(result.isProcessing).toBe(false);
        expect(result.processingType).toBeUndefined();
      });
    });

    describe('combined states', () => {
      it('should disable when both permission denied and processing', () => {
        const dirWithoutPermission = {
          ...mockDirectory,
          hasReadPermission: false,
        };
        const processingMap = new Map([[dirWithoutPermission.path, 'move']]);
        const result = getFileItemState(dirWithoutPermission, false, null, processingMap);
        
        expect(result.isPermissionDisabled).toBe(true);
        expect(result.isProcessing).toBe(true);
        expect(result.isDisabled).toBe(true);
      });

      it('should return all state properties', () => {
        const result = getFileItemState(mockFile, false, null, null);
        
        expect(result).toHaveProperty('isSelected');
        expect(result).toHaveProperty('isDisabled');
        expect(result).toHaveProperty('isProcessing');
        expect(result).toHaveProperty('processingType');
        expect(result).toHaveProperty('isPermissionDisabled');
      });
    });
  });

  describe('getDropTargetStyles', () => {
    it('should return empty object when not drop target', () => {
      const styles = getDropTargetStyles(false);
      expect(styles).toEqual({});
    });

    it('should return styles when is drop target', () => {
      const styles = getDropTargetStyles(true);
      
      expect(styles.backgroundColor).toBe('primary.main');
      expect(styles.color).toBe('white');
      expect(styles['& .MuiAvatar-root']).toBeDefined();
      expect(styles['& .MuiSvgIcon-root']).toBeDefined();
      expect(styles['& .MuiTypography-root']).toBeDefined();
    });

    it('should have correct nested styles', () => {
      const styles = getDropTargetStyles(true);
      
      expect(styles['& .MuiAvatar-root'].filter).toBe('brightness(0) invert(1)');
      expect(styles['& .MuiSvgIcon-root'].color).toBe('white');
      expect(styles['& .MuiTypography-root'].color).toBe('white');
    });
  });
});

