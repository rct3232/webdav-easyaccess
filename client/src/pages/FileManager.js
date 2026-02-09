import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Collapse,
  CircularProgress,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  ChevronLeft as ChevronLeftIcon,
  Home as HomeIcon,
  Share as ShareIcon,
  AccessTime as AccessTimeIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { VIEW_MODES } from '../constants/fileManager';
import { canPreview, sortFiles } from '../utils/fileUtils';
import { getViewMode, setViewMode as saveViewMode, setSortMode as saveSortMode } from '../utils/localStorage';
import { useFileManager } from '../hooks/useFileManager';
import { useSelection } from '../hooks/useSelection';
import { useBulkOperations } from '../hooks/useBulkOperations';
import { useExplorerDragAndDrop } from '../hooks/useExplorerDragAndDrop';
import { useResponsive } from '../hooks/useResponsive';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useFileUpload } from '../hooks/useFileUpload';
import { useFileOperations } from '../hooks/useFileOperations';
import { uploadMultipleFiles } from '../services/fileService';
import { useMessage } from '../hooks/useMessage';
import { createProcessingUpdater } from '../utils/processingUtils';
import { shouldRefreshAfterOperation } from '../utils/refreshPolicy';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import FileList from '../components/FileList';
import FileGrid from '../components/FileGrid';
import FileDetail from '../components/FileDetail';
import UploadDialog from '../components/UploadDialog';
import CreateFolderDialog from '../components/CreateFolderDialog';
import FileContextMenu from '../components/FileContextMenu';
import FilePreviewDialog from '../components/FilePreviewDialog';
import FileOperationProgress from '../components/FileOperationProgress';
import FolderTree from '../components/FolderTree';
import FolderPickerDialog from '../components/FolderPickerDialog';
import MobileBreadcrumb from '../components/MobileBreadcrumb';
import MobileFAB from '../components/MobileFAB';
import FileActionSheet from '../components/FileActionSheet';
import ShareDialog from '../components/ShareDialog';
import SharedFolderManageDialog from '../components/SharedFolderManageDialog';
import FilePropertiesDialog from '../components/FilePropertiesDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import ConflictResolveDialog from '../components/ConflictResolveDialog';
import { checkPermission, checkConflicts } from '../services/fileService';
import { addRecentFile, onRecentFilesChange } from '../utils/recentFiles';
import { determineErrorType, getErrorMessageByType, getErrorMessage, ERROR_TYPES } from '../utils/errorUtils';
import { normalizePath } from '../utils/pathUtils';
import { useRecentFileErrorHandler } from '../hooks/useRecentFileErrorHandler';
import { useRecentFileNavigation } from '../hooks/useRecentFileNavigation';
import { useRecentFilePreview } from '../hooks/useRecentFilePreview';
import { useFileManagerDialogs } from '../hooks/useFileManagerDialogs';

import FileManagerHeader from '../components/FileManagerHeader';
import FileManagerControls from '../components/FileManagerControls';
import BulkActionToolbar from '../components/BulkActionToolbar';

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // 디바운스 타이머 ref 및 최신 핸들러 ref
  const fileClickDebounceTimer = useRef(null);
  const handleFileClickInternalRef = useRef(null);

  // 로딩/새로고침 완료 콜백을 위한 ref (useFileManager 이전에 정의)
  const handleLoadCompleteRef = useRef(null);
  const handleRefreshCompleteRef = useRef(null);

  // useFileManager에 전달할 메모이제이션된 콜백
  const handleLoadCompleteCallback = useCallback(() => {
    if (isMobile && handleLoadCompleteRef.current) {
      handleLoadCompleteRef.current();
    }
  }, [isMobile]);

  // 최근 파일 경로 추적 훅
  const {
    recentFilePathsRef,
    pathHistoryRef,
    processingErrorRef,
    trackRecentFileClick,
    trackPathHistory,
    clearTracking,
    clearPathHistory,
  } = useRecentFileNavigation();
  
  const { message, showError, clearMessage } = useMessage();
  
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
  });
  
  // currentPathRef는 useFileManager 호출 후에 정의 (currentPath가 필요)
  const currentPathRef = useRef(null);
  
  // currentPathRef 업데이트
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);
  
  // 최근 파일 에러 처리 훅 (useFileManager 호출 후 정의)
  const handleRecentFileError = useRecentFileErrorHandler({
    recentFilePathsRef,
    pathHistoryRef,
    processingErrorRef,
    setCurrentPath,
    showError,
    user,
    currentPathRef,
  });
  
  // useFileManager의 onLoadError ref 업데이트
  useEffect(() => {
    onLoadErrorRef.current = handleRecentFileError;
  }, [handleRecentFileError, onLoadErrorRef]);

  const [viewMode, setViewMode] = useState(() => getViewMode());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);

  // 보기 모드 변경 시 저장
  useEffect(() => {
    saveViewMode(viewMode);
  }, [viewMode]);

  // 정렬 모드 변경 시 저장
  useEffect(() => {
    saveSortMode(sortMode);
  }, [sortMode]);

  // 파일 목록을 로컬 상태로 관리하여 썸네일 업데이트 가능하도록 함
  const [files, setFiles] = useState([]);
  
  // useFileManager의 files가 변경되면 로컬 상태 업데이트
  useEffect(() => {
    setFiles(filesFromHook);
  }, [filesFromHook]);

  // 검색 필터링된 파일 목록
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) {
      return files;
    }
    const query = searchQuery.toLowerCase().trim();
    return files.filter((file) => {
      const name = (file.basename || file.name || '').toLowerCase();
      return name.includes(query);
    });
  }, [files, searchQuery]);

  // 정렬된 파일 목록
  const sortedFiles = useMemo(() => {
    return sortFiles(filteredFiles, sortMode);
  }, [filteredFiles, sortMode]);

  // 무한 스크롤 훅 - 성능 최적화를 위해 초기 50개만 렌더링
  const { 
    displayedFiles, 
    loadMoreRef, 
    hasMore 
  } = useInfiniteScroll(sortedFiles, {
    initialCount: 50,
    incrementCount: 50,
  });

  // 썸네일 로드 완료 핸들러 - 변경된 파일만 업데이트하도록 최적화
  const handleThumbnailsLoaded = useCallback((thumbnailMap) => {
    setFiles(prevFiles => {
      // 실제로 변경이 필요한지 먼저 확인
      const hasChanges = Array.from(thumbnailMap.keys()).some(path => {
        const file = prevFiles.find(f => f.path === path);
        return file && !file.thumbnailUrl;
      });
      
      // 변경사항이 없으면 동일한 참조 반환 (재렌더링 방지)
      if (!hasChanges) return prevFiles;
      
      // 변경된 파일만 새 객체로 생성, 나머지는 동일 참조 유지
      return prevFiles.map(file => {
        const thumbnailUrl = thumbnailMap.get(file.path);
        if (thumbnailUrl && !file.thumbnailUrl) {
          return { ...file, thumbnailUrl };
        }
        return file; // 변경 없는 파일은 동일 참조 유지
      });
    });
  }, []);


  const {
    selectionMode,
    selectedFiles,
    handleToggleSelectionMode,
    handleSelectAll,
    handleDeselectAll,
    handleFileCheck,
    toggleFileSelection,
    setSelectionMode,
    setSelectedFiles,
  } = useSelection(displayedFiles, sortedFiles);

  // 모바일에서 Detail 모드로 전환 시도 시 List 모드로 자동 전환
  useEffect(() => {
    if (isMobile && viewMode === VIEW_MODES.DETAIL) {
      setViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, viewMode]);

  // 디렉토리 이동 시 선택 모드 해제
  useEffect(() => {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }, [currentPath, setSelectionMode, setSelectedFiles]);
  const {
    uploadDialogOpen, openUploadDialog, closeUploadDialog,
    createFolderDialogOpen, openCreateFolderDialog, closeCreateFolderDialog,
    previewDialogOpen, setPreviewDialogOpen, openPreviewDialog, closePreviewDialog,
    renameDialogOpen, openRenameDialog, closeRenameDialog,
    shareDialogOpen, openShareDialog, closeShareDialog,
    sharedFolderManageDialogOpen, openSharedFolderManageDialog, closeSharedFolderManageDialog,
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
    mobileSharedManageFile,
    mobilePropertiesFile,
    bulkDeleteFilePaths,
    mobilePickerFile, setMobilePickerFile,
    mobilePickerAction, setMobilePickerAction,
  } = useFileManagerDialogs();

  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  
  const [, setRecentFileToPreview] = useRecentFilePreview({
    files,
    loading,
    currentPath,
    setSelectedFile,
    setPreviewDialogOpen,
    handleRecentFileError,
    showError,
    clearTracking,
  });
  
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
  const [viewModeMenuAnchor, setViewModeMenuAnchor] = useState(null);
  const [processingMap, setProcessingMap] = useState(new Map());
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
  
  // FileActionSheet 관련 다이얼로그 상태
  const [renameLoading, setRenameLoading] = useState(false);
  
  // 모바일 새로고침/폴더 이동 완료 상태
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false);
  const refreshSuccessTimeoutRef = useRef(null);
  
  // 상수 정의
  const REFRESH_SUCCESS_DURATION = 500; // 체크 아이콘 표시 시간 (ms)
  const INDICATOR_BASE_HEIGHT = 60; // 기본 높이 (px)
  const MAX_PULL_MARGIN = 40; // 최대 당김 마진 (px)

  // Explorer drag and drop hook for the entire file content area
  const {
    isDraggingOver: isFileAreaDraggingOver,
    handleDragEnter: handleFileAreaDragEnter,
    handleDragOver: handleFileAreaDragOver,
    handleDragLeave: handleFileAreaDragLeave,
    handleDrop: handleFileAreaDrop,
  } = useExplorerDragAndDrop();

  // Pull-to-refresh hook (모바일에서만 활성화)
  const {
    pullDistance,
    isPulling,
    isRefreshing,
    threshold,
    resetPull,
  } = usePullToRefresh(
    loadFiles,
    {
      scrollContainerRef: isMobile ? scrollContainerRef : null,
      threshold: 240,
      maxPullDistance: 300,
      showRefreshSuccess: isMobile ? showRefreshSuccess : false,
      onRefreshComplete: isMobile ? (() => {
        if (handleRefreshCompleteRef.current) {
          handleRefreshCompleteRef.current();
        }
      }) : undefined,
    }
  );

  // 새로고침/로딩 완료 시 체크 아이콘 표시하는 공통 함수
  /**
   * @param {Object} options - 옵션
   * @param {boolean} options.shouldResetPull - resetPull 호출 여부 (기본: false)
   * @param {boolean} options.shouldCheckRefreshing - isRefreshing 체크 여부 (기본: false)
   */
  const showRefreshSuccessIndicator = useCallback((options = {}) => {
    const { shouldResetPull = false, shouldCheckRefreshing = false } = options;
    
    if (!isMobile) return;
    if (shouldCheckRefreshing && isRefreshing) return;
    
    // 이전 타임아웃이 있으면 클리어
    if (refreshSuccessTimeoutRef.current) {
      clearTimeout(refreshSuccessTimeoutRef.current);
    }
    
    // 즉시 체크 아이콘 표시 (동기적으로 설정하여 깜빡임 방지)
    setShowRefreshSuccess(true);
    
    // 지정된 시간 후 사라지도록
    refreshSuccessTimeoutRef.current = setTimeout(() => {
      setShowRefreshSuccess(false);
      if (shouldResetPull && resetPull) {
        resetPull();
      }
    }, REFRESH_SUCCESS_DURATION);
  }, [isMobile, isRefreshing, resetPull]);

  // 폴더 이동/로딩 완료 시 즉시 showRefreshSuccess를 true로 설정하는 콜백
  const handleLoadComplete = useCallback(() => {
    showRefreshSuccessIndicator({ shouldCheckRefreshing: true });
  }, [showRefreshSuccessIndicator]);

  // ref에 콜백 저장
  handleLoadCompleteRef.current = handleLoadComplete;

  // 새로고침 완료 시 즉시 showRefreshSuccess를 true로 설정하는 콜백
  const handleRefreshComplete = useCallback(() => {
    showRefreshSuccessIndicator({ shouldResetPull: true });
  }, [showRefreshSuccessIndicator]);

  // ref에 콜백 저장
  handleRefreshCompleteRef.current = handleRefreshComplete;



  // 진행률 계산 및 임계값 도달 여부
  const progress = Math.min(pullDistance / threshold, 1);
  const hasReachedThreshold = pullDistance >= threshold;

  // JSX 조건 변수 추출 (가독성 향상 및 중복 제거)
  const shouldShowIndicator = isPulling || isRefreshing || loading || showRefreshSuccess;
  const isActiveLoading = isRefreshing || loading || showRefreshSuccess;
  const isPullingOnly = isPulling && !isRefreshing && !loading && !showRefreshSuccess;
  const isDeterminateProgress = isPullingOnly;

  // 스타일 객체를 useMemo로 추출하여 중복 제거
  const indicatorStyles = useMemo(() => ({
    paddingTop: shouldShowIndicator ? '16px' : '0px',
    paddingBottom: shouldShowIndicator ? '16px' : '0px',
    marginTop: isActiveLoading 
      ? '0px' 
      : `${Math.max(-pullDistance * 0.5, -MAX_PULL_MARGIN)}px`,
    transition: isActiveLoading 
      ? 'margin-top 0.3s ease-out, min-height 0.3s ease-out, opacity 0.3s ease-out' 
      : isPulling
      ? 'none' // 당기는 중에는 transition 없이 즉시 반응
      : 'margin-top 0.15s ease-out, min-height 0.15s ease-out, opacity 0.15s ease-out',
    opacity: shouldShowIndicator 
      ? (isActiveLoading ? 1 : Math.min(pullDistance / threshold, 1))
      : 0,
    minHeight: shouldShowIndicator
      ? (isPullingOnly ? `${INDICATOR_BASE_HEIGHT + pullDistance}px` : `${INDICATOR_BASE_HEIGHT}px`)
      : 0,
    height: shouldShowIndicator 
      ? (isPullingOnly ? `${INDICATOR_BASE_HEIGHT + pullDistance}px` : 'auto')
      : 0,
    overflow: 'hidden',
  }), [shouldShowIndicator, isActiveLoading, isPullingOnly, isPulling, pullDistance, threshold]);

  // 아이콘 스타일
  const iconStyles = useMemo(() => ({
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    mb: 1,
    transform: isPullingOnly ? `rotate(${pullDistance * 2}deg)` : 'none',
    transition: 'transform 0.1s ease-out, color 0.2s ease',
  }), [isPullingOnly, pullDistance]);

  // CircularProgress 색상 계산
  const progressColor = useMemo(() => {
    if (hasReachedThreshold && isPullingOnly) {
      return 'primary.main';
    }
    if (isPullingOnly) {
      return 'text.disabled';
    }
    return 'primary.main';
  }, [hasReachedThreshold, isPullingOnly]);

  // 텍스트 색상 계산
  const textColor = useMemo(() => {
    if (showRefreshSuccess) {
      return 'success.main';
    }
    if (hasReachedThreshold && isPullingOnly) {
      return 'primary.main';
    }
    return 'text.secondary';
  }, [showRefreshSuccess, hasReachedThreshold, isPullingOnly]);

  // 텍스트 내용 계산
  const textContent = useMemo(() => {
    if (showRefreshSuccess) {
      return '완료';
    }
    if (isRefreshing || loading) {
      return '로딩 중...';
    }
    if (hasReachedThreshold) {
      return '놓으면 새로고침';
    }
    return '당겨서 새로고침';
  }, [showRefreshSuccess, isRefreshing, loading, hasReachedThreshold]);


  // Processing map updater
  const { markProcessing, clearProcessing } = createProcessingUpdater(setProcessingMap);

  const {
    folderPickerOpen,
    folderPickerAction,
    progressItems,
    updateProgress,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDelete,
    handleBulkDownload,
    handleFolderPickerSelect,
    handleRetry,
    handleCancelBulkOperation,
    dismissFailedItems,
    setFolderPickerOpen,
    setFolderPickerAction,
    bulkConflictData,
    resolveBulkConflict,
    setBulkConflictData,
  } = useBulkOperations(
    selectedFiles,
    sortedFiles,
    handleOperationComplete,
    setTreeUpdateTrigger,
    setDropMessage,
    setSelectedFiles,
    setSelectionMode,
    () => currentPathRef.current,
    { markProcessing, clearProcessing }
  );

  const bulkMoveCopyInProgress = useMemo(() => {
    if (folderPickerOpen && (folderPickerAction === 'move' || folderPickerAction === 'copy')) return true;
    if (bulkConflictData != null) return true;
    const hasActiveBulkMoveCopy = progressItems.some(
      (item) => (item.type === 'move' || item.type === 'copy') && (item.status === 'preparing' || item.status === 'processing')
    );
    return !!hasActiveBulkMoveCopy;
  }, [folderPickerOpen, folderPickerAction, bulkConflictData, progressItems]);

  // File upload hook
  const {
    handleRetryUpload: handleRetryUploadHook,
    handleCancelUploadFile,
    handleCancelAllUpload,
  } = useFileUpload({
    updateProgress,
    onOperationComplete: handleOperationComplete,
    dismissFailedItems,
  });

  // File operations hook for mobile actions
  const {
    handleFileDownload: handleFileDownloadOp,
    handleFileRename: handleFileRenameOp,
  } = useFileOperations({
    onProgress: updateProgress,
    setProcessingMap,
    onActionComplete: handleOperationComplete,
    onClose: () => {
      setActionSheetOpen(false);
      setActionSheetFile(null);
    },
    onConflictResolveStart: () => {
      setSelectionMode(false);
      setSelectedFiles(new Set());
    },
  });

  const [uploadConflictData, setUploadConflictData] = useState(null);
  const explorerUploadAbortControllersRef = useRef(new Map());
  const explorerUploadCancelledRef = useRef(new Map());
  const explorerUploadCancelAllRequestedRef = useRef(new Set());

  const executeExplorerUpload = useCallback(async (filesToUpload, targetPath, onConflict = 'error') => {
    // Use currentPath if targetPath is null
    const uploadPath = targetPath || currentPath;
    
    if (!filesToUpload || filesToUpload.length === 0) return;

    dismissFailedItems();

    const progressId = `upload_drop_${Date.now()}`;
    explorerUploadAbortControllersRef.current.set(progressId, new Map());
    explorerUploadCancelledRef.current.set(progressId, new Set());

    const fileItems = filesToUpload.map(({ file, relativePath }) => ({
      fileName: relativePath || file?.name || 'unknown',
      status: 'pending',
      error: undefined,
    }));

    const baseProgress = {
      id: progressId,
      type: 'upload',
      progress: 0,
      total: filesToUpload.length,
      current: '',
      name: `${filesToUpload.length}개 파일 업로드`,
      fileItems: [...fileItems],
      cancellable: true,
    };

    // Check permissions
    if (!hasWritePermission && !user?.is_admin) {
      updateProgress({
        ...baseProgress,
        status: 'error',
        error: '업로드 권한이 없습니다',
        keepOnError: true,
      });
      return;
    }

    updateProgress({
      ...baseProgress,
      status: 'preparing',
      current: '준비 중...',
    });

    const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
    const abortControllers = explorerUploadAbortControllersRef.current.get(progressId);
    const getSignalForFile = (fileName) => {
      if (cancelledSet?.has(fileName)) {
        const ac = new AbortController();
        ac.abort();
        return ac.signal;
      }
      const controller = new AbortController();
      abortControllers?.set(fileName, controller);
      return controller.signal;
    };

    try {
      const { results, errors } = await uploadMultipleFiles(
        filesToUpload,
        uploadPath,
        (progress) => {
          const fileName = progress.currentFile;
          const idx = fileItems.findIndex((it) => it.fileName === fileName);
          if (idx !== -1) {
            const status =
              progress.status === 'uploading'
                ? 'uploading'
                : progress.status === 'success'
                  ? 'completed'
                  : progress.status === 'skipped'
                    ? 'skipped'
                    : progress.status === 'error'
                      ? 'error'
                      : progress.status === 'cancelled'
                        ? 'cancelled'
                        : 'pending';
            fileItems[idx] = {
              ...fileItems[idx],
              status,
              error: progress.status === 'error' ? progress.error : undefined,
            };
          }

          const completedCount = fileItems.filter((it) => it.status === 'completed').length;
          const skippedCount = fileItems.filter((it) => it.status === 'skipped').length;
          const failCount = fileItems.filter((it) => it.status === 'error').length;

          updateProgress({
            ...baseProgress,
            status: 'processing',
            progress: completedCount + skippedCount,
            total: progress.total,
            current: `(${progress.current}/${progress.total}) ${progress.currentFile}`,
            error: failCount > 0 ? `${failCount}개 실패` : undefined,
            keepOnError: failCount > 0 || skippedCount > 0 || undefined,
            fileItems: [...fileItems],
          });
        },
        onConflict,
        { getSignalForFile }
      );

      const completedCount = fileItems.filter((it) => it.status === 'completed').length;
      const skippedCount = fileItems.filter((it) => it.status === 'skipped').length;
      const failCount = fileItems.filter((it) => it.status === 'error').length;
      const failedItems = (errors || []).map((e) => ({
        fileName: e.relativePath || e.file?.name || 'unknown',
        error: e.error,
      }));

      if (explorerUploadCancelAllRequestedRef.current.has(progressId)) {
        return;
      }

      if (failCount > 0) {
        updateProgress({
          ...baseProgress,
          status: 'error',
          progress: completedCount + skippedCount,
          total: filesToUpload.length,
          current: '완료 (일부 실패)',
          error: `${failCount}개 파일 업로드 실패`,
          keepOnError: true,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
          fileItems: [...fileItems],
        });
      } else if (skippedCount > 0) {
        updateProgress({
          ...baseProgress,
          status: 'warning',
          progress: completedCount + skippedCount,
          total: filesToUpload.length,
          current: '완료',
          error: `건너뛴 항목: ${skippedCount}개`,
          keepOnError: true,
          fileItems: [...fileItems],
        });
      } else {
        updateProgress({
          ...baseProgress,
          status: 'completed',
          progress: filesToUpload.length,
          total: filesToUpload.length,
          current: '완료',
          fileItems: [...fileItems],
        });
        setTimeout(() => {
          updateProgress({ id: progressId, remove: true });
        }, 3000);
      }

      // Refresh file list and tree
      if (Array.isArray(results) && results.length > 0) {
        handleOperationComplete({ opType: 'upload', startedPath: uploadPath });
        setTreeUpdateTrigger({
          type: 'refresh',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMessage = error.response?.data?.error || error.message || '업로드에 실패했습니다';
      if (error.response?.status === 403) {
        errorMessage = '업로드 권한이 없습니다';
      } else if (error.response?.status === 500) {
        errorMessage = `서버 오류: ${errorMessage}`;
      }
      
      updateProgress({
        ...baseProgress,
        status: 'error',
        error: errorMessage,
        keepOnError: true,
        fileItems: [...fileItems],
      });
    } finally {
      explorerUploadAbortControllersRef.current.delete(progressId);
      explorerUploadCancelledRef.current.delete(progressId);
      explorerUploadCancelAllRequestedRef.current.delete(progressId);
    }
  }, [currentPath, dismissFailedItems, hasWritePermission, user, updateProgress, handleOperationComplete]);

  /**
   * Resolve upload conflicts
   */
  const resolveUploadConflict = useCallback(async (resolution) => {
    if (!uploadConflictData) return;
    
    const { filesToUpload, targetPath } = uploadConflictData;
    setUploadConflictData(null);
    
    if (filesToUpload.length > 0) {
      await executeExplorerUpload(filesToUpload, targetPath, resolution);
    }
  }, [uploadConflictData, executeExplorerUpload]);

  const handleBulkDeleteConfirm = () => {
    const filePaths = [...bulkDeleteFilePaths];
    closeBulkDeleteDialog();
    // 선택모드 해제
    setSelectedFiles(new Set());
    setSelectionMode(false);
    // 삭제 실행 (retryData로 전달하여 확인 단계 건너뛰기)
    handleBulkDelete({ filePaths }, null);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePathClick = async (path) => {
    // 특수 경로는 바로 설정 (권한 체크 불필요)
    if (path === '/__shared__' || path === '/__recent__') {
      setCurrentPath(path);
      return;
    }
    
    // 이전 경로 저장 (롤백용)
    const previousPath = currentPathRef.current;
    
    // 경로 정규화
    const normalizedPath = normalizePath(path);
    
    // 경로 히스토리에 저장 (에러 발생 시 롤백용) - setCurrentPath 전에 저장!
    trackPathHistory(normalizedPath, previousPath);
    trackPathHistory(path, previousPath);
    
    // Optimistic update: 경로 즉시 변경
    setCurrentPath(path);
    
    // 권한 체크는 백그라운드에서 수행
    if (!user?.is_admin) {
      try {
        const permission = await checkPermission(path);
        if (!permission.hasRead) {
          // 권한 없음: 이전 경로로 롤백
          setCurrentPath(previousPath);
          const permissionError = new Error('Permission denied');
          permissionError.response = { status: 403 };
          throw permissionError;
        }
      } catch (error) {
        // 에러 발생: 이전 경로로 롤백
        setCurrentPath(previousPath);
        // 에러를 다시 throw하여 호출자가 처리할 수 있도록 함
        throw error;
      }
    }
  };

  // 실제 파일 클릭 처리 함수
  const handleFileClickInternal = async (file) => {
    if (selectionMode) {
      toggleFileSelection(file);
    } else {
      if (file.type === 'directory') {
        // 최근 파일에서 클릭한 경우
        if (file.isRecentFile) {
          const filePath = file.path;
          
          // 경로 유효성 검사
          if (!filePath || filePath === '/' || filePath.trim() === '') {
            handleRecentFileError(
              { message: 'Invalid path' },
              filePath
            );
            return;
          }
          
          // 폴더로 직접 이동 시도
          // 최근 파일 경로 추적에 추가 (handlePathClick 전에 설정)
          trackRecentFileClick(filePath);
          
          try {
            await handlePathClick(filePath);
            // handlePathClick이 성공하면 loadFiles가 호출되고,
            // 에러가 발생하면 onLoadError에서 처리됨
            // 따라서 여기서는 에러를 잡지 않음
          } catch (error) {
            // handlePathClick에서 권한 체크 실패 등으로 즉시 에러 발생한 경우
            clearTracking(filePath);
            // 404 에러일 때만 최근 파일 제거
            if (error.response?.status === 404) {
              handleRecentFileError(error, filePath);
            } else {
              // 404가 아닌 에러는 최근 파일을 제거하지 않고 에러 메시지만 표시
              const errorType = determineErrorType(error);
              const errorMessage = getErrorMessageByType(errorType);
              showError(errorMessage);
            }
          }
          return;
        }
        
        // 권한이 없는 폴더는 클릭 불가 (이미 표시된 정보 활용)
        if (file.hasReadPermission === false) {
          showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
          return;
        }
        
        // 이전 경로 저장
        const previousPath = currentPathRef.current;
        
        // Optimistic update: 경로 즉시 변경
        setCurrentPath(file.path);
        
        // 최근 파일에 추가 (파일만 추가, 폴더는 제외)
        if (file.type !== 'directory') {
          await addRecentFile(file);
          // 이벤트 리스너가 자동으로 loadFiles() 호출
        }
        
        // 권한 체크는 백그라운드에서 수행 (서버 측 확인)
        if (!user?.is_admin) {
          try {
            const permission = await checkPermission(file.path);
            if (!permission.hasRead) {
              // 권한 없음: 롤백
              setCurrentPath(previousPath);
              showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
              return;
            }
          } catch (error) {
            // 에러 발생: 롤백
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
        // 최근 파일에서 클릭한 경우 부모 폴더로 이동하고 미리보기 표시
        if (file.isRecentFile) {
          const filePath = normalizePath(file.path);
          const fileName = file.basename || file.name;
          
          // 경로 유효성 검사
          if (!filePath || filePath === '/' || filePath.trim() === '') {
            handleRecentFileError(
              { message: 'Invalid path' },
              filePath
            );
            return;
          }
          
          // 부모 경로 계산 (정규화된 경로 사용)
          const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
          const normalizedParentPath = normalizePath(parentPath);
          
          // 부모 폴더 권한 확인 및 이동
          try {
            // 최근 파일 경로 추적에 추가 (부모 경로 -> 파일 경로 매핑)
            trackRecentFileClick(filePath, normalizedParentPath);
            // 부모 폴더로 이동 시도
            await handlePathClick(normalizedParentPath);
            
            // 파일 정보를 저장하여 useEffect에서 처리
            setRecentFileToPreview({
              filePath,
              fileName,
              parentPath: normalizedParentPath,
              originalFile: file,
            });
          } catch (error) {
            // 부모 폴더 접근 실패 시 에러 처리
            clearTracking(normalizedParentPath);
            // 404 에러일 때만 최근 파일 제거
            if (error.response?.status === 404) {
              handleRecentFileError(error, filePath);
            } else {
              // 404가 아닌 에러는 최근 파일을 제거하지 않고 에러 메시지만 표시
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
        // 최근 파일에 추가
        await addRecentFile(file);
        // 이벤트 리스너가 자동으로 loadFiles() 호출
      }
    }
  };

  // ref 업데이트 - 항상 최신 함수를 가리키도록
  useEffect(() => {
    handleFileClickInternalRef.current = handleFileClickInternal;
  });

  // 디바운스된 파일 클릭 핸들러 (200ms)
  const handleFileClick = useCallback((file) => {
    // 선택 모드에서는 즉시 실행 (디바운스 없음)
    if (selectionMode) {
      handleFileClickInternalRef.current(file);
      return;
    }
    
    // 기존 타이머 취소
    if (fileClickDebounceTimer.current) {
      clearTimeout(fileClickDebounceTimer.current);
    }
    
    // 새 타이머 설정
    fileClickDebounceTimer.current = setTimeout(() => {
      handleFileClickInternalRef.current(file);
    }, 200);
  }, [selectionMode]);
  
  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (fileClickDebounceTimer.current) {
        clearTimeout(fileClickDebounceTimer.current);
      }
    };
  }, []);


  // Upload handlers - useFileUpload hook handles this
  const handleUploadStart = useCallback(async (files, uploadPath) => {
    closeUploadDialog();

    if (!files || files.length === 0) return;

    const filesToUpload = files.map(f => ({ file: f, relativePath: f.webkitRelativePath || f.name }));

    const operations = filesToUpload.map(({ file, relativePath }) => {
      const fileName = relativePath || file.name;
      const destinationPath = uploadPath === '/' ? `/${fileName}` : `${uploadPath}/${fileName}`;
      return { sourcePath: fileName, destinationPath, type: 'upload' };
    });

    const progressId = `upload_check_${Date.now()}`;
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: 0,
      total: filesToUpload.length,
      current: '충돌 확인 중...',
      name: `${filesToUpload.length}개 파일 업로드`,
    });

    try {
      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        updateProgress({ id: progressId, remove: true });
        setUploadConflictData({ filesToUpload, targetPath: uploadPath, conflicts });
        return;
      }

      updateProgress({ id: progressId, remove: true });
      await executeExplorerUpload(filesToUpload, uploadPath);
    } catch (error) {
      console.error('Upload conflict check failed:', error);
      updateProgress({ id: progressId, remove: true });
      await executeExplorerUpload(filesToUpload, uploadPath);
    }
  }, [executeExplorerUpload, closeUploadDialog, updateProgress]);

  // Cancel upload handlers - wrap to pass progressItems
  const handleCancelUploadFileWrapper = useCallback((progressId, fileName) => {
    if (progressId.startsWith('upload_drop_')) {
      const controllers = explorerUploadAbortControllersRef.current.get(progressId);
      const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
      controllers?.get(fileName)?.abort();
      cancelledSet?.add(fileName);
      const progressItem = progressItems.find((item) => item.id === progressId);
      if (progressItem?.fileItems) {
        const updatedFileItems = progressItem.fileItems.map((item) =>
          item.fileName === fileName ? { ...item, status: 'cancelled' } : item
        );
        updateProgress({ id: progressId, fileItems: updatedFileItems });
      }
      return;
    }
    handleCancelUploadFile(progressId, fileName, progressItems);
  }, [handleCancelUploadFile, progressItems, updateProgress]);

  const handleCancelAllUploadWrapper = useCallback((progressId) => {
    if (progressId.startsWith('upload_drop_')) {
      explorerUploadCancelAllRequestedRef.current.add(progressId);
      const controllers = explorerUploadAbortControllersRef.current.get(progressId);
      controllers?.forEach((ac) => ac.abort());
      const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
      const progressItem = progressItems.find((item) => item.id === progressId);
      if (progressItem?.fileItems && cancelledSet) {
        progressItem.fileItems.forEach((item) => {
          if (item.status === 'pending' || item.status === 'uploading') {
            cancelledSet.add(item.fileName);
          }
        });
        const updatedFileItems = progressItem.fileItems.map((item) =>
          item.status === 'pending' || item.status === 'uploading'
            ? { ...item, status: 'cancelled' }
            : item
        );
        updateProgress({
          id: progressId,
          fileItems: updatedFileItems,
          status: 'error',
          error: '업로드가 취소되었습니다.',
        });
        setTimeout(() => {
          updateProgress({ id: progressId, remove: true });
          explorerUploadAbortControllersRef.current.delete(progressId);
          explorerUploadCancelledRef.current.delete(progressId);
          explorerUploadCancelAllRequestedRef.current.delete(progressId);
        }, 3000);
      }
      return;
    }
    handleCancelAllUpload(progressId, progressItems);
  }, [handleCancelAllUpload, progressItems, updateProgress]);

  const handleCancelAllWrapper = useCallback((progressId) => {
    const item = progressItems.find((i) => i.id === progressId);
    if (!item) return;
    if (item.type === 'upload') {
      handleCancelAllUploadWrapper(progressId);
    } else if ((item.type === 'delete' || item.type === 'move' || item.type === 'copy') && item.jobId) {
      handleCancelBulkOperation(progressId);
    }
  }, [progressItems, handleCancelAllUploadWrapper, handleCancelBulkOperation]);

  // 업로드 재시도 (실패한 파일만 재시도)
  const handleRetryUpload = useCallback(async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    if (!progressItem || !progressItem.retryData || progressItem.retryData.type !== 'upload') {
      if (handleRetry) {
        return handleRetry(progressId);
      }
      return;
    }

    await handleRetryUploadHook(progressId, progressItem.retryData, progressItem.fileItems);
  }, [progressItems, handleRetry, handleRetryUploadHook]);

  const handleCreateFolderComplete = (folderPath, folderName) => {
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
  };

  // FileActionSheet 핸들러 함수들
  const handleRename = async () => {
    const targetFile = mobileRenameFile || actionSheetFile;
    if (!targetFile || !renameNewName.trim()) {
      setRenameError('이름을 입력하세요');
      return;
    }

    setRenameLoading(true);
    try {
      setRenameError('');
      await handleFileRenameOp(targetFile, renameNewName, { startedPath: currentPathRef.current });
      closeRenameDialog();
      closeActionSheet();
    } finally {
      setRenameLoading(false);
    }
  };

  const handleActionSheetDownload = async () => {
    if (!actionSheetFile) return;
    try {
      await handleFileDownloadOp(actionSheetFile);
      closeActionSheet();
    } catch (error) {
      // Error is already handled by useFileOperations
    }
  };

  const handleFileDrop = async (draggedFile, targetFolder) => {
    if (draggedFile.path === targetFolder.path) return;
    try {
      await handleFolderPickerSelect(targetFolder.path, { type: 'move', filePaths: [draggedFile.path] });
    } catch (error) {
      // Error is already handled by useBulkOperations
    }
  };

  const handleExplorerDrop = useCallback(async (filesToUpload, targetPath) => {
    const uploadPath = targetPath || currentPath;

    if (!filesToUpload || filesToUpload.length === 0) return;

    const operations = filesToUpload.map(({ file, relativePath }) => {
      const fileName = relativePath || file.name;
      const destinationPath = uploadPath === '/' ? `/${fileName}` : `${uploadPath}/${fileName}`;
      return { sourcePath: fileName, destinationPath, type: 'upload' };
    });

    const progressId = `upload_check_${Date.now()}`;
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: 0,
      total: filesToUpload.length,
      current: '충돌 확인 중...',
      name: `${filesToUpload.length}개 파일 업로드`,
    });

    try {
      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        updateProgress({ id: progressId, remove: true });
        setUploadConflictData({ filesToUpload, targetPath, conflicts });
        return;
      }

      updateProgress({ id: progressId, remove: true });
      await executeExplorerUpload(filesToUpload, targetPath);
    } catch (error) {
      console.error('Upload conflict check failed:', error);
      updateProgress({ id: progressId, remove: true });
      await executeExplorerUpload(filesToUpload, targetPath);
    }
  }, [currentPath, updateProgress, executeExplorerUpload]);

  // Handle drops on the entire file content area
  const handleContentAreaDragOver = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragOver(e);
    }
  };

  const handleContentAreaDragEnter = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragEnter(e);
    }
  };

  const handleContentAreaDragLeave = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragLeave(e);
    }
  };

  const handleContentAreaDrop = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDrop(e, currentPath, handleExplorerDrop);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-height)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <FileManagerHeader
        isMobile={isMobile}
        isSearchMode={isSearchMode}
        setIsSearchMode={setIsSearchMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        user={user}
        navigate={navigate}
        handleLogout={handleLogout}
      />


      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {!isMobile && (
          <FolderTree
            currentPath={currentPath}
            onPathClick={handlePathClick}
            onFileClick={handleFileClick}
            user={user}
            treeUpdateTrigger={treeUpdateTrigger}
            onCreateFolder={openCreateFolderDialog}
            onUploadFile={openUploadDialog}
            selectionMode={selectionMode}
            hasWritePermission={hasWritePermission}
            onExplorerDrop={handleExplorerDrop}
            isMobile={isMobile}
          />
        )}

        <Box 
          ref={fileContentRef}
          sx={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            position: 'relative',
          }}
          onDragEnter={handleContentAreaDragEnter}
          onDragOver={handleContentAreaDragOver}
          onDragLeave={handleContentAreaDragLeave}
          onDrop={handleContentAreaDrop}
        >
          {isFileAreaDraggingOver && hasWritePermission && (
            <Box
              sx={{
                position: 'absolute',
                top: 10,
                left: 10,
                right: 10,
                bottom: 10,
                border: '3px dashed',
                borderColor: 'primary.main',
                borderRadius: '10px',
                pointerEvents: 'none',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="h5"
                sx={{
                  color: 'primary.main',
                  fontWeight: 600,
                  textAlign: 'center',
                  px: 3,
                }}
              >
                파일을 여기에 놓으세요
              </Typography>
            </Box>
          )}

          {isMobile && (
            <>
              <MobileBreadcrumb
                currentPath={currentPath}
                onPathClick={handlePathClick}
                user={user}
                onToggleFolderTree={() => setDrawerOpen(!drawerOpen)}
                isFolderTreeOpen={drawerOpen}
              />
              <Collapse in={drawerOpen} timeout="auto">
                <Box
                  sx={{
                    maxHeight: '50vh',
                    overflow: 'auto',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    backgroundColor: 'background.paper',
                  }}
                >
                  <FolderTree
                    currentPath={currentPath}
                    onPathClick={(path) => {
                      handlePathClick(path);
                      setDrawerOpen(false);
                    }}
                    onFileClick={(file) => {
                      handleFileClick(file);
                      setDrawerOpen(false);
                    }}
                    user={user}
                    treeUpdateTrigger={treeUpdateTrigger}
                    onCreateFolder={() => {
                      openCreateFolderDialog();
                      setDrawerOpen(false);
                    }}
                    onUploadFile={() => {
                      openUploadDialog();
                      setDrawerOpen(false);
                    }}
                    selectionMode={selectionMode}
                    hasWritePermission={hasWritePermission}
                    onExplorerDrop={handleExplorerDrop}
                    isMobile={isMobile}
                  />
                </Box>
              </Collapse>
            </>
          )}

          <FileManagerControls
            isMobile={isMobile}
            selectionMode={selectionMode}
            handleToggleSelectionMode={handleToggleSelectionMode}
            handleSelectAll={handleSelectAll}
            handleDeselectAll={handleDeselectAll}
            selectedFiles={selectedFiles}
            setSortMenuAnchor={setSortMenuAnchor}
            sortMenuAnchor={sortMenuAnchor}
            sortMode={sortMode}
            setSortMode={setSortMode}
            saveSortMode={saveSortMode}
            setViewModeMenuAnchor={setViewModeMenuAnchor}
            viewModeMenuAnchor={viewModeMenuAnchor}
            viewMode={viewMode}
            setViewMode={setViewMode}
            saveViewMode={saveViewMode}
            selectionActionsDisabled={bulkMoveCopyInProgress}
          />

          {/* 뒤로가기 버튼 (데스크톱 전용) */}
          {!isMobile && (() => {
            const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
            
            // 1. 일반 사용자: 홈 디렉토리에서는 클릭 불가 (홈 아이콘 + "홈" 텍스트)
            if (!user?.is_admin && currentPath === homePath) {
              return (
                <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                  <Button
                    startIcon={<HomeIcon />}
                    disabled
                    sx={{
                      textTransform: 'none',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                      '&.Mui-disabled': {
                        color: 'text.primary',
                      },
                    }}
                  >
                    홈
                  </Button>
                </Box>
              );
            }
            
            // 2. 어드민: 루트 디렉토리에서는 클릭 불가 (홈 아이콘 + "홈" 텍스트)
            if (user?.is_admin && currentPath === '/') {
              return (
                <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                  <Button
                    startIcon={<HomeIcon />}
                    disabled
                    sx={{
                      textTransform: 'none',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                      '&.Mui-disabled': {
                        color: 'text.primary',
                      },
                    }}
                  >
                    홈
                  </Button>
                </Box>
              );
            }
            
            // 3. 일반 사용자: 공유됨 디렉토리에서는 클릭 불가 (공유됨 아이콘 + "공유됨" 텍스트)
            if (!user?.is_admin && currentPath === '/__shared__') {
              return (
                <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                  <Button
                    startIcon={<ShareIcon />}
                    disabled
                    sx={{
                      textTransform: 'none',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                      '&.Mui-disabled': {
                        color: 'text.primary',
                      },
                    }}
                  >
                    공유됨
                  </Button>
                </Box>
              );
            }
            
            // 4. 최근항목 디렉토리에서는 클릭 불가 (최근항목 아이콘 + "최근항목" 텍스트)
            if (currentPath === '/__recent__') {
              return (
                <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                  <Button
                    startIcon={<AccessTimeIcon />}
                    disabled
                    sx={{
                      textTransform: 'none',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                      '&.Mui-disabled': {
                        color: 'text.primary',
                      },
                    }}
                  >
                    최근항목
                  </Button>
                </Box>
              );
            }
            
            // 5. 일반 경로에서 부모 경로 계산
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
            
            if (!parentPath || parentPath === currentPath) return null;
            
            // 6. 일반 사용자: 공유된 폴더에서 상위폴더가 권한 없는 경우
            if (!user?.is_admin && parentPath !== '/' && !parentPath.startsWith(homePath)) {
              return (
                <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                  <Button
                    startIcon={<ChevronLeftIcon />}
                    onClick={() => {
                      setCurrentPath('/__shared__');
                    }}
                    sx={{
                      textTransform: 'none',
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                    }}
                  >
                    공유됨
                  </Button>
                </Box>
              );
            }
            
            // 7. 일반적인 뒤로가기 버튼
            const parentName = parentPath === '/'
              ? (user?.is_admin ? '루트' : '홈')
              : parentPath.substring(parentPath.lastIndexOf('/') + 1) || (user?.is_admin ? '루트' : '홈');
            
            return (
              <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
                <Button
                  startIcon={<ChevronLeftIcon />}
                  onClick={async () => {
                    // 일반 경로에서 부모 폴더로 이동
                    const previousPath = currentPathRef.current;
                    setCurrentPath(parentPath);
                    
                    // 권한 체크 (일반 사용자만)
                    if (!user?.is_admin) {
                      try {
                        const permission = await checkPermission(parentPath);
                        if (!permission.hasRead) {
                          // 공유 폴더에서 상위 폴더 권한이 없으면 /__shared__로 이동
                          const userBaseFolder = `/${user?.username || ''}`;
                          if (!parentPath.startsWith(userBaseFolder)) {
                            setCurrentPath('/__shared__');
                            return;
                          }
                          // 자신의 폴더인데 권한이 없으면 이전 경로로 롤백
                          setCurrentPath(previousPath);
                          showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
                          return;
                        }
                      } catch (error) {
                        setCurrentPath(previousPath);
                        const errorType = determineErrorType(error);
                        if (errorType === ERROR_TYPES.PERMISSION_DENIED) {
                          const userBaseFolder = `/${user?.username || ''}`;
                          if (!parentPath.startsWith(userBaseFolder)) {
                            setCurrentPath('/__shared__');
                            return;
                          }
                          showError(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED));
                        } else {
                          console.error('Failed to check permission:', error);
                          showError(getErrorMessage(error, '권한 확인 중 오류가 발생했습니다.'));
                        }
                        return;
                      }
                    }
                  }}
                  sx={{
                    textTransform: 'none',
                    color: 'text.primary',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  {parentName}
                </Button>
              </Box>
            );
          })()}

          <Box
            ref={scrollContainerRef}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 2,
              minHeight: 0,
              position: 'relative',
              // Avoid being hidden behind the fixed bottom selection action bar on mobile
              pb: selectionMode && isMobile ? 'calc(88px + env(safe-area-inset-bottom))' : 2,
              // Enable smooth scrolling and bounce effect on iOS
              WebkitOverflowScrolling: 'touch',
              // Optional: contain bounce within this scroll area
              overscrollBehaviorY: 'contain',
              // touch-action: 수직 스크롤만 허용하여 pull-to-refresh와 충돌 방지
              touchAction: 'pan-y',
            }}
          >
            {/* Pull-to-refresh 시각적 피드백 - 실제 콘텐츠 영역에 포함 */}
            {isMobile && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...indicatorStyles,
                }}
              >
                  <Box sx={iconStyles}>
                    {showRefreshSuccess ? (
                      <CheckCircleIcon
                        sx={{
                          color: 'success.main',
                          fontSize: 24,
                          width: 24,
                          height: 24,
                        }}
                      />
                    ) : (
                      <CircularProgress
                        size={24}
                        thickness={4}
                        value={isDeterminateProgress ? progress * 100 : undefined}
                        variant={isDeterminateProgress ? 'determinate' : 'indeterminate'}
                        sx={{
                          color: progressColor,
                          transition: 'color 0.2s ease',
                        }}
                      />
                    )}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      color: textColor,
                      fontSize: '0.75rem',
                      lineHeight: '1.2rem',
                      height: '1.2rem',
                      display: 'flex',
                      alignItems: 'center',
                      visibility: shouldShowIndicator ? 'visible' : 'hidden',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {textContent}
                  </Typography>
              </Box>
            )}
            {viewMode === VIEW_MODES.LIST ? (
              <FileList
                files={displayedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
                onThumbnailsLoaded={handleThumbnailsLoaded}
                loadMoreRef={loadMoreRef}
                hasMore={hasMore}
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={displayedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
                onThumbnailsLoaded={handleThumbnailsLoaded}
                loadMoreRef={loadMoreRef}
                hasMore={hasMore}
              />
            ) : (
              <FileDetail
                files={displayedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
              />
            )}
          </Box>
        </Box>
      </Box>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={closeUploadDialog}
        currentPath={currentPath}
        onUploadStart={handleUploadStart}
      />

      <CreateFolderDialog
        open={createFolderDialogOpen}
        onClose={closeCreateFolderDialog}
        onComplete={handleCreateFolderComplete}
        currentPath={currentPath}
        onProgress={updateProgress}
      />

      <FilePreviewDialog
        open={previewDialogOpen}
        onClose={() => {
          closePreviewDialog();
          setSelectedFile(null);
        }}
        file={selectedFile}
      />

      <FileContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        file={selectedFile}
        user={user}
        hasWritePermission={hasWritePermission}
        onDownload={(file) => {
          setContextMenu(null);
          handleFileDownloadOp(file);
        }}
        onRename={(file) => {
          setContextMenu(null);
          openRenameDialog(file);
        }}
        onMove={(file) => {
          setContextMenu(null);
          setMobilePickerFile(file);
          setMobilePickerAction('move');
          setFolderPickerAction('move');
          setFolderPickerOpen(true);
        }}
        onCopy={(file) => {
          setContextMenu(null);
          setMobilePickerFile(file);
          setMobilePickerAction('copy');
          setFolderPickerAction('copy');
          setFolderPickerOpen(true);
        }}
        onShare={(file) => {
          setContextMenu(null);
          openShareDialog(file);
        }}
        onManageShared={(file) => {
          setContextMenu(null);
          openSharedFolderManageDialog(file);
        }}
        onDelete={(file) => {
          setContextMenu(null);
          openBulkDeleteDialog([file.path]);
        }}
      />

      <FolderPickerDialog
        open={folderPickerOpen}
        onClose={() => {
          setFolderPickerOpen(false);
          setFolderPickerAction(null);
          // 모바일용 상태도 초기화
          if (mobilePickerFile) {
            setMobilePickerFile(null);
            setMobilePickerAction(null);
          }
        }}
        onSelect={(selectedPath) => {
          const sourceFilePath = mobilePickerFile ? mobilePickerFile.path : (actionSheetFile ? actionSheetFile.path : undefined);
          const filePaths = sourceFilePath ? [sourceFilePath] : Array.from(selectedFiles);
          if (filePaths.length > 0 && folderPickerAction) {
            handleFolderPickerSelect(selectedPath, { type: folderPickerAction, filePaths });
          }
        }}
        title={
          mobilePickerFile
            ? `${mobilePickerAction === 'move' ? '이동' : '복사'}: ${mobilePickerFile.basename}`
            : folderPickerAction === 'move' ? '이동할 폴더 선택' : '복사할 폴더 선택'
        }
        currentPath={currentPath}
        user={user}
        action={folderPickerAction}
        sourceFilePath={mobilePickerFile ? mobilePickerFile.path : (actionSheetFile ? actionSheetFile.path : undefined)}
        sourceFilePaths={
          !mobilePickerFile && !actionSheetFile && (folderPickerAction === 'copy' || folderPickerAction === 'move') ? Array.from(selectedFiles) : undefined
        }
      />

      <Snackbar
        open={dropMessage.show}
        autoHideDuration={dropMessage.type === 'error' ? 5000 : 3000}
        onClose={() => setDropMessage({ show: false, text: '', type: 'success' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setDropMessage({ show: false, text: '', type: 'success' })}
          severity={dropMessage.type}
          sx={{ width: '100%' }}
        >
          {dropMessage.text}
        </Alert>
      </Snackbar>

      {/* useMessage hook의 메시지 표시용 Snackbar */}
      <Snackbar
        open={message.show}
        autoHideDuration={message.type === 'error' ? 5000 : 3000}
        onClose={clearMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={clearMessage}
          severity={message.type}
          sx={{ width: '100%' }}
        >
          {message.text}
        </Alert>
      </Snackbar>

      {selectionMode && selectedFiles.size > 0 && (
        <BulkActionToolbar
          isMobile={isMobile}
          selectedFiles={selectedFiles}
          handleBulkMove={handleBulkMove}
          handleBulkCopy={handleBulkCopy}
          handleBulkDownload={handleBulkDownload}
          openBulkDeleteDialog={openBulkDeleteDialog}
          hasWritePermission={hasWritePermission}
          disabled={bulkMoveCopyInProgress}
        />
      )}

      <FileOperationProgress
        items={progressItems}
        onClose={(id) => {
          updateProgress({ id, remove: true });
        }}
        onRetry={handleRetryUpload}
        onCancelFile={handleCancelUploadFileWrapper}
        onCancelAll={handleCancelAllWrapper}
      />

      <ConflictResolveDialog
        open={!!bulkConflictData}
        onClose={() => setBulkConflictData(null)}
        onResolve={resolveBulkConflict}
        conflicts={bulkConflictData?.conflicts || []}
        operationType={bulkConflictData?.action === 'move' ? '이동' : '복사'}
      />

      <ConflictResolveDialog
        open={!!uploadConflictData}
        onClose={() => setUploadConflictData(null)}
        onResolve={resolveUploadConflict}
        conflicts={uploadConflictData?.conflicts || []}
        operationType="업로드"
      />

      {/* Mobile FAB */}
      {isMobile && !selectionMode && (
        <MobileFAB
          onUpload={openUploadDialog}
          onCreateFolder={openCreateFolderDialog}
          hasWritePermission={hasWritePermission}
        />
      )}

      {/* Mobile Action Sheet */}
      {isMobile && (
        <FileActionSheet
          open={actionSheetOpen}
          onClose={closeActionSheet}
          file={actionSheetFile}
          hasWritePermission={hasWritePermission}
          user={user}
          onDownload={handleActionSheetDownload}
          onRename={() => {
            if (actionSheetFile) {
              openRenameDialog(actionSheetFile);
            }
          }}
          onMove={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (FolderPickerDialog가 닫혀도 유지)
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('move');
              setFolderPickerAction('move');
              setFolderPickerOpen(true);
            }
          }}
          onCopy={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (FolderPickerDialog가 닫혀도 유지)
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('copy');
              setFolderPickerAction('copy');
              setFolderPickerOpen(true);
            }
          }}
          onDelete={() => {
            if (actionSheetFile) {
              openBulkDeleteDialog([actionSheetFile.path]);
            }
          }}
          onShare={() => {
            if (actionSheetFile) {
              openShareDialog(actionSheetFile);
            }
          }}
          onShareLink={() => {
            if (actionSheetFile) {
              openShareDialog(actionSheetFile);
            }
          }}
          onManageShared={() => {
            if (actionSheetFile) {
              openSharedFolderManageDialog(actionSheetFile);
            }
          }}
          onPreview={() => {
            if (actionSheetFile) {
              const filename = actionSheetFile.basename || actionSheetFile.name;
              const canPreviewFile = canPreview(filename);
              setSelectedFile({ ...actionSheetFile, name: filename, canPreview: canPreviewFile });
              openPreviewDialog();
            }
          }}
          onProperties={() => {
            if (actionSheetFile) {
              openPropertiesDialog(actionSheetFile);
            }
          }}
        />
      )}

      {/* Rename Dialog */}
      <Dialog 
        open={renameDialogOpen} 
        onClose={closeRenameDialog}
        fullScreen={isMobile}
      >
        <DialogTitle>이름 변경</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="새 이름"
            fullWidth
            variant="outlined"
            value={renameNewName}
            onChange={(e) => {
              setRenameNewName(e.target.value);
              if (renameError) setRenameError('');
            }}
            error={Boolean(renameError)}
            helperText={renameError || ' '}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !renameLoading) {
                handleRename();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={closeRenameDialog} 
            disabled={renameLoading}
          >
            취소
          </Button>
          <Button 
            onClick={handleRename} 
            variant="contained" 
            disabled={renameLoading || !renameNewName.trim()}
          >
            변경
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share Dialog */}
      {(mobileShareFile || actionSheetFile) && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={closeShareDialog}
          folderPath={(mobileShareFile || actionSheetFile)?.type === 'directory' ? (mobileShareFile || actionSheetFile)?.path : null}
          folderName={(mobileShareFile || actionSheetFile)?.type === 'directory' ? ((mobileShareFile || actionSheetFile)?.basename || (mobileShareFile || actionSheetFile)?.name) : null}
          user={user}
          onMessage={setDropMessage}
          enableExternalShare={(mobileShareFile || actionSheetFile)?.type !== 'directory'}
          filePath={(mobileShareFile || actionSheetFile)?.type !== 'directory' ? (mobileShareFile || actionSheetFile)?.path : null}
          fileName={(mobileShareFile || actionSheetFile)?.type !== 'directory' ? ((mobileShareFile || actionSheetFile)?.basename || (mobileShareFile || actionSheetFile)?.name) : null}
        />
      )}

      {/* Shared Folder Manage Dialog */}
      {(mobileSharedManageFile || actionSheetFile) && (
        <SharedFolderManageDialog
          open={sharedFolderManageDialogOpen}
          onClose={closeSharedFolderManageDialog}
          folderPath={(mobileSharedManageFile || actionSheetFile)?.path}
          folderName={(mobileSharedManageFile || actionSheetFile)?.basename || (mobileSharedManageFile || actionSheetFile)?.name}
          directHasReadPermission={
            typeof (mobileSharedManageFile || actionSheetFile)?.hasReadPermission === 'boolean'
              ? (mobileSharedManageFile || actionSheetFile).hasReadPermission
              : undefined
          }
          user={user}
          onMessage={setDropMessage}
          onActionComplete={() => {
            handleOperationComplete({ opType: 'refresh', startedPath: currentPathRef.current });
          }}
        />
      )}

      {/* File Properties Dialog */}
      {(mobilePropertiesFile || actionSheetFile) && (
        <FilePropertiesDialog
          open={propertiesDialogOpen}
          onClose={closePropertiesDialog}
          file={mobilePropertiesFile || actionSheetFile}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        open={bulkDeleteDialogOpen}
        onClose={closeBulkDeleteDialog}
        onConfirm={handleBulkDeleteConfirm}
        title="삭제 확인"
        message={`선택한 ${bulkDeleteFilePaths.length}개의 파일/폴더를 삭제하시겠습니까?`}
        confirmText="삭제"
        cancelText="취소"
        confirmColor="error"
      />

      <ConflictResolveDialog
        open={!!bulkConflictData}
        onClose={() => setBulkConflictData(null)}
        onResolve={resolveBulkConflict}
        conflicts={bulkConflictData?.conflicts || []}
        operationType={bulkConflictData?.action === 'move' ? '이동' : '복사'}
      />
      <ConflictResolveDialog
        open={!!uploadConflictData}
        onClose={() => setUploadConflictData(null)}
        onResolve={resolveUploadConflict}
        conflicts={uploadConflictData?.conflicts || []}
        operationType="업로드"
      />
    </Box>
  );
};

export default FileManager;
