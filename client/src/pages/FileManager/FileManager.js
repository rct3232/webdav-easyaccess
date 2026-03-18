import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Snackbar,
  Alert,
  Collapse,
  CircularProgress,
  AppBar,
  Toolbar,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { VIEW_MODES, FLOATING_BOTTOM_HEIGHT_MOBILE, FLOATING_BOTTOM_HEIGHT_DESKTOP } from '../../constants/fileManager';
import { canPreview, sortFiles } from '../../utils/fileUtils';
import { getViewMode, setViewMode as saveViewMode, setSortMode as saveSortMode } from '../../utils/localStorage';
import { useFileManager } from './hooks/useFileManager';
import { useSelection } from './hooks/useSelection';
import { useBulkOperations } from './hooks/useBulkOperations';
import { useDropToUpload } from '../../hooks/useDropToUpload';
import { useResponsive } from '../../hooks/useResponsive';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useFileOperations } from './hooks/useFileOperations';
import { uploadMultipleFiles } from '../../services/fileService';
import { useMessage } from '../../hooks/useMessage';
import { createProcessingUpdater } from '../../utils/processingUtils';
import { shouldRefreshAfterOperation } from '../../utils/refreshPolicy';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { validateFileName } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../utils/validationMessage';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import {
  FileList,
  FileGrid,
  FileDetail,
  FileContextMenu,
  FileOperationProgress,
  FileActionSheet,
  FileManagerHeader,
  FileManagerControls,
  Breadcrumb,
  FAB,
  FloatingSearchBar,
} from '../../components/file-manager';
import {
  UploadDialog,
  CreateFolderDialog,
  FilePreviewDialog,
  FolderPickerDialog,
  ShareDialog,
  ShareTargetDialog,
  FilePropertiesDialog,
  ConfirmDialog,
  ConflictResolveDialog,
  RenameDialog,
  LoginDialog,
} from '../../components/dialogs';
import { FolderTree } from '../../components/folder-tree';
import { checkPermission, checkConflicts } from '../../services/fileService';
import { addRecentFile, onRecentFilesChange } from '../../utils/recentFiles';
import { determineErrorType, getErrorMessageByType, showErrorFromError, getServerErrorDisplay, ERROR_TYPES } from '../../utils/errorUtils';
import { normalizePath, getBasename, getParentPath, toFilesPath } from '../../utils/pathUtils';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

import { useRecentFile } from './hooks/useRecentFile';
import { useFileManagerDialogs } from './hooks/useFileManagerDialogs';
import { checkMyPermissionForShare, addShareLinkToMyPermissions } from '../../services/shareLinkService';

const FileManager = ({ shareToken, linkInfo } = {}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [progressDrawerOpen, setProgressDrawerOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [addToSharedModalOpen, setAddToSharedModalOpen] = useState(false);
  const [addToSharedStatus, setAddToSharedStatus] = useState('loading');
  const [addToSharedConfirmLoading, setAddToSharedConfirmLoading] = useState(false);
  const addToSharedCheckDoneRef = useRef(null);
  const addToSharedRequestIdRef = useRef(0);
  const [leaveShareConfirmOpen, setLeaveShareConfirmOpen] = useState(false);
  const [leaveShareConfirmTargetPath, setLeaveShareConfirmTargetPath] = useState(null);
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

  // Double-click detection for desktop
  const lastClickRef = useRef({ filePath: null, time: 0 });
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

  const { message, showError, showWarning, clearMessage } = useMessage();

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

  const [viewMode, setViewMode] = useState(() => getViewMode());
  const [searchQuery, setSearchQuery] = useState('');

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

  // Share link: when logged in, open add-to-shared modal with spinner, then check permission.
  // Use requestId so that when effect re-runs (e.g. user ref change), we still apply the first response.
  useEffect(() => {
    if (!isShareLinkMode || !user || !shareToken) return;
    if (addToSharedCheckDoneRef.current === shareToken) return;
    addToSharedCheckDoneRef.current = shareToken;
    addToSharedRequestIdRef.current += 1;
    const myRequestId = addToSharedRequestIdRef.current;
    setAddToSharedModalOpen(true);
    setAddToSharedStatus('loading');
    const timeoutMs = 10000;
    const permissionPromise = checkMyPermissionForShare(shareToken);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    Promise.race([permissionPromise, timeoutPromise])
      .then((data) => {
        const requestIdMatch = myRequestId === addToSharedRequestIdRef.current;
        if (!requestIdMatch) return;
        if (data.hasSufficientPermission) {
          setAddToSharedModalOpen(false);
          if (linkInfo?.isDirectory) {
            navigate(toFilesPath(linkInfo.filePath));
          }
        } else {
          setAddToSharedStatus('confirm');
        }
      })
      .catch(() => {
        if (myRequestId !== addToSharedRequestIdRef.current) return;
        setAddToSharedModalOpen(false);
      });
  }, [isShareLinkMode, user, shareToken, linkInfo?.filePath, linkInfo?.isDirectory, navigate]);

  const handleAddToSharedConfirm = useCallback(async () => {
    if (!shareToken) return;
    setAddToSharedConfirmLoading(true);
    try {
      await addShareLinkToMyPermissions(shareToken);
      setAddToSharedModalOpen(false);
      if (linkInfo?.isDirectory) {
        navigate(toFilesPath(linkInfo.filePath));
      }
    } catch (err) {
      showError(getServerErrorDisplay(err?.response?.data, t) || err?.message || t('dialogs.addToSharedError'));
    } finally {
      setAddToSharedConfirmLoading(false);
    }
  }, [shareToken, linkInfo, navigate, showError, t]);

  /** 공유됨 추가 버튼 클릭 시: 모달을 열고 로딩 → 권한 확인 후 확인 문구 또는 닫기 */
  const openAddToSharedModal = useCallback(() => {
    if (!shareToken) return;
    setAddToSharedModalOpen(true);
    setAddToSharedStatus('loading');
    addToSharedRequestIdRef.current += 1;
    const myRequestId = addToSharedRequestIdRef.current;
    const timeoutMs = 10000;
    const permissionPromise = checkMyPermissionForShare(shareToken);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    Promise.race([permissionPromise, timeoutPromise])
      .then((data) => {
        if (myRequestId !== addToSharedRequestIdRef.current) return;
        if (data.hasSufficientPermission && linkInfo?.isDirectory) {
          setAddToSharedModalOpen(false);
          navigate(toFilesPath(linkInfo.filePath));
        } else if (data.hasSufficientPermission) {
          setAddToSharedModalOpen(false);
        } else {
          setAddToSharedStatus('confirm');
        }
      })
      .catch(() => {
        if (myRequestId !== addToSharedRequestIdRef.current) return;
        setAddToSharedModalOpen(false);
      });
  }, [shareToken, linkInfo, navigate]);

  /** 공유 링크 모드에서 일반 파일트리 경로 클릭 시: 확인 모달 후 /files로 이동 */
  const handleLeaveSharePathClick = useCallback((path) => {
    setLeaveShareConfirmTargetPath(path);
    setLeaveShareConfirmOpen(true);
  }, []);

  const handleLeaveShareConfirm = useCallback(() => {
    if (leaveShareConfirmTargetPath) {
      navigate(toFilesPath(leaveShareConfirmTargetPath));
      setLeaveShareConfirmOpen(false);
      setLeaveShareConfirmTargetPath(null);
      setDrawerOpen(false);
    }
  }, [leaveShareConfirmTargetPath, navigate]);

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
    reset: resetFileAreaDrag,
  } = useDropToUpload();

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
      return t('fileManager.pullRefreshDone');
    }
    if (isRefreshing || loading) {
      return t('fileManager.pullRefreshLoading');
    }
    if (hasReachedThreshold) {
      return t('fileManager.pullRefreshRelease');
    }
    return t('fileManager.pullRefreshPull');
  }, [showRefreshSuccess, isRefreshing, loading, hasReachedThreshold, t]);


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
    { markProcessing, clearProcessing, shareToken: isShareLinkMode ? shareToken : undefined }
  );

  const bulkMoveCopyInProgress = useMemo(() => {
    if (folderPickerOpen && (folderPickerAction === 'move' || folderPickerAction === 'copy')) return true;
    if (bulkConflictData != null) return true;
    const hasActiveBulkMoveCopy = progressItems.some(
      (item) => (item.type === 'move' || item.type === 'copy') && (item.status === 'preparing' || item.status === 'processing')
    );
    return !!hasActiveBulkMoveCopy;
  }, [folderPickerOpen, folderPickerAction, bulkConflictData, progressItems]);

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
  const explorerUploadFilesRef = useRef(new Map());

  const executeExplorerUpload = useCallback(async (filesToUpload, targetPath, onConflict = 'error') => {
    // Use currentPath if targetPath is null
    const uploadPath = targetPath || currentPath;

    if (!filesToUpload || filesToUpload.length === 0) return;

    dismissFailedItems();

    const progressId = `upload_drop_${Date.now()}`;
    explorerUploadAbortControllersRef.current.set(progressId, new Map());
    explorerUploadCancelledRef.current.set(progressId, new Set());
    explorerUploadFilesRef.current.set(progressId, filesToUpload);

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
      name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
      fileItems: [...fileItems],
      cancellable: true,
      retryData: { type: 'upload', currentPath: uploadPath },
    };

    // Check permissions
    if (!hasWritePermission && !user?.is_admin) {
      updateProgress({
        ...baseProgress,
        status: 'error',
        error: t('fileManager.uploadNoPermission'),
        keepOnError: true,
      });
      return;
    }

    updateProgress({
      ...baseProgress,
      status: 'preparing',
      current: t('fileManager.uploadPreparing'),
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
      const { errors } = await uploadMultipleFiles(
        filesToUpload,
        uploadPath,
        (progress) => {
          if (explorerUploadCancelAllRequestedRef.current.has(progressId)) return;
          const fileName = progress.currentFile;
          const fileStatus =
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
          const idx = fileItems.findIndex((it) => it.fileName === fileName);
          if (idx !== -1) {
            fileItems[idx] = {
              ...fileItems[idx],
              status: fileStatus,
              error: progress.status === 'error' ? progress.error : undefined,
            };
          }

          const completedCount = fileItems.filter((it) => it.status === 'completed').length;
          const skippedCount = fileItems.filter((it) => it.status === 'skipped').length;
          const failCount = fileItems.filter((it) => it.status === 'error').length;

          // 업데이트 최소화: fileItems는 보내지 않고 updatedFileItem만 전달 (merged.fileItems가 초기 스냅샷으로 덮어씌워지는 것 방지)
          const progressPayload = {
            ...baseProgress,
            status: 'processing',
            progress: completedCount + skippedCount,
            total: progress.total,
            current: `(${progress.current}/${progress.total}) ${progress.currentFile}`,
            error: failCount > 0 ? t('fileManager.uploadFailCount', { count: failCount }) : undefined,
            keepOnError: failCount > 0 || skippedCount > 0 || undefined,
            updatedFileItem: {
              fileName,
              status: fileStatus,
              error: progress.status === 'error' ? progress.error : undefined,
            },
          };
          delete progressPayload.fileItems;
          updateProgress(progressPayload);
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
        handleOperationComplete({ opType: 'upload', startedPath: uploadPath });
        return;
      }

      if (failCount > 0) {
        updateProgress({
          ...baseProgress,
          status: 'error',
          progress: completedCount + skippedCount,
          total: filesToUpload.length,
          current: t('fileManager.uploadCompletePartial'),
          error: t('fileManager.uploadFailMessage', { count: failCount }),
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
          current: t('fileManager.pullRefreshDone'),
          error: t('fileManager.uploadSkippedCount', { count: skippedCount }),
          keepOnError: true,
          fileItems: [...fileItems],
        });
      } else {
        updateProgress({
          ...baseProgress,
          status: 'completed',
          progress: filesToUpload.length,
          total: filesToUpload.length,
          current: t('fileManager.pullRefreshDone'),
          fileItems: [...fileItems],
        });
        setTimeout(() => {
          updateProgress({ id: progressId, remove: true });
          explorerUploadFilesRef.current.delete(progressId);
        }, 3000);
      }

      // Refresh file list and tree (all outcomes: success, partial, fail, skip)
      handleOperationComplete({ opType: 'upload', startedPath: uploadPath });
      setTreeUpdateTrigger({
        type: 'refresh',
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Upload error:', error);

      let errorMessage = getServerErrorDisplay(error?.response?.data, t) || error?.message || t('fileManager.uploadFailed');
      if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
        errorMessage = t('fileManager.uploadNoPermission');
      } else if (error.response?.status === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        errorMessage = t('fileManager.uploadServerError', { message: errorMessage });
      }

      updateProgress({
        ...baseProgress,
        status: 'error',
        error: errorMessage,
        keepOnError: true,
        fileItems: [...fileItems],
      });
      handleOperationComplete({ opType: 'upload', startedPath: uploadPath });
    } finally {
      explorerUploadAbortControllersRef.current.delete(progressId);
      explorerUploadCancelledRef.current.delete(progressId);
      explorerUploadCancelAllRequestedRef.current.delete(progressId);
    }
  }, [currentPath, dismissFailedItems, hasWritePermission, user, updateProgress, handleOperationComplete, t]);

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

  const handlePathClick = async (path) => {
    if (isShareLinkMode) {
      setCurrentPath(normalizePath(path));
      if (isMobile) setDrawerOpen(false);
      return;
    }

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
          permissionError.response = { status: HTTP_STATUS.FORBIDDEN };
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

  // 실제 파일 클릭 처리 함수 (forceOpen: true 시 선택 모드 무시하고 열기)
  const handleFileClickInternal = async (file, options = {}) => {
    const { forceOpen = false } = options;
    const inSelectionMode = forceOpen ? false : selectionMode;

    if (isShareLinkMode) {
      if (inSelectionMode) {
        toggleFileSelection(file);
      } else if (file.type === 'directory') {
        setCurrentPath(file.path);
        if (isMobile) setDrawerOpen(false);
      } else {
        const filename = file.basename || file.name;
        const canPreviewFile = canPreview(filename);
        setSelectedFile({ ...file, name: filename, canPreview: canPreviewFile });
        openPreviewDialog();
      }
      return;
    }

    if (inSelectionMode) {
      toggleFileSelection(file);
    } else {
      if (file.type === 'directory') {
        // 최근 파일에서 클릭한 경우
        if (file.isRecentFile) {
          const filePath = file.path;

          // 경로 유효성 검사
          if (!filePath || filePath === '/' || filePath.trim() === '') {
            handleRecentFileError(
              { message: t('errors.invalidPath') },
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
            if (error.response?.status === HTTP_STATUS.NOT_FOUND) {
              handleRecentFileError(error, filePath);
            } else {
              showErrorFromError(error, showError, t);
            }
          }
          return;
        }

        // 권한이 없는 폴더는 클릭 불가 (이미 표시된 정보 활용)
        if (file.hasReadPermission === false) {
          showError(t(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)));
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
              showError(t(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)));
              return;
            }
          } catch (error) {
            setCurrentPath(previousPath);
            const errorType = determineErrorType(error);
            if (errorType === ERROR_TYPES.PERMISSION_DENIED) {
              showError(t(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)));
            } else {
              console.error('Failed to check permission:', error);
              showErrorFromError(error, showError, t, 'fileManager.permissionCheckError');
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
              { message: t('errors.invalidPath') },
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
            if (error.response?.status === HTTP_STATUS.NOT_FOUND) {
              handleRecentFileError(error, filePath);
            } else {
              showErrorFromError(error, showError, t);
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

  // 파일 클릭 핸들러: Desktop = single/ctrl/shift→선택, double→열기; Mobile = tap→열기
  // event 없음(FolderTree 등) → 항상 열기
  const handleFileClick = useCallback((file, event, fileIndex) => {
    if (!file) return;

    if (!event) {
      handleFileClickInternalRef.current(file);
      return;
    }

    if (isMobile) {
      handleFileClickInternalRef.current(file);
      return;
    }

    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick = last.filePath === file.path && (now - last.time) < 350;

    if (isDoubleClick) {
      lastClickRef.current = { filePath: null, time: 0 };
      handleFileClickInternalRef.current(file, { forceOpen: true });
      return;
    }

    lastClickRef.current = { filePath: file.path, time: now };
    const index = typeof fileIndex === 'number' ? fileIndex : displayedFiles.findIndex(f => f.path === file.path);
    handleFileClickSelection(file, event, index >= 0 ? index : 0);
  }, [isMobile, handleFileClickSelection, displayedFiles]);

  const handleMoreClick = useCallback((file, e) => {
    if (!file) return;
    if (isMobile) {
      // setActionSheetFile already opens the sheet via actionSheet.open(file).
      // Do NOT call setActionSheetOpen(true) — it would call actionSheet.open() with no arg and overwrite file with undefined.
      setActionSheetFile(file);
    } else {
      setContextMenu(e ? { mouseX: e.clientX, mouseY: e.clientY } : { mouseX: 0, mouseY: 0 });
      setSelectedFile(file);
    }
  }, [isMobile, setActionSheetFile, setContextMenu, setSelectedFile]);

  const handleLongPressSelect = useCallback((file) => {
    if (!file) return;
    enterSelectionMode();
    setSelectedFiles(new Set([file.path]));
  }, [enterSelectionMode, setSelectedFiles]);

  // Upload handlers (executeExplorerUpload + explorerUploadFilesRef for retry)
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
      current: t('fileManager.statusConflictCheck'),
      name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
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
  }, [executeExplorerUpload, closeUploadDialog, updateProgress, t]);

  // Cancel upload handlers (upload_drop_* only; all uploads use executeExplorerUpload)
  const handleCancelUploadFileWrapper = useCallback((progressId, fileName) => {
    if (!progressId.startsWith('upload_drop_')) return;
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
  }, [progressItems, updateProgress]);

  const handleCancelAllUploadWrapper = useCallback((progressId) => {
    if (!progressId.startsWith('upload_drop_')) return;
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
        status: 'warning',
        error: t('fileManager.uploadCancelled'),
        keepOnError: true,
      });
      handleOperationComplete({ opType: 'upload', startedPath: progressItem.retryData?.currentPath ?? currentPathRef.current });
      setTreeUpdateTrigger({ type: 'refresh', timestamp: Date.now() });
    }
  }, [progressItems, updateProgress, handleOperationComplete, setTreeUpdateTrigger, t]);

  const handleCancelAllWrapper = useCallback((progressId) => {
    const item = progressItems.find((i) => i.id === progressId);
    if (!item) return;
    if (item.type === 'upload') {
      handleCancelAllUploadWrapper(progressId);
    } else if ((item.type === 'delete' || item.type === 'move' || item.type === 'copy') && item.jobId) {
      handleCancelBulkOperation(progressId);
    }
  }, [progressItems, handleCancelAllUploadWrapper, handleCancelBulkOperation]);

  // 업로드 재시도 (실패한 파일만 재시도, ref + executeExplorerUpload)
  const handleRetryUpload = useCallback(async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    if (!progressItem || !progressItem.retryData) {
      if (handleRetry) {
        return handleRetry(progressId);
      }
      return;
    }
    if (progressItem.retryData.type !== 'upload') {
      if (handleRetry) {
        return handleRetry(progressId);
      }
      return;
    }

    const filesToUpload = explorerUploadFilesRef.current.get(progressId);
    if (!filesToUpload || filesToUpload.length === 0) {
      updateProgress({ id: progressId, remove: true });
      explorerUploadFilesRef.current.delete(progressId);
      return;
    }

    const failedFileNames = new Set(
      (progressItem.fileItems || [])
        .filter((it) => it.status === 'error')
        .map((it) => it.fileName)
    );
    const failedFilesToUpload = filesToUpload.filter(
      (item) => failedFileNames.has(item.relativePath || item.file?.name)
    );
    if (failedFilesToUpload.length === 0) {
      updateProgress({ id: progressId, remove: true });
      explorerUploadFilesRef.current.delete(progressId);
      return;
    }

    const targetPath = progressItem.retryData.currentPath;
    updateProgress({ id: progressId, remove: true });
    explorerUploadFilesRef.current.delete(progressId);
    await executeExplorerUpload(failedFilesToUpload, targetPath);
  }, [progressItems, handleRetry, updateProgress, executeExplorerUpload]);

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
    if (!targetFile) return;
    const nameError = validateFileName(renameNewName);
    if (nameError) {
      setRenameError(getValidationMessage(nameError, t));
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

  const handleDropPermissionDenied = useCallback(
    (destinationPath) => {
      showError(t('fileManager.dropNoWritePermission', { path: destinationPath }));
    },
    [showError, t]
  );

  const handleDragStartFromView = useCallback((path) => {
    setContentAreaDraggedPath(path);
  }, []);

  const handleDragEndFromView = useCallback(() => {
    setContentAreaDraggedPath(null);
    setContentAreaDragType(null);
  }, []);

  const handleInternalFileDrop = useCallback(
    async (draggedPath, targetFolderPath) => {
      if (draggedPath === targetFolderPath) return;
      try {
        await handleFolderPickerSelect(targetFolderPath, { type: 'move', filePaths: [draggedPath] });
      } catch (error) {
        // Error is already handled by useBulkOperations
      }
    },
    [handleFolderPickerSelect]
  );

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
      current: t('fileManager.statusConflictCheck'),
      name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
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
  }, [currentPath, updateProgress, executeExplorerUpload, t]);

  // Handle drops on the entire file content area
  const handleContentAreaDragOver = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;

    const types = e.dataTransfer.types || [];
    const isExternal = types.includes('Files');
    const isInternalTree = types.includes('text/plain');

    if (isInternalTree && contentAreaDraggedPath && getParentPath(contentAreaDraggedPath) === currentPath) {
      return;
    }
    // Show dotted drop zone only over empty content area, not over file/folder rows
    if (e.target.closest('[data-file-path]')) {
      handleFileAreaDragLeave(e);
      return;
    }
    if (isExternal || isInternalTree) {
      handleFileAreaDragOver(e);
    }
  };

  const handleContentAreaDragEnter = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;

    const types = e.dataTransfer.types || [];
    const isExternal = types.includes('Files');
    const isInternalTree = types.includes('text/plain');

    if (isInternalTree && contentAreaDraggedPath && getParentPath(contentAreaDraggedPath) === currentPath) {
      return;
    }
    // Show dotted drop zone only over empty content area, not over file/folder rows
    if (e.target.closest('[data-file-path]')) return;
    if (isExternal || isInternalTree) {
      setContentAreaDragType(isExternal ? 'external' : 'internal');
      handleFileAreaDragEnter(e);
    }
  };

  const handleContentAreaDragLeave = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;

    const types = e.dataTransfer.types || [];
    const isExternal = types.includes('Files');
    const isInternalTree = types.includes('text/plain');

    if (isExternal || isInternalTree) {
      // Only clear type when actually leaving the content area (not when moving to a child element)
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setContentAreaDragType(null);
      }
      handleFileAreaDragLeave(e);
    }
  };

  const handleContentAreaDrop = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;

    const types = e.dataTransfer.types || [];
    const isExternal = types.includes('Files');
    const internalPath = types.includes('text/plain') ? e.dataTransfer?.getData?.('text/plain') : null;

    setContentAreaDraggedPath(null);
    setContentAreaDragType(null);

    if (internalPath) {
      e.preventDefault();
      e.stopPropagation();
      resetFileAreaDrag?.();
      handleInternalFileDrop(internalPath, currentPath);
      return;
    }

    if (isExternal) {
      handleFileAreaDrop(e, currentPath, handleExplorerDrop);
    }
  };

  // Desktop: click on empty space exits selection mode
  const handleScrollAreaClick = useCallback((e) => {
    if (isMobile || !selectionMode) return;
    if (e.target.closest('[data-file-path]')) return;
    handleDeselectAll();
    setSelectionMode(false);
  }, [isMobile, selectionMode, handleDeselectAll, setSelectionMode]);

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
      {(!isShareLinkMode || (isShareLinkMode && user)) ? (
        <FileManagerHeader
          isMobile={isMobile}
          user={user}
          navigate={navigate}
        />
      ) : (
        <AppBar
          position="sticky"
          sx={{
            top: 0,
            zIndex: (theme) => theme.zIndex.appBar,
            backgroundColor: 'transparent',
            backgroundImage: 'none',
          }}
          elevation={0}
        >
          <Toolbar>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                component="img"
                src="/logo_white.png"
                alt={t('nav.logoAlt')}
                sx={{
                  height: isMobile ? '27px' : '33.75px',
                  maxWidth: '100%',
                  objectFit: 'contain',
                }}
              />
            </Box>
            <Box
              id="file-progress-slot"
              sx={{
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                pr: 1,
              }}
            />
          </Toolbar>
        </AppBar>
      )}

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {!isMobile && (
          <Box
            sx={{
              width: 240,
              borderRight: 1,
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
              height: '100%',
            }}
          >
            <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <FolderTree
                currentPath={currentPath}
                onPathClick={isShareLinkMode ? handleLeaveSharePathClick : handlePathClick}
                onFileClick={handleFileClick}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
                hasWritePermission={hasWritePermission}
                onExplorerDrop={handleExplorerDrop}
                onInternalFileDrop={handleInternalFileDrop}
                onInternalDragStart={handleDragStartFromView}
                onInternalDragEnd={handleDragEndFromView}
                isMobile={false}
                shareLinkSection={isShareLinkMode ? {
                  shareRootPath,
                  shareRootName,
                  shareToken,
                  onShareLinkPathClick: handlePathClick,
                } : undefined}
              />
            </Box>
          </Box>
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
          {isFileAreaDraggingOver && hasWritePermission && !isShareLinkMode && (
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
                {contentAreaDragType === 'internal' ? t('fileManager.moveDropHere') : t('dialogs.uploadDropHere')}
              </Typography>
            </Box>
          )}

          <Breadcrumb
            currentPath={currentPath}
            onPathClick={handlePathClick}
            {...(isShareLinkMode ? { shareRootPath, shareRootName, showFolderTreeToggle: true } : { user })}
            {...(isMobile ? {
              onToggleFolderTree: () => setDrawerOpen(!drawerOpen),
              isFolderTreeOpen: drawerOpen,
            } : {})}
          />

          {isMobile && (
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
                    if (isShareLinkMode) {
                      handleLeaveSharePathClick(path);
                    } else {
                      handlePathClick(path);
                    }
                    setDrawerOpen(false);
                  }}
                  onFileClick={(file) => {
                    handleFileClick(file);
                    setDrawerOpen(false);
                  }}
                  user={user}
                  treeUpdateTrigger={treeUpdateTrigger}
                  hasWritePermission={hasWritePermission}
                  onExplorerDrop={handleExplorerDrop}
                  onInternalFileDrop={handleInternalFileDrop}
                  onInternalDragStart={handleDragStartFromView}
                  onInternalDragEnd={handleDragEndFromView}
                  isMobile
                  shareLinkSection={isShareLinkMode ? {
                    shareRootPath,
                    shareRootName,
                    shareToken,
                    onShareLinkPathClick: (path) => {
                      handlePathClick(path);
                      setDrawerOpen(false);
                    },
                  } : undefined}
                />
              </Box>
            </Collapse>
          )}

          <FileManagerControls
            isMobile={isMobile}
            selectionMode={selectionMode}
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
            handleBulkMove={handleBulkMove}
            handleBulkCopy={handleBulkCopy}
            handleBulkDownload={handleBulkDownload}
            openBulkDeleteDialog={openBulkDeleteDialog}
            bulkWritePermission={isShareLinkMode ? false : allSelectedHaveWrite}
            hasReadOnlyInSelection={hasReadOnlyInSelection}
            bulkActionsDisabled={bulkMoveCopyInProgress}
            downloadOnly={isShareLinkMode}
          />

          <Box
            ref={scrollContainerRef}
            onClick={handleScrollAreaClick}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 2,
              minHeight: 0,
              position: 'relative',
              // Avoid being hidden behind fixed bottom elements: FloatingSearchBar + FAB
              pb: `calc(${isMobile ? FLOATING_BOTTOM_HEIGHT_MOBILE : FLOATING_BOTTOM_HEIGHT_DESKTOP}px + env(safe-area-inset-bottom))`,
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
                onMoreClick={handleMoreClick}
                showMoreButton={!selectionMode}
                onLongPressSelect={handleLongPressSelect}
                onContextMenu={(e, file) => {
                  if (e?.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    // Long-press triggers contextmenu on mobile; do not open action sheet.
                    // Action sheet opens only via More button tap.
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                onDropPermissionDenied={handleDropPermissionDenied}
                onDragStart={handleDragStartFromView}
                onDragEnd={handleDragEndFromView}
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
                shareToken={isShareLinkMode ? shareToken : undefined}
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={displayedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onMoreClick={handleMoreClick}
                showMoreButton={!selectionMode}
                onLongPressSelect={handleLongPressSelect}
                onContextMenu={(e, file) => {
                  if (e?.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    // Long-press triggers contextmenu on mobile; do not open action sheet.
                    // Action sheet opens only via More button tap.
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                onDropPermissionDenied={handleDropPermissionDenied}
                onDragStart={handleDragStartFromView}
                onDragEnd={handleDragEndFromView}
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
                shareToken={isShareLinkMode ? shareToken : undefined}
              />
            ) : (
              <FileDetail
                files={displayedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onMoreClick={handleMoreClick}
                showMoreButton={!selectionMode}
                onLongPressSelect={handleLongPressSelect}
                onContextMenu={(e, file) => {
                  if (e?.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    // Long-press triggers contextmenu on mobile; do not open action sheet.
                    // Action sheet opens only via More button tap.
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                onDropPermissionDenied={handleDropPermissionDenied}
                onDragStart={handleDragStartFromView}
                onDragEnd={handleDragEndFromView}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
                shareToken={isShareLinkMode ? shareToken : undefined}
              />
            )}
          </Box>
        </Box>
      </Box>

      {!isShareLinkMode && (
        <>
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
        </>
      )}

      <FilePreviewDialog
        open={previewDialogOpen}
        onClose={() => {
          closePreviewDialog();
          setSelectedFile(null);
        }}
        file={selectedFile}
        mediaFiles={mediaFiles}
        shareToken={isShareLinkMode ? shareToken : undefined}
        onThumbnailsLoaded={handleThumbnailsLoaded}
      />

      {isShareLinkMode && (
        <LoginDialog open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />
      )}
      {isShareLinkMode && user && (
        <ConfirmDialog
          open={addToSharedModalOpen}
          onClose={() => setAddToSharedModalOpen(false)}
          variant={addToSharedStatus === 'loading' ? 'loading' : undefined}
          title={t('dialogs.shareLink')}
          message={t('dialogs.addToSharedConfirm')}
          confirmText={addToSharedConfirmLoading ? t('common.adding') : t('common.confirm')}
          cancelText={t('common.cancel')}
          loading={addToSharedConfirmLoading}
          onConfirm={handleAddToSharedConfirm}
        />
      )}

      <ConfirmDialog
        open={leaveShareConfirmOpen}
        onClose={() => {
          setLeaveShareConfirmOpen(false);
          setLeaveShareConfirmTargetPath(null);
        }}
        onConfirm={handleLeaveShareConfirm}
        title={t('common.confirm')}
        message={t('dialogs.leaveShareConfirm')}
        confirmText={t('common.move')}
        cancelText={t('common.cancel')}
      />

      <FileContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        file={selectedFile}
        user={user}
        hasWritePermission={isShareLinkMode ? false : hasWritePermission}
        onDownload={(file) => {
          setContextMenu(null);
          handleFileDownloadOp(file);
        }}
        onRename={isShareLinkMode ? undefined : (file) => {
          setContextMenu(null);
          openRenameDialog(file);
        }}
        onMove={isShareLinkMode ? undefined : (file) => {
          setContextMenu(null);
          setMobilePickerFile(file);
          setMobilePickerAction('move');
          setFolderPickerAction('move');
          setFolderPickerOpen(true);
        }}
        onCopy={isShareLinkMode ? undefined : (file) => {
          setContextMenu(null);
          setMobilePickerFile(file);
          setMobilePickerAction('copy');
          setFolderPickerAction('copy');
          setFolderPickerOpen(true);
        }}
        onShare={isShareLinkMode ? undefined : (file) => {
          setContextMenu(null);
          openShareDialogV2(file);
        }}
        onProperties={isShareLinkMode ? undefined : (file) => {
          setContextMenu(null);
          openPropertiesDialog(file);
        }}
        onDelete={isShareLinkMode ? undefined : (file) => {
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
            ? `${mobilePickerAction === 'move' ? t('actions.move') : t('actions.copy')}: ${mobilePickerFile.basename}`
            : folderPickerAction === 'move' ? t('dialogs.moveFolderSelect') : t('dialogs.copyFolderSelect')
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

      <FileOperationProgress
        items={progressItems}
        drawerOpen={progressDrawerOpen}
        onDrawerOpen={() => setProgressDrawerOpen(true)}
        onDrawerClose={() => setProgressDrawerOpen(false)}
        onClose={(id) => {
          updateProgress({ id, remove: true });
        }}
        onRetry={handleRetryUpload}
        onCancelFile={handleCancelUploadFileWrapper}
        onCancelAll={handleCancelAllWrapper}
        showError={showError}
        showWarning={showWarning}
      />

      {/* FloatingSearchBar - shown when header is shown; expands to FAB space when FAB hidden (selection mode) */}
      {(!isShareLinkMode || (isShareLinkMode && user)) && (
        <FloatingSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isMobile={isMobile}
          fabVisible={!selectionMode}
        />
      )}

      {/* FAB - all viewports */}
      {!selectionMode && (
        isShareLinkMode ? (
          <FAB
            shareLinkMode={{
              user,
              onLoginClick: () => setLoginModalOpen(true),
              onAddToSharedClick: openAddToSharedModal,
            }}
            isMobile={isMobile}
          />
        ) : (
          <FAB
            onUpload={openUploadDialog}
            onCreateFolder={openCreateFolderDialog}
            hasWritePermission={hasWritePermission}
            isMobile={isMobile}
          />
        )
      )}

      {/* Mobile Action Sheet */}
      {isMobile && (
        <FileActionSheet
          open={actionSheetOpen}
          onClose={closeActionSheet}
          file={actionSheetFile}
          hasWritePermission={isShareLinkMode ? false : hasWritePermission}
          user={user}
          onDownload={handleActionSheetDownload}
          onRename={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              openRenameDialog(actionSheetFile);
            }
          }}
          onMove={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('move');
              setFolderPickerAction('move');
              setFolderPickerOpen(true);
            }
          }}
          onCopy={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('copy');
              setFolderPickerAction('copy');
              setFolderPickerOpen(true);
            }
          }}
          onDelete={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              openBulkDeleteDialog([actionSheetFile.path]);
            }
          }}
          onShare={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              openShareDialogV2(actionSheetFile);
            }
          }}
          onPreview={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              const filename = actionSheetFile.basename || actionSheetFile.name;
              const canPreviewFile = canPreview(filename);
              setSelectedFile({ ...actionSheetFile, name: filename, canPreview: canPreviewFile });
              openPreviewDialog();
            }
          }}
          onProperties={isShareLinkMode ? undefined : () => {
            if (actionSheetFile) {
              openPropertiesDialog(actionSheetFile);
            }
          }}
        />
      )}

      {!isShareLinkMode && (
        <>
          <RenameDialog
            open={renameDialogOpen}
            onClose={closeRenameDialog}
            value={renameNewName}
            onChange={setRenameNewName}
            error={renameError}
            onClearError={() => setRenameError('')}
            loading={renameLoading}
            onConfirm={handleRename}
            fullScreen={isMobile}
          />
          {shareDialogV2File && (
            <ShareTargetDialog
              open={shareDialogV2Open}
              onClose={closeShareDialogV2}
              file={shareDialogV2File}
              user={user}
              onMessage={setDropMessage}
              onSave={() => {
                handleOperationComplete({ opType: 'refresh', startedPath: currentPathRef.current });
              }}
            />
          )}
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
          <ConfirmDialog
            open={bulkDeleteDialogOpen}
            onClose={closeBulkDeleteDialog}
            onConfirm={handleBulkDeleteConfirm}
            title={t('dialogs.deleteConfirm')}
            message={t('dialogs.bulkDeleteMessage', { count: bulkDeleteFilePaths.length })}
            confirmText={t('common.delete')}
            cancelText={t('common.cancel')}
            confirmColor="error"
          />
          <ConflictResolveDialog
            open={!!bulkConflictData}
            onClose={() => setBulkConflictData(null)}
            onResolve={resolveBulkConflict}
            conflicts={bulkConflictData?.conflicts || []}
            operationType={bulkConflictData?.action === 'move' ? t('actions.move') : t('actions.copy')}
          />
          <ConflictResolveDialog
            open={!!uploadConflictData}
            onClose={() => setUploadConflictData(null)}
            onResolve={resolveUploadConflict}
            conflicts={uploadConflictData?.conflicts || []}
            operationType={t('dialogs.uploadOperation')}
          />
        </>
      )}

      {/* FilePropertiesDialog: 공유 링크에서도 속성 노출 */}
      {propertiesFile && (
        <FilePropertiesDialog
          open={propertiesDialogOpen}
          onClose={closePropertiesDialog}
          file={propertiesFile}
        />
      )}
    </Box>
  );
};

export default FileManager;
