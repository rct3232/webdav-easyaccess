import { useCallback } from 'react';
import { checkPermission } from '../services/fileService';
import { addRecentFile } from '../utils/recentFiles';
import { normalizePath } from '../utils/pathUtils';
import { determineErrorType, getErrorMessageByType, getErrorMessage, ERROR_TYPES } from '../utils/errorUtils';

export const useFileManagerNavigation = ({
  currentPathRef,
  setCurrentPath,
  trackPathHistory,
  trackRecentFileClick,
  handleRecentFileError,
  clearTracking,
  showError,
  user,
  selectionMode,
  toggleFileSelection,
  openPreviewDialog,
  setSelectedFile,
  canPreview,
}) => {
  const handlePathClick = useCallback(async (path) => {
    if (path === '/__shared__' || path === '/__recent__') {
      setCurrentPath(path);
      return;
    }
    
    const previousPath = currentPathRef.current;
    const normalizedPath = normalizePath(path);
    
    trackPathHistory(normalizedPath, previousPath);
    trackPathHistory(path, previousPath);
    
    setCurrentPath(path);
    
    if (!user?.is_admin) {
      try {
        const permission = await checkPermission(path);
        if (!permission.hasRead) {
          setCurrentPath(previousPath);
          const permissionError = new Error('Permission denied');
          permissionError.response = { status: 403 };
          throw permissionError;
        }
      } catch (error) {
        setCurrentPath(previousPath);
        throw error;
      }
    }
  }, [currentPathRef, setCurrentPath, trackPathHistory, user]);

  const handleFileClick = useCallback(async (file) => {
    if (selectionMode) {
      toggleFileSelection(file);
    } else {
      if (file.type === 'directory') {
        if (file.isRecentFile) {
          const filePath = file.path;
          
          if (!filePath || filePath === '/' || filePath.trim() === '') {
            handleRecentFileError({ message: 'Invalid path' }, filePath);
            return;
          }
          
          trackRecentFileClick(filePath);
          
          try {
            await handlePathClick(filePath);
          } catch (error) {
            clearTracking(filePath);
            if (error.response?.status === 404) {
              handleRecentFileError(error, filePath);
            } else {
              const errorType = determineErrorType(error);
              const errorMessage = getErrorMessageByType(errorType);
              showError(errorMessage);
            }
          }
          return;
        }
        
        if (file.hasReadPermission === false) {
          showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
          return;
        }
        
        const previousPath = currentPathRef.current;
        setCurrentPath(file.path);
        
        if (!user?.is_admin) {
          try {
            const permission = await checkPermission(file.path);
            if (!permission.hasRead) {
              setCurrentPath(previousPath);
              showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
              return;
            }
          } catch (error) {
            setCurrentPath(previousPath);
            const errorType = determineErrorType(error);
            if (errorType === ERROR_TYPES.PERMISSION_DENIED) {
              showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
            } else {
              console.error('Failed to check permission:', error);
              showError(getErrorMessage(error, '권한 확인 중 오류가 발생했습니다.'));
            }
            return;
          }
        }
      } else {
        if (file.isRecentFile) {
          const filePath = normalizePath(file.path);
          const fileName = file.basename || file.name;
          
          if (!filePath || filePath === '/' || filePath.trim() === '') {
            handleRecentFileError({ message: 'Invalid path' }, filePath);
            return;
          }
          
          const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
          const normalizedParentPath = normalizePath(parentPath);
          
          try {
            trackRecentFileClick(filePath, normalizedParentPath);
            await handlePathClick(normalizedParentPath);
            
            const canPreviewFile = canPreview(fileName);
            setSelectedFile({ ...file, name: fileName, canPreview: canPreviewFile });
            openPreviewDialog();
          } catch (error) {
            clearTracking(filePath);
            if (error.response?.status === 404) {
              handleRecentFileError(error, filePath);
            } else {
              const errorType = determineErrorType(error);
              const errorMessage = getErrorMessageByType(errorType);
              showError(errorMessage);
            }
          }
          return;
        }

        const filename = file.basename || file.name;
        const canPreviewFile = canPreview(filename);
        setSelectedFile({ ...file, name: filename, canPreview: canPreviewFile });
        openPreviewDialog();
        await addRecentFile(file);
      }
    }
  }, [selectionMode, toggleFileSelection, handleRecentFileError, trackRecentFileClick, handlePathClick, clearTracking, showError, setCurrentPath, canPreview, setSelectedFile, openPreviewDialog, currentPathRef, user]);

  return {
    handlePathClick,
    handleFileClick,
  };
};
