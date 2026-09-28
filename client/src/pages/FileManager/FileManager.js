import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import explorerGateway from '../../services/explorerGateway';
import * as adminService from '../../services/adminService';
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
import { resolvePath } from '../../services/fileService';
import { normalizePath, getBasename, getParentPath } from '../../utils/pathUtils';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import { getEntryKey } from '../../utils/fileViewUtils';

import { useRecentFile } from './hooks/useRecentFile';
import { useCollections } from './hooks/useCollections';
import { useSearchResults } from './hooks/useSearchResults';
import { useUndoToast } from '../../hooks/useUndoToast';
import { getServerErrorDisplay } from '../../utils/errorUtils';
import MemberRowControls from '../../components/file-manager/MemberRowControls';
import AddToCollectionMenu from '../../components/file-manager/AddToCollectionMenu';
import { ConfirmDialog, RenameDialog } from '../../components/dialogs';
import { useFileManagerDialogs } from './hooks/useFileManagerDialogs';
import { useTrashOperations } from './hooks/useTrashOperations';
import { useContentAreaDragDrop } from './hooks/useContentAreaDragDrop';
import FileManagerView from '../../components/file-manager/FileManagerView';

// Public health re-poll: a backend failure recorded mid-session (failed upload,
// download, etc.) must flip the banner without a page remount.
const HEALTH_POLL_INTERVAL_MS = 15000;

const FileManager = ({ shareToken, linkInfo } = {}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [contentAreaDraggedNodeId, setContentAreaDraggedNodeId] = useState(null);
  const [contentAreaDraggedParentNodeId, setContentAreaDraggedParentNodeId] = useState(null);
  const [contentAreaDragType, setContentAreaDragType] = useState(null);
  const [backendHealthStatuses, setBackendHealthStatuses] = useState(null);
  const [activeFileStorage, setActiveFileStorage] = useState(null);
  const [activeMetadataBackend, setActiveMetadataBackend] = useState(null);

  const isShareLinkMode = Boolean(shareToken && linkInfo);
  const shareRootPath = useMemo(
    () => (linkInfo ? normalizePath(linkInfo.displayPath || '/') : ''),
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

  const messageBundle = useMessage();
  const { message, showError, showWarning, clearMessage } = messageBundle;
  // undo-toast host ref: mounted controllers forward through it (defined once
  // useUndoToast mounts below; identity stays stable across the shell).
  const showUndoToastRef = useRef(null);
  const {
    addToSharedModalOpen,
    setAddToSharedModalOpen,
    addToSharedStatus,
    addToSharedConfirmLoading,
    openAddToSharedModal,
    handleAddToSharedConfirm,
    leaveShareConfirmOpen,
    setLeaveShareConfirmOpen,
    leaveShareConfirmTargetNodeId,
    setLeaveShareConfirmTargetNodeId,
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
    currentNodeId,
    setCurrentNodeId,
    ancestors,
    files: filesFromHook,
    loading,
    loadFiles,
    hasWritePermission,
    onLoadErrorRef,
    trashTrail,
    openTrashFolder,
    collectionMembers,
    loadMoreCollectionMembers,
  } = useFileManager(user, {
    onLoadComplete: handleLoadCompleteCallback,
    onLoadError: null, // 나중에 설정
    shareToken,
    linkInfo,
  });

  // currentPathRef는 useFileManager 호출 후에 정의 (currentPath가 필요)
  const currentPathRef = useRef(null);
  const currentNodeIdRef = useRef(null);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    currentNodeIdRef.current = currentNodeId;
  }, [currentNodeId]);

  // DEF-16 P9: trash view is a product overlay route of the explorer shell.
  const isTrashView = currentPath === '/__trash__';

  // -- AI-platform search-results controller (T0.11; FileManager §7) ---------
  // Mounted here (before the session) so the session's onSubmitQuery passthrough
  // can delegate submits (D1). Save-from-results confirmation copy rides T1.5;
  // the P0 wiring only calls the hook-owned save seams.
  const searchApi = useSearchResults({
    showError,
    gateway: isShareLinkMode ? undefined : explorerGateway,
    onUndoable: (undo) => {
      showUndoToastRef.current?.({
        actionId: undo?.action_id,
        text: t('collections.undoCreated'),
      });
    },
  });
  const {
    sessionKey,
    files,
    setFiles,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
    viewMode,
    setViewMode,
    sortedFiles,
    displayedFiles,
    loadMoreRef,
    hasMore,
    handleThumbnailsLoaded,
    onSubmitQuery: submitSearch,
  } = useExplorerSession({
    currentNodeId,
    view: isTrashView
      ? 'trash'
      : currentPath === '/__recent__'
        ? 'recent'
        : currentPath === '/__shared__'
          ? 'shared'
          : 'folder',
    files: filesFromHook,
    isMobile,
    onSubmitQuery: isShareLinkMode ? undefined : searchApi.submitSearch,
  });

  // Clearing the shared search text exits results mode (FloatingSearchBar §3.2:
  // one ✕ clears the inline filter AND the results surface).
  const handleSearchQueryChange = useCallback(
    (query) => {
      setSearchQuery(query);
      if (!String(query ?? '').trim() && searchApi.mode === 'results') {
        searchApi.exitResults();
      }
    },
    [setSearchQuery, searchApi]
  );

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

  // key(entryKey)→file 인덱스: 선택 Set의 reverse-lookup을 O(1)로 수행 (선택 크기 × 파일 수의 find 중복 제거)
  const sortedFilesByKey = useMemo(() => {
    const map = new Map();
    for (const f of sortedFiles) {
      const key = getEntryKey(f);
      if (!map.has(key)) map.set(key, f);
    }
    return map;
  }, [sortedFiles]);

  // 선택 모드에서 삭제/이동 버튼: 선택된 항목 모두 write 권한이 있어야 활성화
  const allSelectedHaveWrite = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    return Array.from(selectedFiles).every((key) => {
      const f = sortedFilesByKey.get(key);
      return !!f && f.hasWritePermission === true;
    });
  }, [selectionMode, selectedFiles, sortedFilesByKey]);

  // 선택된 항목 중 읽기 전용(hasWritePermission === false) 포함 여부
  const hasReadOnlyInSelection = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    return Array.from(selectedFiles).some((key) => {
      const f = sortedFilesByKey.get(key);
      return !!f && f.hasWritePermission === false;
    });
  }, [selectionMode, selectedFiles, sortedFilesByKey]);

  // 디렉토리 이동 시 선택 모드 해제
  useEffect(() => {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }, [sessionKey, setSelectionMode, setSelectedFiles]);
  const {
    uploadDialogOpen,
    openUploadDialog,
    closeUploadDialog,
    createFolderDialogOpen,
    openCreateFolderDialog,
    closeCreateFolderDialog,
    previewDialogOpen,
    setPreviewDialogOpen,
    openPreviewDialog,
    closePreviewDialog,
    renameDialogOpen,
    openRenameDialog,
    closeRenameDialog,
    shareDialogOpen,
    closeShareDialog,
    shareDialogV2Open,
    shareDialogV2File,
    openShareDialogV2,
    closeShareDialogV2,
    propertiesDialogOpen,
    openPropertiesDialog,
    closePropertiesDialog,
    bulkDeleteDialogOpen,
    openBulkDeleteDialog,
    closeBulkDeleteDialog,
    actionSheetOpen,
    setActionSheetOpen,
    closeActionSheet,
    actionSheetFile,
    setActionSheetFile,
    selectedFile,
    setSelectedFile,
    contextMenu,
    setContextMenu,
    renameNewName,
    setRenameNewName,
    renameError,
    setRenameError,
    mobileRenameFile,
    mobileShareFile,
    mobilePropertiesFile,
    bulkDeleteFilePaths,
    mobilePickerFile,
    setMobilePickerFile,
    mobilePickerAction,
    setMobilePickerAction,
  } = useFileManagerDialogs();

  // Resolve file from current state to support live updates (e.g. thumbnails loading in background)
  const propertiesFile = useMemo(() => {
    const source = mobilePropertiesFile || actionSheetFile;
    if (!source) return null;
    return files.find((f) => getEntryKey(f) === getEntryKey(source)) || source;
  }, [files, mobilePropertiesFile, actionSheetFile]);

  // 미리보기 갤러리용 미디어 파일 목록 (같은 노드/경로의 이미지/비디오)
  const mediaFiles = useMemo(() => {
    if (!selectedFile) return [];
    if (currentPath === '/__shared__') {
      return sortedFiles.filter(
        (f) =>
          f.type === 'file' &&
          (getFileType(f.basename || f.name) === 'image' ||
            getFileType(f.basename || f.name) === 'video')
      );
    }
    const isMedia = (f) =>
      f.type === 'file' &&
      (getFileType(f.basename || f.name) === 'image' ||
        getFileType(f.basename || f.name) === 'video');
    const parentNodeId = selectedFile.parentNodeId ?? null;
    if (parentNodeId != null) {
      return sortedFiles.filter((f) => (f.parentNodeId ?? null) === parentNodeId && isMedia(f));
    }
    const parentPath = getParentPath(selectedFile.path);
    return sortedFiles.filter((f) => getParentPath(f.path) === parentPath && isMedia(f));
  }, [sortedFiles, selectedFile, currentPath]);

  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });

  const {
    trackRecentFileClick,
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
  // 파일 로드 성공 시 경로 히스토리 정리
  useEffect(() => {
    if (!loading && files.length >= 0 && currentPath) {
      // 로딩이 완료되고 파일 목록이 로드되었으면 정상적인 이동으로 간주
      // 히스토리에서 제거 (에러가 발생하지 않았음)
      clearPathHistory(currentPath);
    }
  }, [loading, files, currentPath, clearPathHistory]);

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
    handleOperationComplete,
  } = useExplorerCommands({
    t,
    user,
    isMobile,
    isShareLinkMode,
    shareToken,
    currentPath,
    currentPathRef,
    currentNodeId,
    currentNodeIdRef,
    refreshNow: loadFiles,
    getCurrentNodeIdNow: () => currentNodeIdRef.current,
    hasWritePermission,
    selectedFiles,
    sortedFiles,
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

  // DEF-16 P9: trash operations (restore / purge / empty trash). Bulk flows
  // reuse the shared FileOperationProgress seam; confirm dialogs are rendered
  // by the view from the trash confirm state.
  const {
    restoreConfirmState,
    purgeConfirmState,
    emptyTrashConfirmOpen,
    openRestoreConfirm,
    openPurgeConfirm,
    openEmptyTrashConfirm,
    closeRestoreConfirm,
    closePurgeConfirm,
    closeEmptyTrashConfirm,
    confirmRestore,
    confirmPurge,
    confirmEmptyTrash,
    handleTrashRestore,
    handleTrashPurge,
  } = useTrashOperations({
    t,
    showError,
    refreshNow: loadFiles,
    updateProgress,
    setDropMessage,
  });

  const { navigateToNode: navigateToExplorerNode, handleFolderOpen: openExplorerFolder } =
    useExplorerNavigation({
      currentNodeId,
      getPreviousNodeId: () => currentNodeIdRef.current,
      setCurrentNodeId,
      canNavigateToNode: user?.is_admin ? async () => true : explorerGateway.canNavigateToNode,
    });

  // -- AI-platform collections overlay (§7): virtual-route flags --------------
  const isCollectionsRoute = currentPath === '/__collections__';
  const isCollectionsArchiveRoute = currentPath === '/__collections__/__archive__';
  const isCollectionsMemberRoute = (currentPath || '').startsWith('/__collections__/collection/');
  const isCollectionsOverlay =
    !isShareLinkMode &&
    (isCollectionsRoute || isCollectionsArchiveRoute || isCollectionsMemberRoute);
  const collectionsInclude = isCollectionsArchiveRoute ? 'mine,archived' : 'mine,shared';

  // Share-link embedding must NOT mount the collections overlay (FileManager §7);
  // the hook itself is unconditional (rules of hooks), so an inert gateway seam
  // keeps it IO-silent outside the authenticated explorer.
  const INERT_COLLECTIONS_GATEWAY = useMemo(
    () => ({
      loadCollections: async () => ({ collections: [] }),
      getMergeSuggestions: async () => ({ suggestions: [] }),
      subscribeToCollections: () => () => {},
    }),
    []
  );

  const collectionsRefreshRef = useRef(null);
  const {
    showUndoToast,
    cascadeConfirm,
    busy: undoBusy,
  } = useUndoToast({
    message: messageBundle,
    refresh: () => collectionsRefreshRef.current?.(),
  });

  const handleUndoable = useCallback(
    (payload, textKey, params) => {
      showUndoToast({
        actionId: payload?.undo?.action_id,
        text: params ? t(textKey, params) : t(textKey),
      });
    },
    [showUndoToast, t]
  );

  const collectionsApi = useCollections({
    showError,
    gateway: isShareLinkMode ? INERT_COLLECTIONS_GATEWAY : undefined,
    onUndoable: handleUndoable,
    include: collectionsInclude,
  });
  collectionsRefreshRef.current = collectionsApi.refresh;
  showUndoToastRef.current = showUndoToast;

  const [collectionRenameTarget, setCollectionRenameTarget] = useState(null);
  const [collectionRenameValue, setCollectionRenameValue] = useState('');
  const [collectionRenameError, setCollectionRenameError] = useState('');

  const handleCardAction = useCallback(
    async (action, collection) => {
      const collectionId = collection?.collection_id;
      switch (action) {
        case 'open':
          setCurrentPath(`/__collections__/collection/${collectionId}`);
          break;
        case 'rename':
          setCollectionRenameTarget(collection);
          setCollectionRenameValue(collection?.name ?? '');
          setCollectionRenameError('');
          break;
        case 'pin':
          collectionsApi.setPinned(collectionId, true);
          break;
        case 'unpin':
          collectionsApi.setPinned(collectionId, false);
          break;
        case 'archive':
          collectionsApi.archiveCollection(collectionId);
          break;
        case 'restore':
          collectionsApi.restoreCollection(collectionId);
          break;
        case 'sharing':
          // CollectionPropertiesDialog (Sharing tab) lands with T3.x — dispatch
          // seam reserved; the menu entry is contractual (CollectionsListView §2.4).
          break;
        case 'delete-permanent': {
          const ok = await collectionsApi.deleteCollectionPermanent(collectionId);
          if (ok) messageBundle.showSuccess(t('collections.permanentDeleteReport'));
          break;
        }
        case 'leave':
          // Recipient-local hide is view-local session state (as-built §2.4).
          break;
        default:
          break;
      }
    },
    [collectionsApi, setCurrentPath, messageBundle, t]
  );

  const handleCollectionRenameConfirm = useCallback(async () => {
    if (!collectionRenameTarget) return;
    const name = collectionRenameValue.trim();
    if (!name) {
      setCollectionRenameError(t('serverErrors.collections.nameRequired'));
      return;
    }
    const payload = await collectionsApi.renameCollection(
      collectionRenameTarget.collection_id,
      name
    );
    if (payload !== null) setCollectionRenameTarget(null);
  }, [collectionRenameTarget, collectionRenameValue, collectionsApi, t]);

  // T0.5 file-side collection entry points (docs/spec/client/components/
  // file-manager/AddToCollectionMenu.md §2.2): the explorer context menu
  // dispatches `Add to collection` here and the shell owns the single submenu
  // instance (same idiom as MemberRowControls/FileContextMenu). The §4.5 seed
  // row stays gated off (`seedItemVisible=false`): P0 ships no embed
  // capability and no aiFlags client seam (absent-not-disabled, §4.12).
  const [addMenu, setAddMenu] = useState(null); // { targetNodes, position }

  const handleOpenAddToCollection = useCallback((file, position) => {
    const nodeId = file?.nodeId ?? file?.node_id;
    if (nodeId == null) return;
    setAddMenu({
      targetNodes: [{ nodeId, name: file?.name ?? file?.basename ?? null }],
      position: position ?? null,
    });
  }, []);

  const closeAddMenu = useCallback(() => setAddMenu(null), []);

  const writableCollections = useMemo(
    () =>
      collectionsApi.collections.filter(
        (collection) => collection.granted_role == null || collection.granted_role === 'editor'
      ),
    [collectionsApi.collections]
  );

  const handleAddMenuAdd = useCallback(
    async (collectionId, nodeIds) => {
      let envelope = null;
      const payload = await explorerGateway.addCollectionItems(collectionId, nodeIds, {
        onError: (error) => {
          envelope = error;
        },
      });
      if (payload === null) {
        showError(getServerErrorDisplay(envelope, t));
        return;
      }
      const rejected = Array.isArray(payload.rejected_not_readable)
        ? payload.rejected_not_readable.length
        : 0;
      if (rejected > 0) {
        messageBundle.showInfo(t('fileManager.addRejectedNotReadable', { count: rejected }));
      }
      if (payload?.undo?.action_id != null) {
        handleUndoable(payload, 'collections.undoAdded');
      }
    },
    [showError, t, messageBundle, handleUndoable]
  );

  const handleAddMenuCreateAndAdd = useCallback(
    async (name, nodeIds) => {
      let envelope = null;
      const created = await explorerGateway.createCollection(
        { name },
        {
          onError: (error) => {
            envelope = error;
          },
        }
      );
      if (created === null) {
        showError(getServerErrorDisplay(envelope, t));
        return;
      }
      // One command, one undo toast (spec §2.7): the create row's inverse
      // removes the collection together with its just-added members.
      await explorerGateway.addCollectionItems(created.collection.collection_id, nodeIds);
      handleUndoable(created, 'collections.undoCreated');
    },
    [showError, t, handleUndoable]
  );

  // Member-row menus are the T0.5 MemberRowControls seam; publish batch uses the
  // loaded unpublished rows (the §4.7 banner action). The shell owns the single
  // menu instance (CollectionsListView §2.5 — FileContextMenu idiom).
  const [memberMenu, setMemberMenu] = useState(null); // { anchorEl, member }

  const handleMemberAction = useCallback((action, row, anchorEl) => {
    if (action === 'menu') {
      setMemberMenu({ anchorEl, member: row });
    }
  }, []);

  const closeMemberMenu = useCallback(() => setMemberMenu(null), []);

  const memberCollection = useMemo(
    () =>
      collectionsApi.collections.find(
        (collection) => collection.collection_id === collectionMembers.collectionId
      ) ?? null,
    [collectionsApi.collections, collectionMembers.collectionId]
  );

  // -- T0.5 like state: optimistic flip on the session rows + menu row; the
  // repository notifier drives the server-truth re-read (FileManager §7).
  const applyLikedToRows = useCallback(
    (nodeId, liked) => {
      setFiles((prev) => prev.map((f) => (f?.nodeId === nodeId ? { ...f, liked } : f)));
      setMemberMenu((prev) =>
        prev && (prev.member?.nodeId ?? prev.member?.node_id) === nodeId
          ? { ...prev, member: { ...prev.member, liked } }
          : prev
      );
    },
    [setFiles]
  );

  const handleToggleLike = useCallback(
    async (file) => {
      const nodeId = file?.nodeId ?? file?.node_id;
      if (nodeId == null) return;
      const next = file?.liked !== true;
      applyLikedToRows(nodeId, next);
      let envelope = null;
      const payload = await explorerGateway.setFileLike(nodeId, next, {
        onError: (error) => {
          envelope = error;
        },
      });
      if (payload === null) {
        applyLikedToRows(nodeId, !next);
        showError(getServerErrorDisplay(envelope, t));
      }
    },
    [applyLikedToRows, showError, t]
  );

  useEffect(() => {
    if (isShareLinkMode) return undefined;
    return explorerGateway.subscribeToFileLikes(() => {
      loadFiles();
    });
  }, [isShareLinkMode, loadFiles]);

  const handleMemberExclude = useCallback(
    async (member) => {
      const nodeId = member?.nodeId ?? member?.node_id;
      if (nodeId == null || collectionMembers.collectionId == null) return;
      let envelope = null;
      const payload = await explorerGateway.removeCollectionItems(
        collectionMembers.collectionId,
        [nodeId],
        {
          onError: (error) => {
            envelope = error;
          },
        }
      );
      if (payload === null) {
        showError(getServerErrorDisplay(envelope, t));
        return;
      }
      loadFiles();
      if (payload?.undo?.action_id != null) {
        handleUndoable(payload, 'collections.undoExcluded');
      }
    },
    [collectionMembers.collectionId, showError, t, loadFiles, handleUndoable]
  );

  const handleMemberPublish = useCallback(
    async (member) => {
      const nodeId = member?.nodeId ?? member?.node_id;
      if (nodeId == null || collectionMembers.collectionId == null) return;
      const payload = await explorerGateway.publishItems(collectionMembers.collectionId, [nodeId]);
      if (payload !== null) loadFiles();
    },
    [collectionMembers.collectionId, loadFiles]
  );

  const handleMemberDownload = useCallback(
    (member) => {
      const nodeId = member?.nodeId ?? member?.node_id;
      if (nodeId == null) return;
      handleFileDownloadOp({
        nodeId,
        name: member.name ?? member.basename ?? null,
        basename: member.basename ?? member.name ?? null,
        type: member.type ?? 'file',
      });
    },
    [handleFileDownloadOp]
  );

  const handleMemberShowOriginal = useCallback(
    async (member) => {
      const nodeId = member?.nodeId ?? member?.node_id;
      if (nodeId == null) return;
      try {
        const data = await explorerGateway.loadNodeAncestors(nodeId);
        const chain = Array.isArray(data?.ancestors) ? data.ancestors : [];
        const parent = chain.length > 1 ? chain[chain.length - 2] : null;
        if (parent?.nodeId != null) {
          navigateToExplorerNode(parent.nodeId);
        }
      } catch (error) {
        showError(
          getServerErrorDisplay(
            {
              errorCode: error?.response?.data?.errorCode,
              params: error?.response?.data?.params ?? {},
            },
            t
          )
        );
      }
    },
    [navigateToExplorerNode, showError, t]
  );

  const handleMemberProperties = useCallback(
    (member) => {
      const nodeId = member?.nodeId ?? member?.node_id;
      if (nodeId == null) return;
      openPropertiesDialog({
        nodeId,
        name: member.name ?? member.basename ?? null,
        basename: member.basename ?? member.name ?? null,
        type: member.type ?? 'file',
        size: member.size ?? null,
        lastmod: member.lastmod ?? null,
        mime: member.mime ?? null,
        path: member.path ?? '',
      });
    },
    [openPropertiesDialog]
  );

  const handlePublishBatch = useCallback(async () => {
    const pending = collectionMembers.items.filter((row) => row.published === false);
    if (!pending.length || collectionMembers.collectionId == null) return;
    const payload = await explorerGateway.publishItems(
      collectionMembers.collectionId,
      pending.map((row) => row.nodeId)
    );
    if (payload !== null) loadFiles();
  }, [collectionMembers, loadFiles]);

  const collectionsModel = useMemo(() => {
    if (!isCollectionsOverlay) return null;
    if (isCollectionsMemberRoute) {
      return {
        mode: 'members',
        items: collectionMembers.items,
        nextCursor: collectionMembers.nextCursor,
        onLoadMore: loadMoreCollectionMembers,
        digest: collectionMembers.digest,
        publishPendingCount: collectionMembers.publishPendingCount,
        onMemberAction: handleMemberAction,
        onPublishBatch: handlePublishBatch,
      };
    }
    return {
      mode: 'list',
      collections: collectionsApi.collections,
      sort: collectionsApi.sort,
      onSortChange: collectionsApi.setSort,
      include: collectionsInclude,
      // MergeProposalCard lands with T1.6+/T2.x — zero pending ⇒ zero footprint;
      // suggestions data is already fetched by useCollections for that host.
      mergeSlot: null,
      onCardAction: handleCardAction,
    };
  }, [
    isCollectionsOverlay,
    isCollectionsMemberRoute,
    collectionMembers,
    loadMoreCollectionMembers,
    collectionsApi.collections,
    collectionsApi.sort,
    collectionsApi.setSort,
    collectionsInclude,
    handleCardAction,
    handleMemberAction,
    handlePublishBatch,
  ]);

  // -- T0.11 search-results model (FileManager §7): the shell prepares the
  // results view-model; the view swaps regions off it. Rows open through the
  // recordEntryClick seam (§3.4) and the metadata-enriched entry type
  // (directory → navigate + exit; file → preview overlay).
  const handleSearchRowOpen = useCallback(
    async (row) => {
      const nodeId = row?.node_id ?? row?.nodeId;
      if (nodeId == null) return;
      searchApi.recordEntryClick(nodeId);
      let type = row.type;
      if (!type) {
        const meta = await explorerGateway.loadNodesMetadata([nodeId]);
        type = meta?.[0]?.type ?? 'file';
      }
      if (type === 'directory') {
        searchApi.exitResults();
        navigateToExplorerNode(nodeId);
        return;
      }
      const entry = {
        nodeId,
        name: row.name,
        basename: row.name,
        type: 'file',
        size: 0,
        path: '',
      };
      // The preview surface renders from the selected-file target (list-flow
      // parity) — prepare it before opening the dialog.
      setSelectedFile(entry);
      openPreviewDialog(entry);
    },
    [searchApi, navigateToExplorerNode, openPreviewDialog, setSelectedFile]
  );

  const searchResults = useMemo(() => {
    if (isShareLinkMode || searchApi.mode !== 'results') return null;
    return {
      mode: searchApi.mode,
      query: searchApi.submittedQuery ?? searchQuery,
      counts: searchApi.counts,
      sections: {
        nameMatches: searchApi.nameMatches,
        semantic: searchApi.semantic,
      },
      canSaveToCollection: searchApi.canSaveToCollection,
      recentQueries: searchApi.recentQueries,
      onExit: searchApi.exitResults,
      onFilterChange: searchApi.setFilterText,
      onChipSelect: (chip) => {
        if (chip?.query) {
          setSearchQuery(chip.query);
          searchApi.submitSearch(chip.query);
        }
      },
      onSave: () => searchApi.saveResultsToCollection(searchApi.submittedQuery ?? ''),
      onChipSave: (chip) => searchApi.saveChipQuery(chip),
      onRowOpen: handleSearchRowOpen,
    };
  }, [isShareLinkMode, searchApi, searchQuery, setSearchQuery, handleSearchRowOpen]);

  const handleProductPathClick = useCallback(
    async (path, file) => {
      if (!path) return false;

      if (isShareLinkMode) {
        const normalizedPath = normalizePath(path);
        // nodeId-first share navigation (C2.5): navigate by the clicked folder nodeId
        // when available; the path only drives the breadcrumb display.
        if (file?.nodeId != null) {
          setCurrentNodeId(file.nodeId);
        }
        setCurrentPath(normalizedPath);
        if (isMobile) setDrawerOpen(false);
        return true;
      }

      if (path === '/__shared__' || path === '/__recent__' || path === '/__trash__') {
        setCurrentPath(path);
        return true;
      }

      return false;
    },
    [isShareLinkMode, isMobile, setCurrentPath, setDrawerOpen, setCurrentNodeId]
  );

  // Path-based navigation entry (recent files / legacy fallbacks): resolve the path to a
  // nodeId via the legacy resolver and navigate by nodeId. Throws so recent-file error
  // handling can react to NOT_FOUND.
  const navigateToExplorerPath = useCallback(
    async (path) => {
      if (!path) return undefined;
      const normalizedPath = normalizePath(path);
      if (
        normalizedPath === '/__recent__' ||
        normalizedPath === '/__shared__' ||
        normalizedPath === '/__trash__'
      ) {
        return handleProductPathClick(normalizedPath);
      }
      const data = await resolvePath(normalizedPath);
      if (data?.nodeId != null) {
        return navigateToExplorerNode(data.nodeId);
      }
      setCurrentNodeId(null);
      return undefined;
    },
    [handleProductPathClick, navigateToExplorerNode, setCurrentNodeId]
  );

  // Trash-view breadcrumb handler: trashed folder chips navigate INSIDE the
  // trash view via openTrashFolder (trashed nodes are invisible to the normal
  // resolve path — DEF-16 P4 gating), the Trash root chip re-enters the
  // topmost listing. Kept OUT of handleFolderTreeNodeClick on purpose: the
  // generic handler also serves the tree, where Home (non-admin homeNodeId)
  // and shared-folder items are numbers too — a trash-view branch there
  // hijacked every numeric tree click into the trash view (P9 regression).
  const handleTrashBreadcrumbClick = useCallback(
    (target) => {
      if (typeof target === 'number') {
        openTrashFolder(target);
        return;
      }
      setCurrentPath(target);
    },
    [openTrashFolder, setCurrentPath]
  );

  // NodeId-first navigation entry used by the folder tree and breadcrumb.
  // Accepts a nodeId (number), a virtual-root route ('/__shared__' | '/__recent__'),
  // or null (home). Share mode navigates exclusively by nodeId; legacy path
  // targets are only handled outside share mode via resolve-path.
  const handleFolderTreeNodeClick = useCallback(
    async (target) => {
      if (isShareLinkMode) {
        if (typeof target === 'number') {
          setCurrentNodeId(target);
          if (isMobile) setDrawerOpen(false);
          return;
        }
        if (typeof target === 'string' && target) {
          const normalizedPath = normalizePath(target);
          if (
            normalizedPath === '/__shared__' ||
            normalizedPath === '/__recent__' ||
            normalizedPath === '/__trash__'
          ) {
            setCurrentPath(normalizedPath);
            if (isMobile) setDrawerOpen(false);
          }
        }
        return;
      }
      if (typeof target === 'string') {
        if (
          target === '/__shared__' ||
          target === '/__recent__' ||
          target === '/__trash__' ||
          target === '/__collections__' ||
          target.startsWith('/__collections__/')
        ) {
          setCurrentPath(target);
          return;
        }
        navigateToExplorerPath(target);
        return;
      }
      if (target == null) {
        setCurrentNodeId(null);
        return;
      }
      navigateToExplorerNode(target);
    },
    [
      isShareLinkMode,
      isMobile,
      setCurrentPath,
      setDrawerOpen,
      setCurrentNodeId,
      navigateToExplorerPath,
      navigateToExplorerNode,
    ]
  );

  const { handleFileClick, handleMoreClick, handleLongPressSelect, handleActionSheetPreview } =
    useExplorerInteraction({
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
      trashMode: isTrashView,
      onTrashFolderOpen: (file) => openTrashFolder(file.nodeId, file.basename || file.name),
      recentFileApi: {
        trackRecentFileClick,
        clearTracking,
        handleRecentFileError,
        setRecentFileToPreview,
      },
      handleProductPathClick,
    });

  const handleCreateFolderComplete = useCallback(
    (folderPath, folderName, createdNodeId) => {
      const parentNodeId = currentNodeIdRef.current;
      if (createdNodeId != null && parentNodeId != null) {
        setTreeUpdateTrigger({
          type: 'created',
          parentNodeId,
          nodeId: createdNodeId,
          name: folderName,
          timestamp: Date.now(),
        });
      }

      handleOperationComplete({ opType: 'createFolder', startedNodeId: parentNodeId });
      closeCreateFolderDialog();

      setTimeout(() => {
        setTreeUpdateTrigger({
          type: 'refresh',
          timestamp: Date.now(),
        });
      }, 500);
    },
    [setTreeUpdateTrigger, handleOperationComplete, closeCreateFolderDialog]
  );

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

  const handleDragStartFromView = useCallback(
    (nodeId) => {
      setContentAreaDraggedNodeId(nodeId ?? null);
      const file = files.find((f) => f.nodeId === nodeId);
      setContentAreaDraggedParentNodeId(file?.parentNodeId ?? null);
    },
    [files]
  );

  const handleDragEndFromView = useCallback(() => {
    setContentAreaDraggedNodeId(null);
    setContentAreaDraggedParentNodeId(null);
    setContentAreaDragType(null);
  }, []);

  const contentAreaDnD = useContentAreaDragDrop({
    isMobile,
    selectionMode,
    hasWritePermission,
    isShareLinkMode,
    currentNodeId,
    contentAreaDraggedNodeId,
    contentAreaDraggedParentNodeId,
    setContentAreaDraggedNodeId,
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
  const handleScrollAreaClick = useCallback(
    (e) => {
      if (isMobile || !selectionMode) return;
      if (e.target.closest('[data-file-path]')) return;
      handleDeselectAll();
      setSelectionMode(false);
    },
    [isMobile, selectionMode, handleDeselectAll, setSelectionMode]
  );

  const onShareTargetSave = useCallback(() => {
    handleOperationComplete({ opType: 'refresh', startedNodeId: currentNodeIdRef.current });
  }, [handleOperationComplete]);

  useEffect(() => {
    // Every authenticated session (admin or not) reads the public /api/health
    // so the file-screen banner can warn non-admin users too. The public payload
    // carries the active file backend AND active metadata backend, so no admin
    // config call is needed.
    // Health is polled while the screen is mounted: a backend failure recorded
    // mid-session (e.g. a failed upload/download or a metadata-DB drop) must
    // flip the banner without requiring a page remount — for every role.
    let active = true;
    const refreshHealth = () => {
      adminService
        .getPublicHealth()
        .then((data) => {
          if (!active) return;
          setBackendHealthStatuses(data?.backends || null);
          setActiveFileStorage(data?.activeFileStorage || null);
          setActiveMetadataBackend(data?.activeMetadataBackend || null);
        })
        .catch(() => {
          if (active) {
            setBackendHealthStatuses(null);
            setActiveFileStorage(null);
            setActiveMetadataBackend(null);
          }
        });
    };
    refreshHealth();
    const intervalId = setInterval(refreshHealth, HEALTH_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  const shareContextProps = useMemo(
    () => ({
      shareToken,
      isShareLinkMode,
      shareRootPath,
      shareRootName,
      shareRootNodeId: linkInfo?.nodeId,
    }),
    [shareToken, isShareLinkMode, shareRootPath, shareRootName, linkInfo]
  );

  const shellContextProps = useMemo(
    () => ({
      user,
      navigate,
      isMobile,
      fileContentRef,
      scrollContainerRef,
      backendHealth: backendHealthStatuses,
      activeFileStorage,
      activeMetadataBackend,
    }),
    [user, navigate, isMobile, backendHealthStatuses, activeFileStorage, activeMetadataBackend]
  );

  const overlayStateProps = useMemo(
    () => ({
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
      leaveShareConfirmTargetNodeId,
      setLeaveShareConfirmTargetNodeId,
      leaveShareConfirmTargetPath,
      setLeaveShareConfirmTargetPath,
      handleLeaveShareConfirm,
    }),
    [
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
      leaveShareConfirmTargetNodeId,
      setLeaveShareConfirmTargetNodeId,
      leaveShareConfirmTargetPath,
      setLeaveShareConfirmTargetPath,
      handleLeaveShareConfirm,
    ]
  );

  const controlsStateProps = useMemo(
    () => ({
      currentPath,
      currentNodeId,
      viewMode,
      setViewMode,
      sortMode,
      setSortMode,
      searchQuery,
      setSearchQuery: handleSearchQueryChange,
      // Share-link mode: server-wide search is an authenticated-explorer
      // feature — the bar stays typing-filter-only (FloatingSearchBar §3.2).
      onSubmitQuery: isShareLinkMode ? undefined : submitSearch,
    }),
    [
      currentPath,
      currentNodeId,
      viewMode,
      setViewMode,
      sortMode,
      setSortMode,
      searchQuery,
      handleSearchQueryChange,
      isShareLinkMode,
      submitSearch,
    ]
  );

  const listingStateProps = useMemo(
    () => ({
      displayedFiles,
      loading,
      processingMap,
      handleThumbnailsLoaded,
      loadMoreRef,
      hasMore,
    }),
    [displayedFiles, loading, processingMap, handleThumbnailsLoaded, loadMoreRef, hasMore]
  );

  const explorerSessionProps = useMemo(
    () => ({
      controlsState: controlsStateProps,
      listingState: listingStateProps,
    }),
    [controlsStateProps, listingStateProps]
  );

  const selectionModelProps = useMemo(
    () => ({
      selectionMode,
      selectedFiles,
      handleFileCheck,
    }),
    [selectionMode, selectedFiles, handleFileCheck]
  );

  const bulkStateProps = useMemo(
    () => ({
      handleSelectAll,
      handleDeselectAll,
      allSelectedHaveWrite,
      hasReadOnlyInSelection,
    }),
    [handleSelectAll, handleDeselectAll, allSelectedHaveWrite, hasReadOnlyInSelection]
  );

  const selectionProps = useMemo(
    () => ({
      selectionModel: selectionModelProps,
      bulkState: bulkStateProps,
    }),
    [selectionModelProps, bulkStateProps]
  );

  const capabilityStateProps = useMemo(
    () => ({
      hasWritePermission,
    }),
    [hasWritePermission]
  );

  const treeStateProps = useMemo(
    () => ({
      treeUpdateTrigger,
    }),
    [treeUpdateTrigger]
  );

  const transferStateProps = useMemo(
    () => ({
      contentAreaDraggedNodeId,
      bulkMoveCopyInProgress,
    }),
    [contentAreaDraggedNodeId, bulkMoveCopyInProgress]
  );

  const explorerActionStateProps = useMemo(
    () => ({
      capabilityState: capabilityStateProps,
      treeState: treeStateProps,
      transferState: transferStateProps,
    }),
    [capabilityStateProps, treeStateProps, transferStateProps]
  );

  const actionContextProps = useMemo(
    () => ({
      actionSheetOpen,
      closeActionSheet,
      actionSheetFile,
      contextMenu,
      setContextMenu,
    }),
    [actionSheetOpen, closeActionSheet, actionSheetFile, contextMenu, setContextMenu]
  );

  const pickerStateProps = useMemo(
    () => ({
      mobilePickerFile,
      setMobilePickerFile,
      mobilePickerAction,
      setMobilePickerAction,
      folderPickerOpen,
      folderPickerAction,
      setFolderPickerOpen,
      setFolderPickerAction,
    }),
    [
      mobilePickerFile,
      setMobilePickerFile,
      mobilePickerAction,
      setMobilePickerAction,
      folderPickerOpen,
      folderPickerAction,
      setFolderPickerOpen,
      setFolderPickerAction,
    ]
  );

  const modalDialogsProps = useMemo(
    () => ({
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
    }),
    [
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
    ]
  );

  const fileTargetsProps = useMemo(
    () => ({
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
    }),
    [
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
    ]
  );

  const dialogStateProps = useMemo(
    () => ({
      actionContext: actionContextProps,
      pickerState: pickerStateProps,
      modalDialogs: modalDialogsProps,
      fileTargets: fileTargetsProps,
    }),
    [actionContextProps, pickerStateProps, modalDialogsProps, fileTargetsProps]
  );

  const messagingProps = useMemo(
    () => ({
      dropMessage,
      setDropMessage,
      message,
      clearMessage,
      showError,
      showWarning,
    }),
    [dropMessage, message, clearMessage, showError, showWarning]
  );

  const interactionHandlersProps = useMemo(
    () => ({
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
      handleFolderTreeNodeClick,
      handleTrashBreadcrumbClick,
      ancestors,
      handleScrollAreaClick,
      handleFileDownloadOp,
      contentAreaDnD,
      isFileAreaDraggingOver,
      contentAreaDragType,
      handleActionSheetDownload,
      handleActionSheetPreview,
      handleToggleLike,
      handleOpenAddToCollection,
    }),
    [
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
      handleFolderTreeNodeClick,
      handleTrashBreadcrumbClick,
      ancestors,
      handleScrollAreaClick,
      handleFileDownloadOp,
      contentAreaDnD,
      isFileAreaDraggingOver,
      contentAreaDragType,
      handleActionSheetDownload,
      handleActionSheetPreview,
      handleToggleLike,
      handleOpenAddToCollection,
    ]
  );

  const commandHandlersProps = useMemo(
    () => ({
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
    }),
    [
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
    ]
  );

  const progressHandlersProps = useMemo(
    () => ({
      progressItems,
      updateProgress,
      handleRetryUpload: retryProgress,
      handleCancelUploadFileWrapper: cancelUploadFile,
      handleCancelAllWrapper: cancelAllProgress,
    }),
    [progressItems, updateProgress, retryProgress, cancelUploadFile, cancelAllProgress]
  );

  const refreshIndicatorProps = useMemo(
    () => ({
      indicatorStyles,
      iconStyles,
      isDeterminateProgress,
      progress,
      progressColor,
      textColor,
      shouldShowIndicator,
      showRefreshSuccess,
      textContent,
    }),
    [
      indicatorStyles,
      iconStyles,
      isDeterminateProgress,
      progress,
      progressColor,
      textColor,
      shouldShowIndicator,
      showRefreshSuccess,
      textContent,
    ]
  );

  const trashStateProps = useMemo(
    () => ({
      trashMode: isTrashView,
      trail: trashTrail,
      canEmptyTrash: Boolean(user?.is_admin),
      restoreConfirmState,
      purgeConfirmState,
      emptyTrashConfirmOpen,
      openRestoreConfirm,
      openPurgeConfirm,
      openEmptyTrashConfirm,
      closeRestoreConfirm,
      closePurgeConfirm,
      closeEmptyTrashConfirm,
      confirmRestore,
      confirmPurge,
      confirmEmptyTrash,
      handleTrashRestore,
      handleTrashPurge,
    }),
    [
      isTrashView,
      trashTrail,
      user,
      restoreConfirmState,
      purgeConfirmState,
      emptyTrashConfirmOpen,
      openRestoreConfirm,
      openPurgeConfirm,
      openEmptyTrashConfirm,
      closeRestoreConfirm,
      closePurgeConfirm,
      closeEmptyTrashConfirm,
      confirmRestore,
      confirmPurge,
      confirmEmptyTrash,
      handleTrashRestore,
      handleTrashPurge,
    ]
  );

  const explorerHandlersProps = useMemo(
    () => ({
      interaction: interactionHandlersProps,
      commands: commandHandlersProps,
      progress: progressHandlersProps,
      refreshIndicator: refreshIndicatorProps,
    }),
    [interactionHandlersProps, commandHandlersProps, progressHandlersProps, refreshIndicatorProps]
  );

  return (
    <>
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
        trashState={trashStateProps}
        collectionsModel={collectionsModel}
        searchResults={searchResults}
      />
      {isCollectionsMemberRoute && (
        <MemberRowControls
          open={Boolean(memberMenu)}
          anchorEl={memberMenu?.anchorEl ?? null}
          member={memberMenu?.member ?? null}
          collection={memberCollection}
          onExclude={handleMemberExclude}
          onPublish={handleMemberPublish}
          onDownload={handleMemberDownload}
          onShowOriginal={handleMemberShowOriginal}
          onProperties={handleMemberProperties}
          onToggleLike={handleToggleLike}
          onClose={closeMemberMenu}
        />
      )}
      {!isShareLinkMode && (
        <AddToCollectionMenu
          open={Boolean(addMenu)}
          contextMenu={addMenu?.position ?? null}
          targetNodes={addMenu?.targetNodes ?? []}
          collections={writableCollections}
          seedItemVisible={false}
          onAdd={handleAddMenuAdd}
          onCreateAndAdd={handleAddMenuCreateAndAdd}
          onCreateSeed={async () => {}}
          onClose={closeAddMenu}
        />
      )}
      {isCollectionsOverlay && (
        <>
          <RenameDialog
            open={collectionRenameTarget != null}
            onClose={() => setCollectionRenameTarget(null)}
            value={collectionRenameValue}
            onChange={setCollectionRenameValue}
            error={collectionRenameError}
            onClearError={() => setCollectionRenameError('')}
            loading={false}
            onConfirm={handleCollectionRenameConfirm}
            fullScreen={isMobile}
          />
          <ConfirmDialog
            open={Boolean(cascadeConfirm?.open)}
            onClose={cascadeConfirm?.cancel}
            onConfirm={cascadeConfirm?.confirm}
            title={t('common.confirm')}
            message={t('serverErrors.actions.cascadeConfirmRequired')}
            confirmText={t('actions.undo')}
            cancelText={t('common.cancel')}
            loading={undoBusy}
            confirmColor="error"
          />
        </>
      )}
    </>
  );
};

export default FileManager;
