import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { setViewMode as saveViewMode, setSortMode as saveSortMode } from '../../utils/localStorage';
import { useFileManager } from './hooks/useFileManager';
import { useExplorerInteraction } from './hooks/useExplorerInteraction';
import { useExplorerRefreshIndicator } from './hooks/useExplorerRefreshIndicator';
import { useExplorerSession } from './hooks/useExplorerSession';
import { useExplorerProgress } from './hooks/useExplorerProgress';
import { useExplorerCommands } from './hooks/useExplorerCommands';
import { useExplorerNavigation } from './hooks/useExplorerNavigation';
import { useShareLinkOverlay } from './hooks/useShareLinkOverlay';
import { useSelection } from './hooks/useSelection';
import { useDropToUpload } from '../../hooks/useDropToUpload';
import { useResponsive } from '../../hooks/useResponsive';
import { useMessage } from '../../hooks/useMessage';
import { shouldRefreshAfterOperation } from '../../utils/refreshPolicy';
import { checkPermission } from '../../services/fileService';
import { addRecentFile, onRecentFilesChange } from '../../utils/recentFiles';
import { normalizePath, getBasename, getParentPath } from '../../utils/pathUtils';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

import { useRecentFile } from './hooks/useRecentFile';
import { useFileManagerDialogs } from './hooks/useFileManagerDialogs';
import { useContentAreaDragDrop } from './hooks/useContentAreaDragDrop';
import FileManagerView from '../../components/file-manager/FileManagerView';

const FileManager = ({ shareToken, linkInfo } = {}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [contentAreaDraggedPath, setContentAreaDraggedPath] = useState(null);
  const [contentAreaDragType, setContentAreaDragType] = useState(null);

  const isShareLinkMode = Boolean(shareToken && linkInfo);
  const shareRootPath = useMemo(
    () => (linkInfo ? normalizePath(linkInfo.filePath || '/') : ''),
    [linkInfo]
  );
  const shareRootName = useMemo(
    () => linkInfo?.fileName || getBasename(shareRootPath) || t('nav.sharedFolder'),
    [linkInfo, shareRootPath, t]
  );
  // 로딩/새로고침 완료 콜백을 위한 ref (useFileManager 이전에 정의)
  const handleLoadCompleteRef = useRef(null);

  // useFileManager에 전달할 메모이제이션된 콜백
  const handleLoadCompleteCallback = useCallback(() => {
    if (isMobile && handleLoadCompleteRef.current) {
      handleLoadCompleteRef.current();
    }
  }, [isMobile]);

  const { message, showError, showWarning, clearMessage } = useMessage();
  const {
    addToSharedModalOpen,
    setAddToSharedModalOpen,
    addToSharedStatus,
    addToSharedConfirmLoading,
    openAddToSharedModal,
    handleAddToSharedConfirm,
    leaveShareConfirmOpen,
    setLeaveShareConfirmOpen,
    leaveShareConfirmTargetPath,
    setLeaveShareConfirmTargetPath,
    handleLeaveSharePathClick,
    handleLeaveShareConfirm,
  } = useShareLinkOverlay({
    isShareLinkMode,
    shareToken,
    linkInfo,
    user,
    navigate,
    showError,
    setDrawerOpen,
    t,
  });

  const {
    currentPath,
    setCurrentPath,
    files: filesFromHook,
    loading,
    sortMode,
    setSortMode,
    loadFiles,
    hasWritePermission,
    onLoadErrorRef,
  } = useFileManager(user, {
    onLoadComplete: handleLoadCompleteCallback,
    onLoadError: null, // 나중에 설정
    shareToken,
    linkInfo,
  });

  // currentPathRef는 useFileManager 호출 후에 정의 (currentPath가 필요)
  const currentPathRef = useRef(null);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const {
    sessionKey,
    files,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    sortedFiles,
    displayedFiles,
    loadMoreRef,
    hasMore,
    handleThumbnailsLoaded,
  } = useExplorerSession({
    currentPath,
    files: filesFromHook,
    sortMode,
    setSortMode,
    isMobile,
  });


  const {
    selectionMode,
    selectedFiles,
    handleSelectAll,
    handleDeselectAll,
    handleFileCheck,
    toggleFileSelection,
    handleFileClickSelection,
    enterSelectionMode,
    setSelectionMode,
    setSelectedFiles,
  } = useSelection(displayedFiles, sortedFiles);

  // 선택 모드에서 삭제/이동 버튼: 선택된 항목 모두 write 권한이 있어야 활성화
  const allSelectedHaveWrite = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    const selectedPaths = Array.from(selectedFiles);
    const selectedFileObjects = selectedPaths
      .map(path => sortedFiles.find(f => f.path === path))
      .filter(Boolean);
    return (
      selectedFileObjects.length === selectedPaths.length &&
      selectedFileObjects.every(f => f.hasWritePermission === true)
    );
  }, [selectionMode, selectedFiles, sortedFiles]);

  // 선택된 항목 중 읽기 전용(hasWritePermission === false) 포함 여부
  const hasReadOnlyInSelection = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    const selectedPaths = Array.from(selectedFiles);
    const selectedFileObjects = selectedPaths
      .map(path => sortedFiles.find(f => f.path === path))
      .filter(Boolean);
    return selectedFileObjects.some(f => f.hasWritePermission === false);
  }, [selectionMode, selectedFiles, sortedFiles]);

  // 디렉토리 이동 시 선택 모드 해제
  useEffect(() => {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }, [sessionKey, setSelectionMode, setSelectedFiles]);
  const {
    uploadDialogOpen, openUploadDialog, closeUploadDialog,
    createFolderDialogOpen, openCreateFolderDialog, closeCreateFolderDialog,
    previewDialogOpen, setPreviewDialogOpen, openPreviewDialog, closePreviewDialog,
    renameDialogOpen, openRenameDialog, closeRenameDialog,
    shareDialogOpen, closeShareDialog,
    shareDialogV2Open, shareDialogV2File, openShareDialogV2, closeShareDialogV2,
    propertiesDialogOpen, openPropertiesDialog, closePropertiesDialog,
    bulkDeleteDialogOpen, openBulkDeleteDialog, closeBulkDeleteDialog,
    actionSheetOpen, setActionSheetOpen, closeActionSheet,
    actionSheetFile, setActionSheetFile,
    selectedFile, setSelectedFile,
    contextMenu, setContextMenu,
    renameNewName, setRenameNewName,
    renameError, setRenameError,
    mobileRenameFile,
    mobileShareFile,
    mobilePropertiesFile,
    bulkDeleteFilePaths,
    mobilePickerFile, setMobilePickerFile,
    mobilePickerAction, setMobilePickerAction,
  } = useFileManagerDialogs();

  // Resolve file from current state to support live updates (e.g. thumbnails loading in background)
  const propertiesFile = useMemo(() => {
    const source = mobilePropertiesFile || actionSheetFile;
    if (!source) return null;
    return files.find(f => f.path === source.path) || source;
  }, [files, mobilePropertiesFile, actionSheetFile]);

  // 미리보기 갤러리용 미디어 파일 목록 (같은 경로의 이미지/비디오)
  const mediaFiles = useMemo(() => {
    if (!selectedFile) return [];
    if (currentPath === '/__shared__') {
      return sortedFiles.filter(
        (f) =>
          f.type === 'file' &&
          (getFileType(f.basename || f.name) === 'image' || getFileType(f.basename || f.name) === 'video')
      );
    }
    const parentPath = getParentPath(selectedFile.path);
    return sortedFiles.filter(
      (f) =>
        getParentPath(f.path) === parentPath &&
        (getFileType(f.basename || f.name) === 'image' || getFileType(f.basename || f.name) === 'video')
    );
  }, [sortedFiles, selectedFile, currentPath]);

  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });

  const {
    trackRecentFileClick,
    trackPathHistory,
    clearTracking,
    clearPathHistory,
    handleRecentFileError,
    setRecentFileToPreview,
  } = useRecentFile({
    setCurrentPath,
    showError,
    user,
    currentPathRef,
    setSelectedFile,
    setPreviewDialogOpen,
    files,
    loading,
    currentPath,
  });

  useEffect(() => {
    onLoadErrorRef.current = handleRecentFileError;
  }, [handleRecentFileError, onLoadErrorRef]);

  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
  const [viewModeMenuAnchor, setViewModeMenuAnchor] = useState(null);
  const loadFilesRef = useRef(loadFiles);

  // 파일 로드 성공 시 경로 히스토리 정리
  useEffect(() => {
    if (!loading && files.length >= 0 && currentPath) {
      // 로딩이 완료되고 파일 목록이 로드되었으면 정상적인 이동으로 간주
      // 히스토리에서 제거 (에러가 발생하지 않았음)
      clearPathHistory(currentPath);
    }
  }, [loading, files, currentPath, clearPathHistory]);

  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  // /__recent__ 경로일 때 최근항목 변경 이벤트 리스너 등록
  useEffect(() => {
    if (currentPath === '/__recent__') {
      const unsubscribe = onRecentFilesChange(() => {
        loadFiles();
      });

      return () => {
        unsubscribe();
      };
    }
  }, [currentPath, loadFiles]);

  // Operation completion handler (stable; uses refs to avoid stale-closure refresh)
  const handleOperationComplete = useCallback((info = {}) => {
    // Backward compatibility: allow legacy signature (deletedFolderPath string)
    const payload = typeof info === 'string'
      ? { opType: 'delete', deletedFolderPath: info }
      : (info || {});

    const opType = payload.opType || payload.type || 'refresh';
    const startedPath = payload.startedPath;
    const targetPath = payload.targetPath;
    const currentPathNow = currentPathRef.current;

    const deletedFolderPaths = Array.isArray(payload.deletedFolderPaths)
      ? payload.deletedFolderPaths
      : (payload.deletedFolderPath ? [payload.deletedFolderPath] : []);

    // Keep folder tree consistent (safe even if we skip list refresh)
    deletedFolderPaths.filter(Boolean).forEach((folderPath) => {
      setTreeUpdateTrigger({
        type: 'deleted',
        folderPath,
        timestamp: Date.now(),
      });
    });

    const shouldRefresh = shouldRefreshAfterOperation({
      opType,
      startedPath: startedPath ?? currentPathNow,
      currentPathNow,
      targetPath,
    });

    if (shouldRefresh) {
      const fn = loadFilesRef.current;
      if (typeof fn === 'function') {
        fn();
      }
    }

    if (deletedFolderPaths.length > 0) {
      setTimeout(() => {
        setTreeUpdateTrigger({
          type: 'refresh',
          timestamp: Date.now(),
        });
      }, 500);
    }
  }, [setTreeUpdateTrigger]);

  // Explorer drag and drop hook for the entire file content area
  const {
    isDraggingOver: isFileAreaDraggingOver,
    handleDragEnter: handleFileAreaDragEnter,
    handleDragOver: handleFileAreaDragOver,
    handleDragLeave: handleFileAreaDragLeave,
    handleDrop: handleFileAreaDrop,
    reset: resetFileAreaDrag,
  } = useDropToUpload();
  const {
    showRefreshSuccess,
    handleLoadComplete,
    indicatorStyles,
    iconStyles,
    progress,
    progressColor,
    textColor,
    textContent,
    shouldShowIndicator,
    isDeterminateProgress,
  } = useExplorerRefreshIndicator({
    isMobile,
    loading,
    loadFiles,
    scrollContainerRef,
    t,
  });
  handleLoadCompleteRef.current = handleLoadComplete;

  const {
    processingMap,
    renameLoading,
    folderPickerOpen,
    folderPickerAction,
    setFolderPickerOpen,
    setFolderPickerAction,
    progressItems,
    updateProgress,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDownload,
    handleFolderPickerSelect,
    handleRetry,
    handleCancelBulkOperation,
    bulkConflictData,
    resolveBulkConflict,
    setBulkConflictData,
    folderPickerMoveCopyInProgress: bulkMoveCopyInProgress,
    uploadConflictData,
    setUploadConflictData,
    resolveUploadConflict,
    executeExplorerUpload,
    handleUploadStart,
    handleExplorerDrop,
    explorerUploadFilesRef,
    explorerUploadAbortControllersRef,
    explorerUploadCancelledRef,
    explorerUploadCancelAllRequestedRef,
    handleRename,
    handleActionSheetDownload,
    handleFileDownloadOp,
    handleFileDrop,
    handleInternalFileDrop,
    handleDropPermissionDenied,
    handleBulkDeleteConfirm,
  } = useExplorerCommands({
    t,
    user,
    isMobile,
    isShareLinkMode,
    shareToken,
    currentPath,
    currentPathRef,
    hasWritePermission,
    selectedFiles,
    sortedFiles,
    handleOperationComplete,
    setTreeUpdateTrigger,
    setDropMessage,
    setSelectedFiles,
    setSelectionMode,
    showError,
    closeUploadDialog,
    closeBulkDeleteDialog,
    closeRenameDialog,
    closeActionSheet,
    setActionSheetOpen,
    setActionSheetFile,
    actionSheetFile,
    mobileRenameFile,
    renameNewName,
    setRenameError,
    bulkDeleteFilePaths,
  });

  const {
    isProgressDrawerOpen,
    setProgressDrawerOpen,
    retryProgress,
    cancelUploadFile,
    cancelAllProgress,
  } = useExplorerProgress({
    progressItems,
    updateProgress,
    handleRetry,
    executeExplorerUpload,
    explorerUploadFilesRef,
    explorerUploadAbortControllersRef,
    explorerUploadCancelledRef,
    explorerUploadCancelAllRequestedRef,
    handleCancelBulkOperation,
    handleOperationComplete,
    setTreeUpdateTrigger,
    currentPathRef,
    t,
  });

  const {
    navigateToPath: navigateToExplorerPath,
    handleFolderOpen: openExplorerFolder,
  } = useExplorerNavigation({
    currentPath,
    getPreviousPath: () => currentPathRef.current,
    setCurrentPath,
    onTrackPathHistory: trackPathHistory,
    canNavigateToPath: async (path) => {
      if (user?.is_admin) return true;
      const permission = await checkPermission(path);
      return permission?.hasRead === true;
    },
  });
  const handleProductPathClick = useCallback(async (path) => {
    if (!path) return false;

    if (isShareLinkMode) {
      const normalizedPath = normalizePath(path);
      setCurrentPath(normalizedPath);
      if (isMobile) setDrawerOpen(false);
      return true;
    }

    if (path === '/__shared__' || path === '/__recent__') {
      setCurrentPath(path);
      return true;
    }

    return false;
  }, [isShareLinkMode, isMobile, setCurrentPath, setDrawerOpen]);

  const handleAddRecentFile = useCallback((file) => addRecentFile(file), []);

  const {
    handlePathClick,
    handleFileClick,
    handleMoreClick,
    handleLongPressSelect,
    handleActionSheetPreview,
  } = useExplorerInteraction({
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
    recentFileApi: {
      trackRecentFileClick,
      clearTracking,
      handleRecentFileError,
      setRecentFileToPreview,
    },
    handleProductPathClick,
    onAddRecentFile: handleAddRecentFile,
  });

  const handleCreateFolderComplete = useCallback((folderPath, folderName) => {
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/')) || (user?.is_admin ? '/' : `/${user?.username || ''}`);
    setTreeUpdateTrigger({
      type: 'created',
      folderPath,
      folderName,
      parentPath,
      timestamp: Date.now(),
    });

    handleOperationComplete({ opType: 'createFolder', startedPath: parentPath });
    closeCreateFolderDialog();

    setTimeout(() => {
      setTreeUpdateTrigger({
        type: 'refresh',
        timestamp: Date.now(),
      });
    }, 500);
  }, [user, setTreeUpdateTrigger, handleOperationComplete, closeCreateFolderDialog]);

  const handleViewContextMenu = useCallback(
    (e, file) => {
      if (e?.cancelable) e.preventDefault();
      if (!isMobile) {
        setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
        setSelectedFile(file);
      }
    },
    [isMobile, setContextMenu, setSelectedFile]
  );

  const handleDragStartFromView = useCallback((path) => {
    setContentAreaDraggedPath(path);
  }, []);

  const handleDragEndFromView = useCallback(() => {
    setContentAreaDraggedPath(null);
    setContentAreaDragType(null);
  }, []);

  const contentAreaDnD = useContentAreaDragDrop({
    isMobile,
    selectionMode,
    hasWritePermission,
    isShareLinkMode,
    currentPath,
    contentAreaDraggedPath,
    setContentAreaDraggedPath,
    setContentAreaDragType,
    handleInternalFileDrop,
    handleExplorerDrop,
    handleFileAreaDragEnter,
    handleFileAreaDragOver,
    handleFileAreaDragLeave,
    handleFileAreaDrop,
    resetFileAreaDrag,
  });

  // Desktop: click on empty space exits selection mode
  const handleScrollAreaClick = useCallback((e) => {
    if (isMobile || !selectionMode) return;
    if (e.target.closest('[data-file-path]')) return;
    handleDeselectAll();
    setSelectionMode(false);
  }, [isMobile, selectionMode, handleDeselectAll, setSelectionMode]);

  const onShareTargetSave = useCallback(() => {
    handleOperationComplete({ opType: 'refresh', startedPath: currentPathRef.current });
  }, [handleOperationComplete]);

  const shareContextProps = useMemo(() => ({
    shareToken,
    isShareLinkMode,
    shareRootPath,
    shareRootName,
  }), [shareToken, isShareLinkMode, shareRootPath, shareRootName]);

  const shellContextProps = useMemo(() => ({
    user,
    navigate,
    isMobile,
    fileContentRef,
    scrollContainerRef,
  }), [user, navigate, isMobile]);

  const overlayStateProps = useMemo(() => ({
    drawerOpen,
    setDrawerOpen,
    progressDrawerOpen: isProgressDrawerOpen,
    setProgressDrawerOpen,
    loginModalOpen,
    setLoginModalOpen,
    addToSharedModalOpen,
    setAddToSharedModalOpen,
    addToSharedStatus,
    addToSharedConfirmLoading,
    openAddToSharedModal,
    handleAddToSharedConfirm,
    leaveShareConfirmOpen,
    setLeaveShareConfirmOpen,
    leaveShareConfirmTargetPath,
    setLeaveShareConfirmTargetPath,
    handleLeaveShareConfirm,
  }), [
    drawerOpen,
    setDrawerOpen,
    isProgressDrawerOpen,
    setProgressDrawerOpen,
    loginModalOpen,
    setLoginModalOpen,
    addToSharedModalOpen,
    setAddToSharedModalOpen,
    addToSharedStatus,
    addToSharedConfirmLoading,
    openAddToSharedModal,
    handleAddToSharedConfirm,
    leaveShareConfirmOpen,
    setLeaveShareConfirmOpen,
    leaveShareConfirmTargetPath,
    setLeaveShareConfirmTargetPath,
    handleLeaveShareConfirm,
  ]);

  const controlsStateProps = useMemo(() => ({
    currentPath,
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    saveSortMode,
    viewModeMenuAnchor,
    setViewModeMenuAnchor,
    sortMenuAnchor,
    setSortMenuAnchor,
    searchQuery,
    setSearchQuery,
    saveViewMode,
  }), [
    currentPath,
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    viewModeMenuAnchor,
    setViewModeMenuAnchor,
    sortMenuAnchor,
    setSortMenuAnchor,
    searchQuery,
    setSearchQuery,
  ]);

  const listingStateProps = useMemo(() => ({
    displayedFiles,
    loading,
    processingMap,
    handleThumbnailsLoaded,
    loadMoreRef,
    hasMore,
  }), [
    displayedFiles,
    loading,
    processingMap,
    handleThumbnailsLoaded,
    loadMoreRef,
    hasMore,
  ]);

  const explorerSessionProps = useMemo(() => ({
    controlsState: controlsStateProps,
    listingState: listingStateProps,
  }), [
    controlsStateProps,
    listingStateProps,
  ]);

  const selectionModelProps = useMemo(() => ({
    selectionMode,
    selectedFiles,
    handleFileCheck,
  }), [
    selectionMode,
    selectedFiles,
    handleFileCheck,
  ]);

  const bulkStateProps = useMemo(() => ({
    handleSelectAll,
    handleDeselectAll,
    allSelectedHaveWrite,
    hasReadOnlyInSelection,
  }), [
    handleSelectAll,
    handleDeselectAll,
    allSelectedHaveWrite,
    hasReadOnlyInSelection,
  ]);

  const selectionProps = useMemo(() => ({
    selectionModel: selectionModelProps,
    bulkState: bulkStateProps,
  }), [
    selectionModelProps,
    bulkStateProps,
  ]);

  const capabilityStateProps = useMemo(() => ({
    hasWritePermission,
  }), [
    hasWritePermission,
  ]);

  const treeStateProps = useMemo(() => ({
    treeUpdateTrigger,
  }), [
    treeUpdateTrigger,
  ]);

  const transferStateProps = useMemo(() => ({
    contentAreaDraggedPath,
    bulkMoveCopyInProgress,
  }), [
    contentAreaDraggedPath,
    bulkMoveCopyInProgress,
  ]);

  const explorerActionStateProps = useMemo(() => ({
    capabilityState: capabilityStateProps,
    treeState: treeStateProps,
    transferState: transferStateProps,
  }), [
    capabilityStateProps,
    treeStateProps,
    transferStateProps,
  ]);

  const actionContextProps = useMemo(() => ({
    actionSheetOpen,
    closeActionSheet,
    actionSheetFile,
    contextMenu,
    setContextMenu,
  }), [
    actionSheetOpen,
    closeActionSheet,
    actionSheetFile,
    contextMenu,
    setContextMenu,
  ]);

  const pickerStateProps = useMemo(() => ({
    mobilePickerFile,
    setMobilePickerFile,
    mobilePickerAction,
    setMobilePickerAction,
    folderPickerOpen,
    folderPickerAction,
    setFolderPickerOpen,
    setFolderPickerAction,
  }), [
    mobilePickerFile,
    setMobilePickerFile,
    mobilePickerAction,
    setMobilePickerAction,
    folderPickerOpen,
    folderPickerAction,
    setFolderPickerOpen,
    setFolderPickerAction,
  ]);

  const modalDialogsProps = useMemo(() => ({
    uploadDialogOpen,
    closeUploadDialog,
    createFolderDialogOpen,
    closeCreateFolderDialog,
    previewDialogOpen,
    closePreviewDialog,
    openRenameDialog,
    closeRenameDialog,
    renameDialogOpen,
    renameNewName,
    setRenameNewName,
    renameError,
    setRenameError,
    renameLoading,
    shareDialogV2Open,
    closeShareDialogV2,
    shareDialogOpen,
    closeShareDialog,
    openShareDialogV2,
    propertiesDialogOpen,
    closePropertiesDialog,
    openPropertiesDialog,
    bulkDeleteDialogOpen,
    closeBulkDeleteDialog,
  }), [
    uploadDialogOpen,
    closeUploadDialog,
    createFolderDialogOpen,
    closeCreateFolderDialog,
    previewDialogOpen,
    closePreviewDialog,
    openRenameDialog,
    closeRenameDialog,
    renameDialogOpen,
    renameNewName,
    setRenameNewName,
    renameError,
    setRenameError,
    renameLoading,
    shareDialogV2Open,
    closeShareDialogV2,
    shareDialogOpen,
    closeShareDialog,
    openShareDialogV2,
    propertiesDialogOpen,
    closePropertiesDialog,
    openPropertiesDialog,
    bulkDeleteDialogOpen,
    closeBulkDeleteDialog,
  ]);

  const fileTargetsProps = useMemo(() => ({
    shareDialogV2File,
    mobileShareFile,
    propertiesFile,
    bulkDeleteFilePaths,
    bulkConflictData,
    setBulkConflictData,
    uploadConflictData,
    setUploadConflictData,
    mediaFiles,
    selectedFile,
    setSelectedFile,
  }), [
    shareDialogV2File,
    mobileShareFile,
    propertiesFile,
    bulkDeleteFilePaths,
    bulkConflictData,
    setBulkConflictData,
    uploadConflictData,
    setUploadConflictData,
    mediaFiles,
    selectedFile,
    setSelectedFile,
  ]);

  const dialogStateProps = useMemo(() => ({
    actionContext: actionContextProps,
    pickerState: pickerStateProps,
    modalDialogs: modalDialogsProps,
    fileTargets: fileTargetsProps,
  }), [
    actionContextProps,
    pickerStateProps,
    modalDialogsProps,
    fileTargetsProps,
  ]);

  const messagingProps = useMemo(() => ({
    dropMessage,
    setDropMessage,
    message,
    clearMessage,
    showError,
    showWarning,
  }), [dropMessage, message, clearMessage, showError, showWarning]);

  const interactionHandlersProps = useMemo(() => ({
    handleFileClick,
    handleMoreClick,
    handleLongPressSelect,
    handleViewContextMenu,
    handleFileDrop,
    handleDropPermissionDenied,
    handleDragStartFromView,
    handleDragEndFromView,
    handleExplorerDrop,
    handleInternalFileDrop,
    handleLeaveSharePathClick,
    handlePathClick,
    handleScrollAreaClick,
    handleFileDownloadOp,
    contentAreaDnD,
    isFileAreaDraggingOver,
    contentAreaDragType,
    handleActionSheetDownload,
    handleActionSheetPreview,
  }), [
    handleFileClick,
    handleMoreClick,
    handleLongPressSelect,
    handleViewContextMenu,
    handleFileDrop,
    handleDropPermissionDenied,
    handleDragStartFromView,
    handleDragEndFromView,
    handleExplorerDrop,
    handleInternalFileDrop,
    handleLeaveSharePathClick,
    handlePathClick,
    handleScrollAreaClick,
    handleFileDownloadOp,
    contentAreaDnD,
    isFileAreaDraggingOver,
    contentAreaDragType,
    handleActionSheetDownload,
    handleActionSheetPreview,
  ]);

  const commandHandlersProps = useMemo(() => ({
    handleOperationComplete,
    handleRename,
    handleBulkDeleteConfirm,
    resolveBulkConflict,
    resolveUploadConflict,
    handleUploadStart,
    handleCreateFolderComplete,
    handleFolderPickerSelect,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDownload,
    openBulkDeleteDialog,
    openUploadDialog,
    openCreateFolderDialog,
    onShareTargetSave,
  }), [
    handleOperationComplete,
    handleRename,
    handleBulkDeleteConfirm,
    resolveBulkConflict,
    resolveUploadConflict,
    handleUploadStart,
    handleCreateFolderComplete,
    handleFolderPickerSelect,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDownload,
    openBulkDeleteDialog,
    openUploadDialog,
    openCreateFolderDialog,
    onShareTargetSave,
  ]);

  const progressHandlersProps = useMemo(() => ({
    progressItems,
    updateProgress,
    handleRetryUpload: retryProgress,
    handleCancelUploadFileWrapper: cancelUploadFile,
    handleCancelAllWrapper: cancelAllProgress,
  }), [
    progressItems,
    updateProgress,
    retryProgress,
    cancelUploadFile,
    cancelAllProgress,
  ]);

  const refreshIndicatorProps = useMemo(() => ({
    indicatorStyles,
    iconStyles,
    isDeterminateProgress,
    progress,
    progressColor,
    textColor,
    shouldShowIndicator,
    showRefreshSuccess,
    textContent,
  }), [
    indicatorStyles,
    iconStyles,
    isDeterminateProgress,
    progress,
    progressColor,
    textColor,
    shouldShowIndicator,
    showRefreshSuccess,
    textContent,
  ]);

  const explorerHandlersProps = useMemo(() => ({
    interaction: interactionHandlersProps,
    commands: commandHandlersProps,
    progress: progressHandlersProps,
    refreshIndicator: refreshIndicatorProps,
  }), [
    interactionHandlersProps,
    commandHandlersProps,
    progressHandlersProps,
    refreshIndicatorProps,
  ]);

  return (
    <FileManagerView
      shareContext={shareContextProps}
      shellContext={shellContextProps}
      overlayState={overlayStateProps}
      explorerSession={explorerSessionProps}
      selectionState={selectionProps}
      explorerActionState={explorerActionStateProps}
      dialogState={dialogStateProps}
      messaging={messagingProps}
      explorerHandlers={explorerHandlersProps}
    />
  );
};

export default FileManager;
