import { renderHook, act } from '@testing-library/react';
import { useFileManagerNavigation } from '../useFileManagerNavigation';
import { checkPermission } from '../../services/fileService';
import { ERROR_TYPES } from '../../utils/errorUtils';

// Mock services and utils
jest.mock('../../services/fileService', () => ({
  checkPermission: jest.fn(),
}));

jest.mock('../../utils/recentFiles', () => ({
  addRecentFile: jest.fn(),
}));

jest.mock('../../utils/pathUtils', () => ({
  normalizePath: jest.fn(path => path),
}));

jest.mock('../../utils/errorUtils', () => ({
  determineErrorType: jest.fn(err => err.response?.status === 403 ? 'PERMISSION_DENIED' : 'UNKNOWN'),
  getErrorMessageByType: jest.fn(type => type),
  getErrorMessage: jest.fn(err => err.message),
  ERROR_TYPES: {
    PERMISSION_DENIED: 'PERMISSION_DENIED',
  },
}));

describe('useFileManagerNavigation', () => {
  const defaultProps = {
    currentPathRef: { current: '/' },
    setCurrentPath: jest.fn(),
    trackPathHistory: jest.fn(),
    trackRecentFileClick: jest.fn(),
    handleRecentFileError: jest.fn(),
    clearTracking: jest.fn(),
    showError: jest.fn(),
    user: { id: 1, is_admin: false },
    selectionMode: false,
    toggleFileSelection: jest.fn(),
    openPreviewDialog: jest.fn(),
    setSelectedFile: jest.fn(),
    canPreview: jest.fn(() => true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    checkPermission.mockResolvedValue({ hasRead: true });
  });

  describe('handlePathClick', () => {
    it('navigates to virtual paths directly', async () => {
      const { result } = renderHook(() => useFileManagerNavigation(defaultProps));
      
      await act(async () => {
        await result.current.handlePathClick('/__shared__');
      });

      expect(defaultProps.setCurrentPath).toHaveBeenCalledWith('/__shared__');
    });

    it('checks permission for regular user', async () => {
      const { result } = renderHook(() => useFileManagerNavigation(defaultProps));
      
      await act(async () => {
        await result.current.handlePathClick('/some/path');
      });

      expect(checkPermission).toHaveBeenCalledWith('/some/path');
      expect(defaultProps.setCurrentPath).toHaveBeenCalledWith('/some/path');
    });

    it('reverts path and throws on permission denied', async () => {
      checkPermission.mockResolvedValue({ hasRead: false });
      const { result } = renderHook(() => useFileManagerNavigation(defaultProps));
      
      await act(async () => {
        try {
          await result.current.handlePathClick('/forbidden');
        } catch (e) {
          // Expected
        }
      });

      expect(defaultProps.setCurrentPath).toHaveBeenCalledWith('/'); // Reverted to currentPathRef.current
    });

    it('skips permission check for admin', async () => {
      const propsWithAdmin = { ...defaultProps, user: { is_admin: true } };
      const { result } = renderHook(() => useFileManagerNavigation(propsWithAdmin));
      
      await act(async () => {
        await result.current.handlePathClick('/any/path');
      });

      expect(checkPermission).not.toHaveBeenCalled();
      expect(defaultProps.setCurrentPath).toHaveBeenCalledWith('/any/path');
    });
  });

  describe('handleFileClick', () => {
    it('toggles selection when selectionMode is true', async () => {
      const propsInSelection = { ...defaultProps, selectionMode: true };
      const { result } = renderHook(() => useFileManagerNavigation(propsInSelection));
      const mockFile = { path: '/file.txt', type: 'file' };

      await act(async () => {
        await result.current.handleFileClick(mockFile);
      });

      expect(propsInSelection.toggleFileSelection).toHaveBeenCalledWith(mockFile);
      expect(propsInSelection.openPreviewDialog).not.toHaveBeenCalled();
    });

    it('opens preview for files', async () => {
      const { result } = renderHook(() => useFileManagerNavigation(defaultProps));
      const mockFile = { path: '/file.txt', type: 'file', name: 'file.txt' };

      await act(async () => {
        await result.current.handleFileClick(mockFile);
      });

      expect(defaultProps.setSelectedFile).toHaveBeenCalled();
      expect(defaultProps.openPreviewDialog).toHaveBeenCalled();
    });

    it('navigates into directory', async () => {
      const { result } = renderHook(() => useFileManagerNavigation(defaultProps));
      const mockDir = { path: '/sub', type: 'directory' };

      await act(async () => {
        await result.current.handleFileClick(mockDir);
      });

      expect(defaultProps.setCurrentPath).toHaveBeenCalledWith('/sub');
    });
  });
});
