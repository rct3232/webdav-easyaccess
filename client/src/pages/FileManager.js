import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Snackbar,
  Alert,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  FormControlLabel,
  Divider,
  Paper,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  ViewStream as ViewStreamIcon,
  Person as PersonIcon,
  AdminPanelSettings as AdminIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Sort as SortIcon,
  CheckCircle as CheckCircleIcon,
  ChevronLeft as ChevronLeftIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Home as HomeIcon,
  Share as ShareIcon,
  AccessTime as AccessTimeIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { VIEW_MODES, SORT_MODES } from '../constants/fileManager';
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
import { moveFile, checkPermission, copyFile, checkConflicts } from '../services/fileService';
import { addRecentFile, onRecentFilesChange } from '../utils/recentFiles';
import { determineErrorType, getErrorMessageByType, getErrorMessage, ERROR_TYPES } from '../utils/errorUtils';
import { normalizePath } from '../utils/pathUtils';
import { useRecentFileErrorHandler } from '../hooks/useRecentFileErrorHandler';
import { useRecentFileNavigation } from '../hooks/useRecentFileNavigation';
import { useRecentFilePreview } from '../hooks/useRecentFilePreview';

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionSheetFile, setActionSheetFile] = useState(null);
  // 모바일용 FolderPickerDialog를 위한 별도 상태 (actionSheetFile이 초기화되어도 유지)
  const [mobilePickerFile, setMobilePickerFile] = useState(null);
  const [mobilePickerAction, setMobilePickerAction] = useState(null);

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

  // 썸네일 로드 완료 핸들러
  const handleThumbnailsLoaded = useCallback((thumbnailMap) => {
    // files 상태를 업데이트하여 썸네일 URL 추가
    setFiles(prevFiles => {
      return prevFiles.map(file => {
        const thumbnailUrl = thumbnailMap.get(file.path);
        if (thumbnailUrl && !file.thumbnailUrl) {
          return { ...file, thumbnailUrl };
        }
        return file;
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
  } = useSelection(sortedFiles);

  // 모바일에서 Detail 모드로 전환 시도 시 List 모드로 자동 전환
  useEffect(() => {
    if (isMobile && viewMode === VIEW_MODES.DETAIL) {
      setViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, viewMode]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  
  // 최근 파일 미리보기 훅
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
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharedFolderManageDialogOpen, setSharedFolderManageDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameNewName, setRenameNewName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');
  // 모바일용 이름 변경/삭제/공유/공유 관리를 위한 별도 상태 (actionSheetFile이 초기화되어도 유지)
  const [mobileRenameFile, setMobileRenameFile] = useState(null);
  const [mobileDeleteFile, setMobileDeleteFile] = useState(null);
  const [mobileShareFile, setMobileShareFile] = useState(null);
  const [mobileSharedManageFile, setMobileSharedManageFile] = useState(null);
  const [mobilePropertiesFile, setMobilePropertiesFile] = useState(null);
  
  // 속성 다이얼로그 상태
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  
  // Bulk delete 확인 다이얼로그 상태
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteFilePaths, setBulkDeleteFilePaths] = useState([]);
  
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
    handleFileOperation: handleFileOperationOp,
    handleFileRename: handleFileRenameOp,
    handleFileDelete: handleFileDeleteOp,
    conflictData,
    resolveConflict,
    setConflictData,
  } = useFileOperations({
    onProgress: updateProgress,
    setProcessingMap,
    onActionComplete: handleOperationComplete,
    onClose: () => {
      setActionSheetOpen(false);
      setActionSheetFile(null);
    },
  });

  const [uploadConflictData, setUploadConflictData] = useState(null);

  const executeExplorerUpload = useCallback(async (filesToUpload, targetPath, onConflict = 'error') => {
    // Use currentPath if targetPath is null
    const uploadPath = targetPath || currentPath;
    
    if (!filesToUpload || filesToUpload.length === 0) return;

    dismissFailedItems();

    const progressId = `upload_drop_${Date.now()}`;
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
      cancellable: false,
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
                  : progress.status === 'error'
                    ? 'error'
                    : 'pending';
            fileItems[idx] = {
              ...fileItems[idx],
              status,
              error: progress.status === 'error' ? progress.error : undefined,
            };
          }

          const completedCount = fileItems.filter((it) => it.status === 'completed').length;
          const failCount = fileItems.filter((it) => it.status === 'error').length;

          updateProgress({
            ...baseProgress,
            status: 'processing',
            progress: completedCount,
            total: progress.total,
            current: `(${progress.current}/${progress.total}) ${progress.currentFile}`,
            error: failCount > 0 ? `${failCount}개 실패` : undefined,
            keepOnError: failCount > 0 || undefined,
            fileItems: [...fileItems],
          });
        },
        onConflict
      );

      const completedCount = fileItems.filter((it) => it.status === 'completed').length;
      const failCount = fileItems.filter((it) => it.status === 'error').length;
      const failedItems = (errors || []).map((e) => ({
        fileName: e.relativePath || e.file?.name || 'unknown',
        error: e.error,
      }));

      if (failCount > 0) {
        updateProgress({
          ...baseProgress,
          status: 'error',
          progress: completedCount,
          total: filesToUpload.length,
          current: '완료 (일부 실패)',
          error: `${failCount}개 파일 업로드 실패`,
          keepOnError: true,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
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
    }
  }, [currentPath, dismissFailedItems, hasWritePermission, user?.is_admin, updateProgress, handleOperationComplete]);

  /**
   * Resolve upload conflicts
   */
  const resolveUploadConflict = useCallback(async (resolution) => {
    if (!uploadConflictData) return;
    
    const { filesToUpload, targetPath } = uploadConflictData;
    setUploadConflictData(null);
    
    let filteredFiles = filesToUpload;
    if (resolution === 'skip') {
      const { conflicts } = uploadConflictData;
      const conflictNames = new Set(conflicts.map(c => c.sourcePath));
      filteredFiles = filesToUpload.filter(f => !conflictNames.has(f.relativePath || f.file.name));
    }
    
    if (filteredFiles.length > 0) {
      await executeExplorerUpload(filteredFiles, targetPath, resolution);
    }
  }, [uploadConflictData, executeExplorerUpload]);

  const handleBulkDeleteConfirm = () => {
    setBulkDeleteDialogOpen(false);
    const filePaths = [...bulkDeleteFilePaths];
    setBulkDeleteFilePaths([]);
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

  const handleFileClick = async (file) => {
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
        setPreviewDialogOpen(true);
        // 최근 파일에 추가
        await addRecentFile(file);
        // 이벤트 리스너가 자동으로 loadFiles() 호출
      }
    }
  };


  // Upload handlers - useFileUpload hook handles this
  const handleUploadStart = useCallback(async (files, uploadPath) => {
    setUploadDialogOpen(false);
    
    if (!files || files.length === 0) return;

    const filesToUpload = files.map(f => ({ file: f, relativePath: f.webkitRelativePath || f.name }));

    // Check conflicts before upload
    try {
      const operations = filesToUpload.map(({ file, relativePath }) => {
        const fileName = relativePath || file.name;
        const destinationPath = uploadPath === '/' ? `/${fileName}` : `${uploadPath}/${fileName}`;
        return { sourcePath: fileName, destinationPath, type: 'upload' };
      });

      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        setUploadConflictData({ filesToUpload, targetPath: uploadPath, conflicts });
        return;
      }

      await executeExplorerUpload(filesToUpload, uploadPath);
    } catch (error) {
      console.error('Upload conflict check failed:', error);
      await executeExplorerUpload(filesToUpload, uploadPath);
    }
  }, [executeExplorerUpload]);

  // Cancel upload handlers - wrap to pass progressItems
  const handleCancelUploadFileWrapper = useCallback((progressId, fileName) => {
    handleCancelUploadFile(progressId, fileName, progressItems);
  }, [handleCancelUploadFile, progressItems]);

  const handleCancelAllUploadWrapper = useCallback((progressId) => {
    handleCancelAllUpload(progressId, progressItems);
  }, [handleCancelAllUpload, progressItems]);

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
    setCreateFolderDialogOpen(false);
    
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
      setRenameDialogOpen(false);
      setRenameNewName('');
      setMobileRenameFile(null);
      setActionSheetOpen(false);
      setActionSheetFile(null);
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    const targetFile = mobileDeleteFile || actionSheetFile;
    if (!targetFile) return;

    try {
      await handleFileDeleteOp(targetFile, { startedPath: currentPathRef.current });
      setDeleteDialogOpen(false);
      setMobileDeleteFile(null);
      setActionSheetOpen(false);
      setActionSheetFile(null);
    } catch (error) {
      // Error is already handled by useFileOperations
    }
  };

  // FileContextMenu.handleFileOperation과 동일한 패턴의 공통 핸들러
  const handleActionSheetFileOperation = async (selectedPath, operation, operationName, actionVerb, file = null) => {
    const targetFile = file || actionSheetFile;
    if (!targetFile) return;

    try {
      await handleFileOperationOp(targetFile, selectedPath, operation, operationName, actionVerb, { startedPath: currentPathRef.current });
    } catch (error) {
      // Error is already handled by useFileOperations
    }
  };

  const handleActionSheetDownload = async () => {
    if (!actionSheetFile) return;
    try {
      await handleFileDownloadOp(actionSheetFile);
      setActionSheetOpen(false);
      setActionSheetFile(null);
    } catch (error) {
      // Error is already handled by useFileOperations
    }
  };

  const handleFileDrop = async (draggedFile, targetFolder) => {
      if (draggedFile.path === targetFolder.path) {
        return;
      }

    try {
      await handleFileOperationOp(draggedFile, targetFolder.path, moveFile, '이동', '이동', { startedPath: currentPathRef.current });
    } catch (error) {
      // Error is already handled by useFileOperations
    }
  };

  const handleExplorerDrop = async (filesToUpload, targetPath) => {
    const uploadPath = targetPath || currentPath;
    
    if (!filesToUpload || filesToUpload.length === 0) return;

    // Check conflicts before upload
    try {
      const operations = filesToUpload.map(({ file, relativePath }) => {
        const fileName = relativePath || file.name;
        const destinationPath = uploadPath === '/' ? `/${fileName}` : `${uploadPath}/${fileName}`;
        return { sourcePath: fileName, destinationPath, type: 'upload' };
      });

      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        setUploadConflictData({ filesToUpload, targetPath, conflicts });
        return;
      }

      await executeExplorerUpload(filesToUpload, targetPath);
    } catch (error) {
      console.error('Upload conflict check failed:', error);
      await executeExplorerUpload(filesToUpload, targetPath);
    }
  };

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
      <AppBar 
        position="sticky" 
        sx={{ 
          top: 0, 
          zIndex: (theme) => theme.zIndex.appBar,
          background: `
            radial-gradient(ellipse 250px 150px at 0% 0%, #4167ba 0%, transparent 60%),
            radial-gradient(ellipse 250px 150px at 50% 100%, #52c597 0%, transparent 60%),
            radial-gradient(ellipse 300px 200px at 100% 15%, rgba(251, 229, 89, 0.6) 0%, transparent 40%),
            linear-gradient(135deg, #4167ba, #52c597 85%, rgba(251, 229, 89, 0.5) 98%)
          `.trim(),
        }} 
        elevation={0}
      >
        <Toolbar>
          {isMobile && isSearchMode ? (
            // 모바일 검색 모드: 앱바 전체가 검색창
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder="파일 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    color: 'white',
                    '& fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                    '& input': {
                      color: 'white',
                      '&::placeholder': {
                        color: 'rgba(255, 255, 255, 0.7)',
                        opacity: 1,
                      },
                    },
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                    </InputAdornment>
                  ),
                }}
              />
              <IconButton
                color="inherit"
                onClick={() => {
                  setIsSearchMode(false);
                  setSearchQuery('');
                }}
                title="검색 닫기"
              >
                <CloseIcon />
              </IconButton>
            </Box>
          ) : (
            // 일반 모드: 로고와 버튼들 표시
            <>
              <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  component="img"
                  src="/logo_white.png"
                  alt="WebDAV EasyAccess"
                  sx={{
                    height: isMobile ? '27px' : '33.75px',
                    maxWidth: '100%',
                    objectFit: 'contain',
                  }}
                />
              </Box>
              {!isMobile && (
                // 데스크톱: 검색창 항상 표시 (우측)
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
                  <TextField
                    size="small"
                    placeholder="파일 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setIsSearchMode(true)}
                    sx={{
                      width: 300,
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        color: 'white',
                        '& fieldset': {
                          borderColor: 'rgba(255, 255, 255, 0.3)',
                        },
                        '&:hover fieldset': {
                          borderColor: 'rgba(255, 255, 255, 0.5)',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: 'rgba(255, 255, 255, 0.7)',
                        },
                        '& input': {
                          color: 'white',
                          '&::placeholder': {
                            color: 'rgba(255, 255, 255, 0.7)',
                            opacity: 1,
                          },
                        },
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                        </InputAdornment>
                      ),
                      endAdornment: searchQuery && (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setSearchQuery('');
                              setIsSearchMode(false);
                            }}
                            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Box>
              )}
              {isMobile && (
                <IconButton color="inherit" onClick={() => setIsSearchMode(true)} title="검색">
                  <SearchIcon />
                </IconButton>
              )}
              {user?.is_admin && (
                <IconButton color="inherit" onClick={() => navigate('/admin')} title="관리자 대시보드">
                  <AdminIcon />
                </IconButton>
              )}
              <IconButton color="inherit" onClick={() => navigate('/mypage')} title="마이페이지">
                <PersonIcon />
              </IconButton>
              <IconButton color="inherit" onClick={handleLogout} title="로그아웃">
                <LogoutIcon />
              </IconButton>
            </>
          )}
        </Toolbar>
      </AppBar>


      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {!isMobile && (
          <FolderTree
            currentPath={currentPath}
            onPathClick={handlePathClick}
            onFileClick={handleFileClick}
            user={user}
            treeUpdateTrigger={treeUpdateTrigger}
            onCreateFolder={() => setCreateFolderDialogOpen(true)}
            onUploadFile={() => setUploadDialogOpen(true)}
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
                      setCreateFolderDialogOpen(true);
                      setDrawerOpen(false);
                    }}
                    onUploadFile={() => {
                      setUploadDialogOpen(true);
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

          {/* 정렬/선택/보기모드 */}
          <Box sx={{ px: 2, py: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <IconButton
              onClick={(e) => setSortMenuAnchor(e.currentTarget)}
              title="정렬"
            >
              <SortIcon />
            </IconButton>

            <IconButton
              color={selectionMode ? 'primary' : 'default'}
              onClick={handleToggleSelectionMode}
              title={selectionMode ? '선택 모드' : '선택'}
              sx={{
                backgroundColor: selectionMode ? 'primary.main' : 'transparent',
                color: selectionMode ? 'primary.contrastText' : 'inherit',
                '&:hover': {
                  backgroundColor: selectionMode ? 'primary.dark' : 'action.hover',
                },
              }}
            >
              {selectionMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
            </IconButton>

            {selectionMode && (
              <>
                {isMobile ? (
                  <>
                    <IconButton size="small" onClick={handleSelectAll} title="모두 선택">
                      <SelectAllIcon />
                    </IconButton>
                    <IconButton size="small" onClick={handleDeselectAll} title="모두 해제">
                      <DeselectIcon />
                    </IconButton>
                    <Typography variant="caption" sx={{ ml: 1, fontSize: '0.75rem' }}>
                      {selectedFiles.size}개
                    </Typography>
                  </>
                ) : (
                  <>
                    <Button
                      size="small"
                      startIcon={<SelectAllIcon />}
                      onClick={handleSelectAll}
                    >
                      모두 선택
                    </Button>
                    <Button
                      size="small"
                      startIcon={<DeselectIcon />}
                      onClick={handleDeselectAll}
                    >
                      모두 해제
                    </Button>
                    <Typography variant="body2" sx={{ ml: 1 }}>
                      {selectedFiles.size}개 선택됨
                    </Typography>
                  </>
                )}
              </>
            )}

            <Box sx={{ flexGrow: 1 }} />
            <Menu
              anchorEl={sortMenuAnchor}
              open={Boolean(sortMenuAnchor)}
              onClose={() => setSortMenuAnchor(null)}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
              }}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  이름
                </Typography>
                <RadioGroup
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value);
                    setSortMenuAnchor(null);
                  }}
                >
                  <FormControlLabel
                    value={SORT_MODES.NAME_ASC}
                    control={<Radio size="small" />}
                    label="오름차순"
                  />
                  <FormControlLabel
                    value={SORT_MODES.NAME_DESC}
                    control={<Radio size="small" />}
                    label="내림차순"
                  />
                </RadioGroup>
              </Box>
              <Divider />
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  수정 날짜
                </Typography>
                <RadioGroup
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value);
                    setSortMenuAnchor(null);
                  }}
                >
                  <FormControlLabel
                    value={SORT_MODES.DATE_ASC}
                    control={<Radio size="small" />}
                    label="오름차순"
                  />
                  <FormControlLabel
                    value={SORT_MODES.DATE_DESC}
                    control={<Radio size="small" />}
                    label="내림차순"
                  />
                </RadioGroup>
              </Box>
            </Menu>

            {/* 보기 모드 버튼 */}
            {selectionMode ? (
              <>
                <IconButton
                  onClick={(e) => setViewModeMenuAnchor(e.currentTarget)}
                  title="보기 모드"
                >
                  {viewMode === VIEW_MODES.LIST && <ViewStreamIcon />}
                  {viewMode === VIEW_MODES.GRID && <ViewModuleIcon />}
                  {viewMode === VIEW_MODES.DETAIL && <ViewListIcon />}
                </IconButton>
                <Menu
                  anchorEl={viewModeMenuAnchor}
                  open={Boolean(viewModeMenuAnchor)}
                  onClose={() => setViewModeMenuAnchor(null)}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                  }}
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      setViewMode(VIEW_MODES.LIST);
                      setViewModeMenuAnchor(null);
                    }}
                    selected={viewMode === VIEW_MODES.LIST}
                  >
                    <ListItemIcon>
                      <ViewStreamIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>리스트 보기</ListItemText>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setViewMode(VIEW_MODES.GRID);
                      setViewModeMenuAnchor(null);
                    }}
                    selected={viewMode === VIEW_MODES.GRID}
                  >
                    <ListItemIcon>
                      <ViewModuleIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>그리드 보기</ListItemText>
                  </MenuItem>
                  {!isMobile && (
                    <MenuItem
                      onClick={() => {
                        setViewMode(VIEW_MODES.DETAIL);
                        setViewModeMenuAnchor(null);
                      }}
                      selected={viewMode === VIEW_MODES.DETAIL}
                    >
                      <ListItemIcon>
                        <ViewListIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText>상세 보기</ListItemText>
                    </MenuItem>
                  )}
                </Menu>
              </>
            ) : (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <IconButton
                  color={viewMode === VIEW_MODES.LIST ? 'primary' : 'default'}
                  onClick={() => setViewMode(VIEW_MODES.LIST)}
                  title="목록 보기"
                >
                  <ViewStreamIcon />
                </IconButton>
                <IconButton
                  color={viewMode === VIEW_MODES.GRID ? 'primary' : 'default'}
                  onClick={() => setViewMode(VIEW_MODES.GRID)}
                  title="그리드 보기"
                >
                  <ViewModuleIcon />
                </IconButton>
                {!isMobile && (
                  <IconButton
                    color={viewMode === VIEW_MODES.DETAIL ? 'primary' : 'default'}
                    onClick={() => setViewMode(VIEW_MODES.DETAIL)}
                    title="상세 보기"
                  >
                    <ViewListIcon />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

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
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
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
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
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
              />
            ) : (
              <FileDetail
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
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
        onClose={() => setUploadDialogOpen(false)}
        currentPath={currentPath}
        onUploadStart={handleUploadStart}
      />

      <CreateFolderDialog
        open={createFolderDialogOpen}
        onClose={() => setCreateFolderDialogOpen(false)}
        onComplete={handleCreateFolderComplete}
        currentPath={currentPath}
        onProgress={updateProgress}
      />

      <FilePreviewDialog
        open={previewDialogOpen}
        onClose={() => {
          setPreviewDialogOpen(false);
          setSelectedFile(null);
        }}
        file={selectedFile}
      />

      <FileContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        file={selectedFile}
        onActionComplete={handleOperationComplete}
        user={user}
        currentPath={currentPath}
        onMessage={setDropMessage}
        hasWritePermission={hasWritePermission}
        onProgress={updateProgress}
        onProcessingStart={(paths, type) => {
          markProcessing(paths, type);
        }}
        onProcessingEnd={(paths) => {
          clearProcessing(paths);
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
          // mobilePickerFile이 있으면 모바일에서 호출된 것
          if (mobilePickerFile) {
            const currentAction = mobilePickerAction;
            const currentFile = mobilePickerFile;
            
            // 작업 수행 (currentFile을 사용)
            if (currentAction === 'move') {
              handleActionSheetFileOperation(selectedPath, moveFile, '이동', '이동', currentFile);
            } else if (currentAction === 'copy') {
              handleActionSheetFileOperation(selectedPath, copyFile, '복사', '복사', currentFile);
            }
          } else {
            // 기존 bulk operation 로직 (데스크톱)
            handleFolderPickerSelect(selectedPath);
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
          !mobilePickerFile && !actionSheetFile && folderPickerAction === 'copy' ? Array.from(selectedFiles) : undefined
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
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: isMobile ? 0 : 24,
            left: isMobile ? 0 : '50%',
            right: isMobile ? 0 : 'auto',
            transform: isMobile ? 'none' : 'translateX(-50%)',
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            gap: isMobile ? 0.5 : 1,
            alignItems: 'center',
            justifyContent: 'center',
            p: isMobile ? 1 : 1.5,
            borderRadius: isMobile ? 0 : 3,
            zIndex: 1000,
            backgroundColor: 'background.paper',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            paddingBottom: isMobile ? 'calc(8px + env(safe-area-inset-bottom))' : 1.5,
          }}
        >
          <Typography 
            variant="body2" 
            sx={{ 
              mr: isMobile ? 0.5 : 1, 
              fontWeight: 500, 
              minWidth: isMobile ? 'auto' : '60px',
              fontSize: isMobile ? '0.875rem' : '0.875rem',
            }}
          >
            {selectedFiles.size}개
          </Typography>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkMove}
            disabled={!hasWritePermission}
            title="이동"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
              '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
            }}
          >
            <MoveIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkCopy}
            title="복사"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
            }}
          >
            <CopyIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkDownload}
            title="다운로드"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
            }}
          >
            <DownloadIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="error"
            size={isMobile ? "medium" : "small"}
            onClick={() => {
              const filePaths = Array.from(selectedFiles);
              if (filePaths.length > 0) {
                setBulkDeleteFilePaths(filePaths);
                setBulkDeleteDialogOpen(true);
              }
            }}
            disabled={!hasWritePermission}
            title="삭제"
            sx={{ 
              backgroundColor: 'error.main',
              color: 'white',
              '&:hover': { backgroundColor: 'error.dark' },
              '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
            }}
          >
            <DeleteIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
        </Paper>
      )}

      <FileOperationProgress
        items={progressItems}
        onClose={(id) => {
          updateProgress({ id, remove: true });
        }}
        onRetry={handleRetryUpload}
        onCancelFile={handleCancelUploadFileWrapper}
        onCancelAll={handleCancelAllUploadWrapper}
      />

      <ConflictResolveDialog
        open={!!conflictData}
        onClose={() => setConflictData(null)}
        onResolve={resolveConflict}
        conflicts={conflictData?.conflicts || []}
        operationType={conflictData?.operationName || '이동'}
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
          onUpload={() => {
            setUploadDialogOpen(true);
          }}
          onCreateFolder={() => {
            setCreateFolderDialogOpen(true);
          }}
          hasWritePermission={hasWritePermission}
        />
      )}

      {/* Mobile Action Sheet */}
      {isMobile && (
        <FileActionSheet
          open={actionSheetOpen}
          onClose={() => {
            setActionSheetOpen(false);
            setActionSheetFile(null);
          }}
          file={actionSheetFile}
          hasWritePermission={hasWritePermission}
          user={user}
          onDownload={handleActionSheetDownload}
          onRename={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileRenameFile(actionSheetFile);
              setRenameNewName(actionSheetFile.basename);
              setRenameDialogOpen(true);
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
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileDeleteFile(actionSheetFile);
              setDeleteDialogOpen(true);
            }
          }}
          onShare={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileShareFile(actionSheetFile);
              setShareDialogOpen(true);
            }
          }}
          onShareLink={() => {
            if (actionSheetFile) {
              setMobileShareFile(actionSheetFile);
              setShareDialogOpen(true);
            }
          }}
          onManageShared={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileSharedManageFile(actionSheetFile);
              setSharedFolderManageDialogOpen(true);
            }
          }}
          onPreview={() => {
            if (actionSheetFile) {
              const filename = actionSheetFile.basename || actionSheetFile.name;
              const canPreviewFile = canPreview(filename);
              setSelectedFile({ ...actionSheetFile, name: filename, canPreview: canPreviewFile });
              setPreviewDialogOpen(true);
            }
          }}
          onProperties={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobilePropertiesFile(actionSheetFile);
              setPropertiesDialogOpen(true);
            }
          }}
        />
      )}

      {/* Rename Dialog */}
      <Dialog 
        open={renameDialogOpen} 
        onClose={() => {
          setRenameDialogOpen(false);
          setRenameNewName('');
          setRenameError('');
          setMobileRenameFile(null);
        }}
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
            onClick={() => {
              setRenameDialogOpen(false);
              setRenameNewName('');
              setRenameError('');
              setMobileRenameFile(null);
            }} 
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setMobileDeleteFile(null);
        }}
        onConfirm={handleDelete}
        title="삭제 확인"
        message={`정말로 "${(mobileDeleteFile || actionSheetFile)?.basename}"을(를) 삭제하시겠습니까?`}
        confirmText="삭제"
        cancelText="취소"
        confirmColor="error"
        loading={processingMap.has((mobileDeleteFile || actionSheetFile)?.path)}
      />

      {/* Share Dialog */}
      {(mobileShareFile || actionSheetFile) && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => {
            setShareDialogOpen(false);
            setMobileShareFile(null);
          }}
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
          onClose={() => {
            setSharedFolderManageDialogOpen(false);
            setMobileSharedManageFile(null);
          }}
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
          onClose={() => {
            setPropertiesDialogOpen(false);
            setMobilePropertiesFile(null);
          }}
          file={mobilePropertiesFile || actionSheetFile}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        open={bulkDeleteDialogOpen}
        onClose={() => {
          setBulkDeleteDialogOpen(false);
          setBulkDeleteFilePaths([]);
        }}
        onConfirm={handleBulkDeleteConfirm}
        title="삭제 확인"
        message={`선택한 ${bulkDeleteFilePaths.length}개의 파일/폴더를 삭제하시겠습니까?`}
        confirmText="삭제"
        cancelText="취소"
        confirmColor="error"
      />

      <ConflictResolveDialog
        open={!!conflictData}
        onClose={() => setConflictData(null)}
        onResolve={resolveConflict}
        conflicts={conflictData?.conflicts || []}
        operationType={conflictData?.operationName || '이동'}
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
