import { useRef, useEffect, useCallback } from 'react';

import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

import { canPreview } from '../../../utils/fileUtils';
import { normalizePath } from '../../../utils/pathUtils';
import { getEntryKey } from '../../../utils/fileViewUtils';
import {
  determineErrorType,
  getErrorMessageByType,
  showErrorFromError,
  ERROR_TYPES,
} from '../../../utils/errorUtils';
import explorerGateway from '../../../services/explorerGateway';

function openPreviewForFile(file, setSelectedFile, openPreviewDialog) {
  const filename = file.basename || file.name;
  const canPreviewFile = canPreview(filename);
  setSelectedFile({ ...file, name: filename, canPreview: canPreviewFile });
  openPreviewDialog();
}

export function useExplorerInteraction({
  isMobile,
  isShareLinkMode,
  selectionMode,
  displayedFiles,
  toggleFileSelection,
  handleFileClickSelection,
  enterSelectionMode,
  setSelectedFiles,
  navigateToExplorerPath,
  openExplorerFolder,
  openPreviewDialog,
  setSelectedFile,
  setContextMenu,
  setActionSheetFile,
  actionSheetFile,
  showError,
  t,
  recentFileApi,
  handleProductPathClick,
}) {
  const lastClickRef = useRef({ fileKey: null, time: 0 });
  const handleFileClickInternalRef = useRef(null);

  const handlePathClick = useCallback(async (path, file) => {
    if (!path) return;

    const handledByProductPolicy = await handleProductPathClick?.(path, file);
    if (handledByProductPolicy) return;

    return navigateToExplorerPath(path);
  }, [handleProductPathClick, navigateToExplorerPath]);

  const handleFileClickInternal = useCallback(async (file, options = {}) => {
    if (!file) return;

    const { forceOpen = false } = options;
    const inSelectionMode = forceOpen ? false : selectionMode;
    const {
      trackRecentFileClick,
      clearTracking,
      handleRecentFileError,
      setRecentFileToPreview,
    } = recentFileApi || {};

    if (isShareLinkMode) {
      if (inSelectionMode) {
        toggleFileSelection(file);
      } else if (file.type === 'directory') {
        await handlePathClick(file.path, file);
      } else {
        openPreviewForFile(file, setSelectedFile, openPreviewDialog);
      }
      return;
    }

    if (inSelectionMode) {
      toggleFileSelection(file);
      return;
    }

    if (file.type === 'directory') {
      if (file.isRecentFile) {
        const filePath = file.path;
        if (!filePath || filePath === '/' || filePath.trim() === '') {
          handleRecentFileError?.({ message: t('errors.invalidPath') }, filePath);
          return;
        }

        trackRecentFileClick?.(filePath);
        try {
          await handlePathClick(filePath);
        } catch (error) {
          clearTracking?.(filePath);
          if (error.response?.status === HTTP_STATUS.NOT_FOUND) {
            handleRecentFileError?.(error, filePath);
          } else {
            showErrorFromError(error, showError, t);
          }
        }
        return;
      }

      if (file.hasReadPermission === false) {
        showError(t(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)));
        return;
      }

      try {
        if (file.nodeId != null) {
          await openExplorerFolder(file.nodeId);
        } else {
          await handlePathClick(file.path);
        }
      } catch (error) {
        const errorType = determineErrorType(error);
        if (errorType === ERROR_TYPES.PERMISSION_DENIED) {
          showError(t(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)));
        } else {
          showErrorFromError(error, showError, t, 'fileManager.permissionCheckError');
        }
      }
      return;
    }

    if (file.isRecentFile) {
      const filePath = normalizePath(file.path);
      const fileName = file.basename || file.name;

      if (!filePath || filePath === '/' || filePath.trim() === '') {
        handleRecentFileError?.({ message: t('errors.invalidPath') }, filePath);
        return;
      }

      const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
      const normalizedParentPath = normalizePath(parentPath);

      try {
        trackRecentFileClick?.(filePath, normalizedParentPath);
        await handlePathClick(normalizedParentPath);
        setRecentFileToPreview?.({
          filePath,
          fileName,
          parentPath: normalizedParentPath,
          originalFile: file,
        });
      } catch (error) {
        clearTracking?.(normalizedParentPath);
        if (error.response?.status === HTTP_STATUS.NOT_FOUND) {
          handleRecentFileError?.(error, filePath);
        } else {
          showErrorFromError(error, showError, t);
        }
      }
      return;
    }

    openPreviewForFile(file, setSelectedFile, openPreviewDialog);
    await explorerGateway.addRecentFile(file);
  }, [
    selectionMode,
    recentFileApi,
    isShareLinkMode,
    toggleFileSelection,
    handlePathClick,
    setSelectedFile,
    openPreviewDialog,
    t,
    showError,
    openExplorerFolder,
  ]);

  useEffect(() => {
    handleFileClickInternalRef.current = handleFileClickInternal;
  }, [handleFileClickInternal]);

  const handleFileClick = useCallback((file, event, fileIndex) => {
    if (!file) return;

    if (!event) {
      handleFileClickInternalRef.current?.(file);
      return;
    }

    if (isMobile) {
      handleFileClickInternalRef.current?.(file);
      return;
    }

    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick = last.fileKey === getEntryKey(file) && (now - last.time) < 350;

    if (isDoubleClick) {
      lastClickRef.current = { fileKey: null, time: 0 };
      handleFileClickInternalRef.current?.(file, { forceOpen: true });
      return;
    }

    lastClickRef.current = { fileKey: getEntryKey(file), time: now };
    const index = typeof fileIndex === 'number'
      ? fileIndex
      : displayedFiles.findIndex(f => getEntryKey(f) === getEntryKey(file));
    handleFileClickSelection(file, event, index >= 0 ? index : 0);
  }, [isMobile, displayedFiles, handleFileClickSelection]);

  const handleMoreClick = useCallback((file, event) => {
    if (!file) return;

    if (isMobile) {
      setActionSheetFile(file);
    } else {
      setContextMenu(event ? { mouseX: event.clientX, mouseY: event.clientY } : { mouseX: 0, mouseY: 0 });
      setSelectedFile(file);
    }
  }, [isMobile, setActionSheetFile, setContextMenu, setSelectedFile]);

  const handleLongPressSelect = useCallback((file) => {
    if (!file) return;
    enterSelectionMode();
    setSelectedFiles(new Set([getEntryKey(file)]));
  }, [enterSelectionMode, setSelectedFiles]);

  const handleActionSheetPreview = useCallback(() => {
    if (!actionSheetFile) return;
    openPreviewForFile(actionSheetFile, setSelectedFile, openPreviewDialog);
  }, [actionSheetFile, setSelectedFile, openPreviewDialog]);

  return {
    handlePathClick,
    handleFileClick,
    handleMoreClick,
    handleLongPressSelect,
    handleActionSheetPreview,
  };
}
