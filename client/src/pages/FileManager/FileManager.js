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
import { resolvePath, requestThumbnailsBatch } from '../../services/fileService';
import { normalizePath, getBasename, getParentPath } from '../../utils/pathUtils';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import { getEntryKey, getCollectionEntryKey } from '../../utils/fileViewUtils';
import { getSearchZonesCollapsed, setSearchZonesCollapsed } from '../../utils/localStorage';
import { getPublicSettings } from '../../services/settingsService';

import { useRecentFile } from './hooks/useRecentFile';
import { useCollections } from './hooks/useCollections';
import { useCollectionMemberships } from './hooks/useCollectionMemberships';
import { useSearchResults } from './hooks/useSearchResults';
import { useUndoToast } from '../../hooks/useUndoToast';
import { getServerErrorDisplay } from '../../utils/errorUtils';
import MemberRowControls from '../../components/file-manager/MemberRowControls';
import MergeProposalCard from '../../components/file-manager/MergeProposalCard';
import AddToCollectionMenu from '../../components/file-manager/AddToCollectionMenu';
import SearchSaveDialog from '../../components/file-manager/SearchSaveDialog';
import { ConfirmDialog, RenameDialog, CollectionPropertiesDialog } from '../../components/dialogs';
import { getApprovedUsers } from '../../services/userService';
import { useFileManagerDialogs } from './hooks/useFileManagerDialogs';
import { useTrashOperations } from './hooks/useTrashOperations';
import { useContentAreaDragDrop } from './hooks/useContentAreaDragDrop';
import FileManagerView from '../../components/file-manager/FileManagerView';

// Public health re-poll: a backend failure recorded mid-session (failed upload,
// download, etc.) must flip the banner without a page remount.
const HEALTH_POLL_INTERVAL_MS = 15000;

// Stable empty slice for the properties `Member of` chips (dialog §3.2) —
// keeps the grouped prop identity steady while no membership exists.
const EMPTY_PROPERTIES_COLLECTIONS = [];

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
    likedItems,
    applyLikedRemoval,
    handleMemberThumbnailsLoaded,
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

  // -- AI-platform search-results controller (FileManager §7) ---------------
  // The results-mode machine (`useSearchResults`) consumes the session listing
  // (`files`), `sortMode` and the shared input text (`liveText`), so it mounts
  // right after `useExplorerSession`. The session's submit passthrough is a
  // stable ref wrapper; `searchResultsActive` mirrors the hook mode (the zones
  // replace the listing region while results render).
  const submitSearchRef = useRef(null);
  const handleSessionSubmitQuery = useCallback((query) => {
    if (typeof submitSearchRef.current === 'function') submitSearchRef.current(query);
  }, []);
  const [searchResultsActive, setSearchResultsActive] = useState(false);

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
    memberViewMode,
    setMemberViewMode,
    likedViewMode,
    setLikedViewMode,
    memberSortMode,
    setMemberSortMode,
    sortedFiles,
    displayedFiles,
    loadMoreRef,
    hasMore,
    handleThumbnailsLoaded,
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
    searchResultsActive,
    onSubmitQuery: isShareLinkMode ? undefined : handleSessionSubmitQuery,
  });

  // A successful commit hands the term to the chip strip, so the shared input
  // field is cleared (useSearchResults.md §2.3).
  const handleSearchCommitted = useCallback(() => {
    setSearchQuery('');
  }, [setSearchQuery]);

  const searchApi = useSearchResults({
    showError,
    gateway: isShareLinkMode ? undefined : explorerGateway,
    files,
    sortMode,
    liveText: searchQuery,
    onCommit: handleSearchCommitted,
  });
  submitSearchRef.current = searchApi.submitSearch;

  const searchModeActive =
    !isShareLinkMode && (searchApi.mode === 'results' || searchApi.mode === 'pending');

  useEffect(() => {
    setSearchResultsActive(
      !isShareLinkMode && (searchApi.mode === 'results' || searchApi.mode === 'pending')
    );
  }, [isShareLinkMode, searchApi.mode]);

  const searchApiRef = useRef(searchApi);
  searchApiRef.current = searchApi;

  // Every results-mode exit resets the shared input field (useSearchResults.md
  // §2.3): exitResults + clear the pill text so browse mode starts unfiltered.
  const exitSearchAndResetInput = useCallback(() => {
    searchApiRef.current.exitResults();
    setSearchQuery('');
  }, [setSearchQuery]);

  // Folder navigation while results mode is active EXITS results mode
  // (useSearchResults.md §2.3 — the recent-query list survives).
  useEffect(() => {
    if (searchApiRef.current.mode !== 'browse') exitSearchAndResetInput();
  }, [sessionKey, exitSearchAndResetInput]);

  // Clearing the shared search text exits results mode (FloatingSearchBar §2.7:
  // the ✕ press clears + blurs; the cleared text is the host exit signal).
  const handleSearchQueryChange = useCallback(
    (query) => {
      setSearchQuery(query);
      if (!String(query ?? '').trim() && searchApiRef.current.mode !== 'browse') {
        searchApiRef.current.exitResults();
      }
    },
    [setSearchQuery]
  );

  // Accordion zones collapsed state (FileManagerView.md §3) — persisted under
  // the dedicated key through the preference-storage helper boundary.
  const [zonesCollapsed, setZonesCollapsed] = useState(() => getSearchZonesCollapsed());
  useEffect(() => {
    setSearchZonesCollapsed(zonesCollapsed);
  }, [zonesCollapsed]);
  const handleToggleZone = useCallback((zoneKey) => {
    setZonesCollapsed((prev) => ({ ...prev, [zoneKey]: !(prev[zoneKey] === true) }));
  }, []);

  // LLM capability flag for the search-button glyph composite (T0.7b surface:
  // GET /settings/public `ai.embed` through the settingsService repository).
  const [llmConfigured, setLlmConfigured] = useState(false);
  useEffect(() => {
    if (isShareLinkMode) return undefined;
    let cancelled = false;
    getPublicSettings()
      .then((data) => {
        if (!cancelled) setLlmConfigured(Boolean(data?.ai?.embed));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isShareLinkMode]);

  // Union selection (FileManager.md §7): while a results surface is on screen
  // the selection source is Zone A ++ Zone B ++ Zone C displayed rows so
  // select-all and the bulk read-only gate span the zones; otherwise the
  // browse pass-through. Deduped by entry key (keep first occurrence) — a node
  // may appear in more than one zone (A + C) and must count once.
  const searchSelectionRows = useMemo(() => {
    if (!searchModeActive) return null;
    const seen = new Set();
    const rows = [];
    for (const row of [...searchApi.zoneARows, ...searchApi.zoneBRows, ...searchApi.zoneCRows]) {
      const key = getEntryKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }, [searchModeActive, searchApi.zoneARows, searchApi.zoneBRows, searchApi.zoneCRows]);
  const selectionSortedSource = useMemo(
    () => searchSelectionRows ?? sortedFiles,
    [searchSelectionRows, sortedFiles]
  );
  const selectionDisplaySource = useMemo(
    () => searchSelectionRows ?? displayedFiles,
    [searchSelectionRows, displayedFiles]
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
  } = useSelection(selectionDisplaySource, selectionSortedSource);

  // key(entryKey)→file 인덱스: 선택 Set의 reverse-lookup을 O(1)로 수행 (선택 크기 × 파일 수의 find 중복 제거)
  const selectionKeyIndex = useMemo(() => {
    const map = new Map();
    for (const f of selectionSortedSource) {
      const key = getEntryKey(f);
      if (!map.has(key)) map.set(key, f);
    }
    return map;
  }, [selectionSortedSource]);

  // 선택 모드에서 삭제/이동 버튼: 선택된 항목 모두 write 권한이 있어야 활성화
  const allSelectedHaveWrite = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    return Array.from(selectedFiles).every((key) => {
      const f = selectionKeyIndex.get(key);
      return !!f && f.hasWritePermission === true;
    });
  }, [selectionMode, selectedFiles, selectionKeyIndex]);

  // 선택된 항목 중 읽기 전용(hasWritePermission === false) 포함 여부
  const hasReadOnlyInSelection = useMemo(() => {
    if (!selectionMode || selectedFiles.size === 0) return false;
    return Array.from(selectedFiles).some((key) => {
      const f = selectionKeyIndex.get(key);
      return !!f && f.hasWritePermission === false;
    });
  }, [selectionMode, selectedFiles, selectionKeyIndex]);

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
    // Bulk undo seam — defined below (useUndoToast mount); the arrow defers
    // the reference to event time (render-order safe).
    onUndoable: (payload, textKey, params, refresh) =>
      handleUndoable(payload, textKey, params, refresh),
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
  // P-5 Likes surface: static child row of the Collections section (owner
  // ruling §10) — member-parity overlay listing fed by GET /file-likes/items.
  const isCollectionsLikedRoute = currentPath === '/__collections__/liked';
  const isCollectionsOverlay =
    !isShareLinkMode &&
    (isCollectionsRoute ||
      isCollectionsArchiveRoute ||
      isCollectionsMemberRoute ||
      isCollectionsLikedRoute);
  const collectionsInclude = isCollectionsArchiveRoute ? 'mine,archived' : 'mine,shared';

  // P-4 selection reset (P-3 residue fix): the synthetic CARD keys of the
  // collections list/archive surfaces live in the page-level selection Set but
  // resolve to nothing outside those surfaces (sessionKey stays 'node:root'
  // across the virtual routes). On leaving a card surface strip them so a
  // selection can never leak into the members/file surfaces (member rows
  // share the Set through their real numeric nodeId keys).
  useEffect(() => {
    if (isCollectionsRoute || isCollectionsArchiveRoute) return;
    const isSyntheticKey = (key) =>
      typeof key === 'string' && key.startsWith('/__collections__/collection/');
    if (!Array.from(selectedFiles).some(isSyntheticKey)) return;
    const next = new Set(Array.from(selectedFiles).filter((key) => !isSyntheticKey(key)));
    setSelectedFiles(next);
    if (next.size === 0) setSelectionMode(false);
  }, [
    isCollectionsRoute,
    isCollectionsArchiveRoute,
    selectedFiles,
    setSelectedFiles,
    setSelectionMode,
  ]);

  // Share-link embedding must NOT mount the collections overlay (FileManager §7);
  // the hook itself is unconditional (rules of hooks), so an inert gateway seam
  // keeps it IO-silent outside the authenticated explorer.
  const INERT_COLLECTIONS_GATEWAY = useMemo(
    () => ({
      loadCollections: async () => ({ collections: [] }),
      getMergeSuggestions: async () => ({ suggestions: [] }),
      getMemberships: async () => ({ memberships: [] }),
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
    (payload, textKey, params, refresh) => {
      showUndoToast({
        actionId: payload?.undo?.action_id,
        text: params ? t(textKey, params) : t(textKey),
        // per-call re-read override — the bulk batch undo refreshes the file
        // listing surface (useUndoToast.md §2.3); undefined keeps the
        // mount-level collections refresh for the other seams.
        refresh,
      });
    },
    [showUndoToast, t]
  );

  // Operator rule (PLAN §14 client half): admin sessions are IO-silent on the
  // collections seams too (share-link inert-gateway precedent).
  const collectionsApi = useCollections({
    showError,
    gateway: isShareLinkMode || user?.is_admin ? INERT_COLLECTIONS_GATEWAY : undefined,
    onUndoable: handleUndoable,
    include: collectionsInclude,
  });
  collectionsRefreshRef.current = collectionsApi.refresh;
  showUndoToastRef.current = showUndoToast;

  const [collectionRenameTarget, setCollectionRenameTarget] = useState(null);
  const [collectionRenameValue, setCollectionRenameValue] = useState('');
  const [collectionRenameError, setCollectionRenameError] = useState('');

  // CollectionPropertiesDialog host (FileManager.md §7): the card menu
  // `sharing` dispatch opens the owner-only dialog; ALL IO stays host-side
  // (the dialog is a pure view). The dialog renders the LIVE fetch row so
  // rename/publish-mode writes reflect without a re-dispatch.
  const [collectionPropsTarget, setCollectionPropsTarget] = useState(null);
  const [collectionGrants, setCollectionGrants] = useState(null);
  const [collectionShareableUsers, setCollectionShareableUsers] = useState([]);
  const [collectionPreview, setCollectionPreview] = useState(null);
  const [collectionSeedName, setCollectionSeedName] = useState(null);
  const collectionPropsCollection = useMemo(() => {
    if (!collectionPropsTarget) return null;
    return (
      collectionsApi.collections.find(
        (collection) => collection.collection_id === collectionPropsTarget.collection_id
      ) ?? collectionPropsTarget
    );
  }, [collectionPropsTarget, collectionsApi.collections]);
  const collectionPropsId = collectionPropsCollection?.collection_id ?? null;
  // Owner predicate: the wire never invents `granted_role:'owner'` (§12.1 P-4).
  const collectionPropsOwner =
    collectionPropsCollection != null && collectionPropsCollection.granted_role == null;
  const collectionPropsSeedRef = collectionPropsCollection?.definition?.seed_ref ?? null;

  // Open reads (all owner-only endpoints): grants, add-grantee candidates,
  // member-sample preview and the seed-reference name (batched metadata seam).
  useEffect(() => {
    if (collectionPropsId == null || !collectionPropsOwner) {
      setCollectionGrants(null);
      setCollectionPreview(null);
      return undefined;
    }
    let cancelled = false;
    setCollectionGrants(null);
    setCollectionShareableUsers([]);
    setCollectionPreview(null);
    setCollectionSeedName(null);
    collectionsApi.loadGrants(collectionPropsId).then((rows) => {
      if (!cancelled) setCollectionGrants(Array.isArray(rows) ? rows : []);
    });
    getApprovedUsers()
      .then((data) => {
        if (!cancelled) setCollectionShareableUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        // empty candidate list — non-fatal (preview-failure precedent)
        if (!cancelled) setCollectionShareableUsers([]);
      });
    explorerGateway
      .previewExistingCollection(collectionPropsId)
      .then((payload) => {
        // the repository absorbs failure to null — the dialog's `false`
        // placeholder state distinguishes a failed read from a live load
        if (!cancelled) setCollectionPreview(payload || false);
      })
      .catch(() => {
        if (!cancelled) setCollectionPreview(false);
      });
    if (collectionPropsSeedRef != null) {
      explorerGateway.loadNodesMetadata([collectionPropsSeedRef]).then((rows) => {
        if (cancelled) return;
        const row = (rows ?? []).find(
          (candidate) =>
            String(candidate.node_id ?? candidate.nodeId) === String(collectionPropsSeedRef)
        );
        setCollectionSeedName(row?.name ?? row?.basename ?? null);
      });
    }
    return () => {
      cancelled = true;
    };
    // The hook return object is recreated every render; reads re-run only on
    // target/owner/seed identity changes (collectionsApi is closure-current).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPropsId, collectionPropsOwner, collectionPropsSeedRef]);

  const closeCollectionProps = useCallback(() => setCollectionPropsTarget(null), []);

  /** `onPatch` mapping: dialog writes → existing CRUD seams (undo toasts ride). */
  const handleCollectionPropsPatch = useCallback(
    (patch) => {
      if (collectionPropsId == null || !patch) return;
      if (typeof patch.name === 'string' && patch.name !== '') {
        collectionsApi.renameCollection(collectionPropsId, patch.name);
      }
      if (typeof patch.pinned === 'boolean') {
        collectionsApi.setPinned(collectionPropsId, patch.pinned);
      }
      if (typeof patch.publishMode === 'string') {
        collectionsApi.setPublishMode(collectionPropsId, patch.publishMode);
      }
    },
    [collectionPropsId, collectionsApi]
  );

  /** Grant list updates from the POST response row (PK replace by grantee_id). */
  const handleCollectionGrant = useCallback(
    async (userId, role) => {
      if (collectionPropsId == null) return;
      const payload = await collectionsApi.grantCollection(collectionPropsId, { userId, role });
      if (!payload || !payload.grant) return;
      setCollectionGrants((prev) => [
        ...(prev ?? []).filter((row) => row.grantee_id !== payload.grant.grantee_id),
        payload.grant,
      ]);
    },
    [collectionPropsId, collectionsApi]
  );

  /** Revoke is instant; the row drops from the DELETE response grantee_id. */
  const handleCollectionRevoke = useCallback(
    async (granteeId) => {
      if (collectionPropsId == null) return;
      const payload = await collectionsApi.revokeGrant(collectionPropsId, granteeId);
      if (!payload) return;
      setCollectionGrants((prev) =>
        (prev ?? []).filter((row) => row.grantee_id !== payload.grantee_id)
      );
    },
    [collectionPropsId, collectionsApi]
  );

  const handleCardAction = useCallback(
    async (action, collection) => {
      const collectionId = collection?.collection_id;
      switch (action) {
        case 'open':
          // File-parity open (P-3): leave any card selection behind — the files
          // grid does the same on folder navigation (sessionKey reset effect).
          setSelectionMode(false);
          setSelectedFiles(new Set());
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
          // T3.2b (FileManager.md §7): open the host-owned CollectionPropertiesDialog
          // on the Sharing tab (owner rows only — the card menu never offers this
          // entry for received rows).
          setCollectionPropsTarget(collection);
          break;
        case 'delete-permanent': {
          const ok = await collectionsApi.deleteCollectionPermanent(collectionId);
          if (ok) messageBundle.showSuccess(t('collections.permanentDeleteReport'));
          break;
        }
        case 'revoke-permission':
          // Path 1 (P-1): instant self-grant revocation — DELETE /:id/grants/me;
          // the row drops out on the hook's post-mutation refresh (no undo
          // affordance: re-granting is the owner's act).
          await collectionsApi.revokeOwnGrant(collectionId);
          break;
        default:
          break;
      }
    },
    [collectionsApi, setCurrentPath, messageBundle, t, setSelectionMode, setSelectedFiles]
  );

  // -- P-3 card grid parity: preview thumbnail merge + file-parity selection --
  // The collections list runs a SECOND useThumbnailLazyLoad instance (inside
  // CollectionsListView) over the flattened preview_items rows; results land
  // here through the SAME merge entry the shell hands the file views. The
  // session's handleThumbnailsLoaded merges file rows only (ids outside the
  // file rows are a no-op there), so preview ids accumulate in their own map —
  // views stay pure.
  const [previewThumbnails, setPreviewThumbnails] = useState(() => new Map());

  const handlePreviewThumbnailsLoaded = useCallback(
    (thumbnailMap) => {
      handleThumbnailsLoaded(thumbnailMap);
      if (!(thumbnailMap instanceof Map) || thumbnailMap.size === 0) return;
      setPreviewThumbnails((prev) => {
        let changed = false;
        const next = new Map(prev);
        thumbnailMap.forEach((thumbnailUrl, nodeId) => {
          if (thumbnailUrl && !next.has(nodeId)) {
            next.set(nodeId, thumbnailUrl);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    },
    [handleThumbnailsLoaded]
  );

  // -- T3.1 merge-proposal card slot (FileManager.md merge slot) ----------
  // ONE card over the score-desc pending set; the `+N more` chip cycles a
  // shell-owned cursor, resolution (Later/Keep separate) rides the hook's
  // refresh, merge rides the existing onUndoable seam. Strip thumbnails reuse
  // the SAME preview-thumbnail cache the collections grid batches into — the
  // card itself stays IO-free (MergeProposalCard.md §2.7).
  const [mergeCursor, setMergeCursor] = useState(0);
  const {
    suggestions: mergePending,
    mergePair,
    dismissMergeSuggestion,
    rejectMergeSuggestion,
  } = collectionsApi;
  const suggestionsLength = mergePending.length;
  const handleMergeCycle = useCallback(() => {
    setMergeCursor((cursor) => {
      if (suggestionsLength === 0) return 0;
      return (Math.min(cursor, suggestionsLength - 1) + 1) % suggestionsLength;
    });
  }, [suggestionsLength]);

  useEffect(() => {
    // the pending set emptied (resolved/merged elsewhere): park the cursor so
    // the NEXT suggestion wave starts on its top-scored pair
    if (suggestionsLength === 0) setMergeCursor(0);
  }, [suggestionsLength]);

  const handleMergeSampleThumbnails = useCallback(
    (nodeIds) => {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) return;
      requestThumbnailsBatch(nodeIds)
        .then((response) => {
          const thumbnailMap = new Map();
          (response?.thumbnails ?? []).forEach(({ nodeId, thumbnailUrl }) => {
            if (thumbnailUrl) thumbnailMap.set(nodeId, thumbnailUrl);
          });
          if (thumbnailMap.size > 0) handlePreviewThumbnailsLoaded(thumbnailMap);
        })
        .catch(() => {
          // cosmetic failure — strip tiles stay placeholders (zero fabrication)
        });
    },
    [handlePreviewThumbnailsLoaded]
  );

  const mergeSlotNode = useMemo(() => {
    if (mergePending.length === 0) return null;
    const current = mergePending[Math.min(mergeCursor, mergePending.length - 1)];
    if (!current) return null;
    return (
      <MergeProposalCard
        key={current.suggestion_id}
        suggestion={current}
        remainingCount={mergePending.length - 1}
        onCycle={handleMergeCycle}
        onMerge={(aId, bId) => mergePair(aId, bId)}
        onKeepSeparate={(aId, bId) => rejectMergeSuggestion(aId, bId)}
        onLater={(aId, bId) => dismissMergeSuggestion(aId, bId)}
        thumbnailMap={previewThumbnails}
        onRequestThumbnails={handleMergeSampleThumbnails}
      />
    );
  }, [
    mergePending,
    mergePair,
    rejectMergeSuggestion,
    dismissMergeSuggestion,
    mergeCursor,
    handleMergeCycle,
    handleMergeSampleThumbnails,
    previewThumbnails,
  ]);

  // Card selection uses synthetic path keys (getCollectionEntryKey) in the
  // page-level selection Set — no collision with numeric file nodeIds. The
  // 350ms double-open window is resolved card-locally inside
  // CollectionsListView (same contract as useExplorerInteraction desktop);
  // plain click here = enter selection mode with a single-select (files
  // handleFileClickSelection no-modifier branch; shift range stays a
  // file-grid affordance).
  const handleCollectionCardClick = useCallback(
    (collection, event) => {
      const key = getCollectionEntryKey(collection?.collection_id);
      enterSelectionMode();
      if (event?.ctrlKey || event?.metaKey) {
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        return;
      }
      setSelectedFiles(new Set([key]));
    },
    [enterSelectionMode, setSelectedFiles]
  );

  const handleCollectionLongPressSelect = useCallback(
    (collection) => {
      enterSelectionMode();
      setSelectedFiles(new Set([getCollectionEntryKey(collection?.collection_id)]));
    },
    [enterSelectionMode, setSelectedFiles]
  );

  // Toolbar bulk cluster (P-3 selection bar): fixed set, looped through the
  // EXISTING single-collection calls — per-item failures tolerated (the hook
  // maps + shows each absorbed error), journal/undo per collection, refresh
  // rides each successful mutation. Archive asks ONE confirm and permanent
  // delete keeps the trash-parity TWO-step; both confirms are hosted by the
  // list view from this state and cover the whole batch.
  const [collectionsBulkConfirm, setCollectionsBulkConfirm] = useState(null); // { step, ids, names }

  const selectedCollectionRows = useCallback(
    () =>
      collectionsApi.collections.filter((collection) =>
        selectedFiles.has(getCollectionEntryKey(collection.collection_id))
      ),
    [collectionsApi.collections, selectedFiles]
  );

  const exitCollectionsSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }, [setSelectionMode, setSelectedFiles]);

  const runCollectionsBulk = useCallback(
    async (action, rows) => {
      let deletedCount = 0;
      for (const collection of rows) {
        const id = collection.collection_id;
        if (action === 'pin') await collectionsApi.setPinned(id, true);
        else if (action === 'unpin') await collectionsApi.setPinned(id, false);
        else if (action === 'archive') await collectionsApi.archiveCollection(id);
        else if (action === 'restore') await collectionsApi.restoreCollection(id);
        else if (action === 'delete-permanent') {
          const ok = await collectionsApi.deleteCollectionPermanent(id);
          if (ok === true) deletedCount += 1;
        }
      }
      // Report-style toast parity (bulk delete UX): one success report for the
      // batch — per-item failures surfaced individually by the mutation hook.
      if (action === 'delete-permanent' && deletedCount > 0) {
        messageBundle.showSuccess(t('collections.permanentDeleteReport'));
      }
      exitCollectionsSelection();
    },
    [collectionsApi, exitCollectionsSelection, messageBundle, t]
  );

  const handleCollectionsBulkAction = useCallback(
    (action) => {
      const rows = selectedCollectionRows();
      if (rows.length === 0) return;
      if (action === 'archive' || action === 'delete-permanent') {
        setCollectionsBulkConfirm({
          step: action === 'archive' ? 'archive' : 'delete-1',
          ids: rows.map((row) => row.collection_id),
          names: rows.map((row) => row.name),
        });
        return;
      }
      runCollectionsBulk(action, rows);
    },
    [runCollectionsBulk, selectedCollectionRows]
  );

  const handleCollectionsBulkConfirm = useCallback(() => {
    if (!collectionsBulkConfirm) return;
    const { step, ids } = collectionsBulkConfirm;
    if (step === 'delete-1') {
      setCollectionsBulkConfirm({ ...collectionsBulkConfirm, step: 'delete-2' });
      return;
    }
    setCollectionsBulkConfirm(null);
    const action = step === 'archive' ? 'archive' : 'delete-permanent';
    const rows = collectionsApi.collections.filter((collection) =>
      ids.includes(collection.collection_id)
    );
    runCollectionsBulk(action, rows);
  }, [collectionsApi.collections, collectionsBulkConfirm, runCollectionsBulk]);

  const dismissCollectionsBulkConfirm = useCallback(() => setCollectionsBulkConfirm(null), []);

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
      if (!next) {
        // P-5: the Likes surface drops the row the moment the unlike starts
        // (no-op elsewhere); the subscribeToFileLikes re-read converges.
        applyLikedRemoval(nodeId);
      }
      let envelope = null;
      const payload = await explorerGateway.setFileLike(nodeId, next, {
        onError: (error) => {
          envelope = error;
        },
      });
      if (payload === null) {
        applyLikedToRows(nodeId, !next);
        showError(getServerErrorDisplay(envelope, t));
        // A failed unlike never notifies (absorbed write) — on the liked
        // surface re-read so the server truth (row still liked) returns.
        if (isCollectionsLikedRoute) loadFiles();
      }
    },
    [applyLikedToRows, applyLikedRemoval, showError, t, isCollectionsLikedRoute, loadFiles]
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
      // P-4 §2.3: the menu item is a publish ON/OFF toggle — flip the row's
      // current state (the shared renderer re-renders the awaiting-publish
      // chip through the FileListItem memo comparator after loadFiles).
      const nextPublished = member.published !== true;
      const payload = await explorerGateway.publishItems(
        collectionMembers.collectionId,
        [nodeId],
        nextPublished
      );
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
      pending.map((row) => row.nodeId),
      true
    );
    if (payload !== null) loadFiles();
  }, [collectionMembers, loadFiles]);

  // P-4 members toolbar bulk cluster (FileManagerControls.md memberMode): the
  // buttons hand the numeric nodeId array (the shared selection Set is keyed by
  // real node ids on the members surface); execution is shell-owned.
  const handleMemberBulkExclude = useCallback(
    async (nodeIds) => {
      const ids = (nodeIds ?? []).filter((id) => id != null);
      if (!ids.length || collectionMembers.collectionId == null) return;
      let envelope = null;
      const payload = await explorerGateway.removeCollectionItems(
        collectionMembers.collectionId,
        ids,
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

  // Bulk "Add to another collection": membership copy through the shell's
  // single AddToCollectionMenu instance (same flow as the file-side submenu),
  // names resolved from the loaded member rows.
  const handleMemberBulkAddToCollection = useCallback(
    (nodeIds) => {
      const ids = (nodeIds ?? []).filter((id) => id != null);
      if (!ids.length) return;
      const rowsById = new Map(collectionMembers.items.map((row) => [row.nodeId, row]));
      setAddMenu({
        targetNodes: ids.map((id) => {
          const row = rowsById.get(id);
          return { nodeId: id, name: row?.name ?? row?.basename ?? null };
        }),
        position: null,
      });
    },
    [collectionMembers.items]
  );

  // M-2 (2026-09-30): pseudo-tile navigation — the SAME string-path setter the
  // sidebar rows use (virtual routes never enter nodeId explorer state).
  const handlePseudoTileNavigate = useCallback((route) => setCurrentPath(route), [setCurrentPath]);

  const collectionsModel = useMemo(() => {
    if (!isCollectionsOverlay) return null;
    if (isCollectionsLikedRoute) {
      // P-5: members-parity consumer (CollectionsListView.md §2.2) — same mode,
      // same renderer delegation; membership chrome keys simply absent (no
      // digest/publish/bulk seams) and FileManagerView swaps the view-mode key
      // to the per-surface `likedViewMode` via the likedSurface flag.
      return {
        mode: 'members',
        likedSurface: true,
        items: likedItems.items,
        onMemberAction: handleMemberAction,
        onMemberThumbnailsLoaded: handleMemberThumbnailsLoaded,
      };
    }
    if (isCollectionsMemberRoute) {
      return {
        mode: 'members',
        items: collectionMembers.items,
        digest: collectionMembers.digest,
        publishPendingCount: collectionMembers.publishPendingCount,
        // M-9: the view resolves the breadcrumb NAME from this already-fetched
        // useCollections list (matched by collectionId; null while loading).
        collectionId: collectionMembers.collectionId,
        collections: collectionsApi.collections,
        onMemberAction: handleMemberAction,
        onPublishBatch: handlePublishBatch,
        // P-4 shared-renderer seams (FileManagerView §3 forwards the row
        // click/check/long-press to the interaction handlers; only the
        // member-local thumbnail merge and the bulk cluster are shell-owned).
        onMemberThumbnailsLoaded: handleMemberThumbnailsLoaded,
        onBulkMemberExclude: handleMemberBulkExclude,
        // Operator rule (PLAN §14 client half): the bulk add cluster is
        // WITHHELD for admin (undefined ⇒ button hidden, not disabled).
        onBulkAddToCollection: user?.is_admin ? undefined : handleMemberBulkAddToCollection,
      };
    }
    return {
      mode: 'list',
      collections: collectionsApi.collections,
      sort: collectionsApi.sort,
      onSortChange: collectionsApi.setSort,
      include: collectionsInclude,
      // M-2: Likes/Archive pseudo-tile navigation dispatch (virtual routes only).
      onPseudoTileNavigate: handlePseudoTileNavigate,
      // MergeProposalCard slot (T3.1): ONE card when the pending set is
      // non-empty, `null` (zero layout footprint) when it is not.
      mergeSlot: mergeSlotNode,
      onCardAction: handleCardAction,
      // P-3 file-parity selection + preview merge (consumed by FileManagerView
      // and forwarded into CollectionsListView; state stays shell-side).
      onCardClick: handleCollectionCardClick,
      onCardLongPressSelect: handleCollectionLongPressSelect,
      previewThumbnails,
      onPreviewThumbnailsLoaded: handlePreviewThumbnailsLoaded,
      onBulkAction: handleCollectionsBulkAction,
      bulkConfirm: collectionsBulkConfirm,
      onBulkConfirm: handleCollectionsBulkConfirm,
      onBulkConfirmDismiss: dismissCollectionsBulkConfirm,
    };
  }, [
    isCollectionsOverlay,
    isCollectionsMemberRoute,
    isCollectionsLikedRoute,
    collectionMembers,
    likedItems,
    collectionsApi.collections,
    collectionsApi.sort,
    collectionsApi.setSort,
    collectionsInclude,
    handleCardAction,
    handleMemberAction,
    handlePublishBatch,
    handleMemberBulkExclude,
    handleMemberBulkAddToCollection,
    handleMemberThumbnailsLoaded,
    user,
    handleCollectionCardClick,
    handleCollectionLongPressSelect,
    previewThumbnails,
    handlePreviewThumbnailsLoaded,
    handleCollectionsBulkAction,
    collectionsBulkConfirm,
    handleCollectionsBulkConfirm,
    dismissCollectionsBulkConfirm,
    handlePseudoTileNavigate,
    mergeSlotNode,
  ]);

  // -- Search-results model (FileManager §7): the shell prepares the results
  // view-model; the view swaps regions (chip bar + accordion zones). Row clicks
  // keep browse parity (single click selects on desktop, selection mode
  // toggles, double click / mobile tap opens): an opened row fires the
  // recordEntryClick signal (§3.4) — DIRECTORY rows navigate + exit results,
  // FILE rows preview while the zones stay mounted.
  const handleSearchRowOpen = useCallback(
    async (row, event, fileIndex) => {
      const nodeId = row?.nodeId ?? row?.node_id;
      if (nodeId == null) return;
      const desktopDouble = !isMobile && event && event.detail >= 2;
      if (selectionMode && !desktopDouble) {
        toggleFileSelection(row);
        return;
      }
      const openIntent = isMobile || !event || event.detail >= 2;
      if (!openIntent) {
        const index =
          typeof fileIndex === 'number'
            ? fileIndex
            : selectionSortedSource.findIndex((f) => getEntryKey(f) === getEntryKey(row));
        handleFileClickSelection(row, event, index >= 0 ? index : 0);
        return;
      }
      searchApi.recordEntryClick(nodeId);
      let type = row.type;
      if (type == null) {
        const meta = await explorerGateway.loadNodesMetadata([nodeId]);
        type = meta?.[0]?.type ?? 'file';
      }
      if (type === 'directory') {
        exitSearchAndResetInput();
        navigateToExplorerNode(nodeId);
        return;
      }
      const entry = {
        nodeId,
        name: row.name ?? null,
        basename: row.basename ?? row.name ?? null,
        type: 'file',
        size: row.size ?? 0,
        path: row.path ?? '',
        mime: row.mime ?? null,
        lastmod: row.lastmod ?? null,
      };
      // The preview surface renders from the selected-file target (list-flow
      // parity) — prepare it before opening the dialog.
      setSelectedFile(entry);
      openPreviewDialog(entry);
    },
    [
      searchApi,
      selectionMode,
      toggleFileSelection,
      isMobile,
      selectionSortedSource,
      handleFileClickSelection,
      navigateToExplorerNode,
      openPreviewDialog,
      setSelectedFile,
      exitSearchAndResetInput,
    ]
  );

  // Chip-bar LibraryAdd: the menu opens in its caller-provided nodeIds-set
  // target mode (AddToCollectionMenu.md §2.2) with the FULL current snapshot —
  // independent of the live filter text and of the zone paging.
  const handleSearchLibraryAdd = useCallback((anchorEl) => {
    setAddMenu({
      targetNodes: [],
      targetNodeIds: Array.from(searchApiRef.current.libraryAddTarget ?? []),
      position: null,
      anchorEl: anchorEl ?? null,
    });
  }, []);

  // Chip-bar save affordance (§2.6 boundary): the chip click opens the
  // host-owned CONFIRM dialog (invariant 5 — the dialog IS the batch
  // approval; the seed-dialog idiom). The create fires on CONFIRM through
  // the hook's saveFromResults; a real create surfaces the standard create
  // undo toast. Absorbed failures resolve null inside the hook (no toast,
  // no undo).
  const [searchSaveDialog, setSearchSaveDialog] = useState(null); // { term, rows }

  const handleSearchSave = useCallback(() => {
    const api = searchApiRef.current;
    if (!api) return;
    const term = Array.isArray(api.terms) ? api.terms[api.terms.length - 1] : null;
    if (!term) return;
    setSearchSaveDialog({ term, rows: Array.isArray(api.zoneCRows) ? api.zoneCRows : [] });
  }, []);

  const handleSearchSaveConfirm = useCallback(async () => {
    setSearchSaveDialog(null);
    const created = await searchApiRef.current.saveFromResults();
    if (!created) return;
    handleUndoable(created, 'collections.undoCreated');
  }, [handleUndoable]);

  const searchResults = useMemo(() => {
    if (!searchModeActive) return null;
    // Save-affordance gate (routes/search.md §2.4 field rules): the button
    // renders only for an available, non-empty semantic section, and the
    // admin operator rule withholds the callback entirely.
    const canSaveResults = searchApi.semanticAvailable === true && searchApi.zoneCounts.zoneC > 0;
    return {
      mode: searchApi.mode,
      terms: searchApi.terms,
      zoneARows: searchApi.zoneARows,
      zoneBRows: searchApi.zoneBRows,
      zoneCRows: searchApi.zoneCRows,
      zoneCounts: searchApi.zoneCounts,
      zonesCollapsed,
      onToggleZone: handleToggleZone,
      onRevertToStep: searchApi.undoToStep,
      onExit: exitSearchAndResetInput,
      onLibraryAdd: handleSearchLibraryAdd,
      onSave: canSaveResults && !user?.is_admin ? handleSearchSave : undefined,
      onRowOpen: handleSearchRowOpen,
      onZoneThumbnailsLoaded: searchApi.handleZoneThumbnailsLoaded,
    };
  }, [
    searchModeActive,
    searchApi,
    zonesCollapsed,
    handleToggleZone,
    handleSearchLibraryAdd,
    handleSearchSave,
    handleSearchRowOpen,
    exitSearchAndResetInput,
    user,
  ]);

  // -- Collection-membership chips host (CollectionMembershipBadges.md §2.6) --
  // Batched `POST /collections/for-nodes` over the FILES-surface rows (session
  // listing + the current search-zone snapshots — the zones render through the
  // same row components). Names resolve through the already-fetched
  // `useCollections` list; admin/share-link sessions ride the inert seam
  // (operator rule: zero /api/collections IO). Listing payloads stay frozen:
  // the chips consume this SEPARATE read as a dedicated prop chain.
  const membershipNodeIds = useMemo(() => {
    // Zone rows arrive in the hook's CONVERTED explorer shape (`nodeId`);
    // `node_id` stays a defensive fallback for raw snapshot carriers.
    const ids = [];
    for (const row of files) {
      if (row?.nodeId != null) ids.push(row.nodeId);
    }
    for (const row of searchApi.zoneBRows ?? []) {
      const id = row?.nodeId ?? row?.node_id;
      if (id != null) ids.push(id);
    }
    for (const row of searchApi.zoneCRows ?? []) {
      const id = row?.nodeId ?? row?.node_id;
      if (id != null) ids.push(id);
    }
    // FilePropertiesDialog §3.2: the opened file's membership must exist even
    // when it is not a current listing row (member route, stale target).
    if (propertiesFile?.nodeId != null) ids.push(propertiesFile.nodeId);
    return ids;
  }, [files, searchApi.zoneBRows, searchApi.zoneCRows, propertiesFile?.nodeId]);

  const { membershipsByNodeId } = useCollectionMemberships({
    nodeIds: membershipNodeIds,
    collections: collectionsApi.collections,
    gateway: isShareLinkMode || user?.is_admin ? INERT_COLLECTIONS_GATEWAY : undefined,
  });

  // Dialog `Member of` chips (FilePropertiesDialog.md §3.2): the host slices the
  // map for the opened node and owns navigation (the dialog stays pure).
  const propertiesCollections = useMemo(() => {
    const nodeId = propertiesFile?.nodeId;
    if (nodeId == null) return EMPTY_PROPERTIES_COLLECTIONS;
    return membershipsByNodeId[nodeId] ?? EMPTY_PROPERTIES_COLLECTIONS;
  }, [propertiesFile?.nodeId, membershipsByNodeId]);

  // Chip click follows the collections member route with the same string-path
  // setter the cards/tree rows use; the dialog closes first (host owns close).
  const handleOpenCollectionFromProperties = useCallback(
    (collectionId) => {
      if (collectionId == null) return;
      closePropertiesDialog();
      setCurrentPath(`/__collections__/collection/${Number(collectionId)}`);
    },
    [closePropertiesDialog, setCurrentPath]
  );

  // Files-surface toolbar bulk add (BulkActionToolbar.md §3 merged into
  // FileManagerControls): selection keys ARE nodeIds for authenticated rows
  // (getEntryKey), resolved back to { nodeId, name } targets for the shell's
  // single AddToCollectionMenu instance. Membership is a collection-side
  // write — readable rows are addable (the file-write bulk gate does not
  // apply); the callback itself is withheld for admin/share-link sessions.
  const handleFilesBulkAddToCollection = useCallback(
    (keys) => {
      const keySet = new Set((keys ?? []).filter((key) => key != null));
      if (keySet.size === 0) return;
      const rowsByKey = new Map();
      for (const row of files) rowsByKey.set(String(getEntryKey(row)), row);
      for (const row of searchApi.zoneBRows ?? []) {
        rowsByKey.set(String(row.nodeId ?? row.node_id), row);
      }
      for (const row of searchApi.zoneCRows ?? []) {
        rowsByKey.set(String(row.nodeId ?? row.node_id), row);
      }
      const targetNodes = [];
      for (const key of keySet) {
        const row = rowsByKey.get(String(key));
        if (!row) continue;
        const nodeId = row.nodeId ?? row.node_id;
        if (nodeId == null) continue;
        targetNodes.push({ nodeId, name: row.name ?? row.basename ?? null });
      }
      if (targetNodes.length === 0) return;
      setAddMenu({ targetNodes, position: null });
    },
    [files, searchApi.zoneBRows, searchApi.zoneCRows]
  );

  // AddToCollectionMenu checkmarks (AddToCollectionMenu.md §2.2): collections
  // containing ALL targets. A target outside the fetched map ⇒ unknown ⇒ no
  // checkmarks (never guess). Member-surface targets (member rows) are not in
  // the FILES-surface map — the checkmark stays absent there, as today.
  const addMenuMembershipIds = useMemo(() => {
    const targets = addMenu?.targetNodeIds?.length
      ? addMenu.targetNodeIds
      : (addMenu?.targetNodes ?? []).map((node) => node?.nodeId);
    const ids = targets.filter((id) => id != null);
    if (ids.length === 0) return [];
    let intersection = null;
    for (const id of ids) {
      const entries = membershipsByNodeId[id];
      if (!Array.isArray(entries)) return [];
      const current = new Set(entries.map((entry) => entry.id));
      intersection =
        intersection === null
          ? current
          : new Set([...intersection].filter((collectionId) => current.has(collectionId)));
    }
    return intersection ? Array.from(intersection) : [];
  }, [addMenu, membershipsByNodeId]);

  const membershipModel = useMemo(
    () =>
      isShareLinkMode || user?.is_admin
        ? undefined
        : { membershipsByNodeId, onBulkAddToCollection: handleFilesBulkAddToCollection },
    [isShareLinkMode, user, membershipsByNodeId, handleFilesBulkAddToCollection]
  );

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
      memberViewMode,
      setMemberViewMode,
      likedViewMode,
      setLikedViewMode,
      memberSortMode,
      setMemberSortMode,
      sortMode,
      setSortMode,
      searchQuery,
      setSearchQuery: handleSearchQueryChange,
      // Share-link mode: server-wide search is an authenticated-explorer
      // feature — the bar stays typing-filter-only (FloatingSearchBar §3.2).
      onSubmitQuery: isShareLinkMode ? undefined : handleSessionSubmitQuery,
      llmConfigured,
    }),
    [
      currentPath,
      currentNodeId,
      viewMode,
      setViewMode,
      memberViewMode,
      setMemberViewMode,
      likedViewMode,
      setLikedViewMode,
      memberSortMode,
      setMemberSortMode,
      sortMode,
      setSortMode,
      searchQuery,
      handleSearchQueryChange,
      isShareLinkMode,
      handleSessionSubmitQuery,
      llmConfigured,
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

  // P-3: the shell's select-all source swaps by surface — collections list /
  // archive surfaces feed the CARD keys (synthetic path entries of the shared
  // selection Set), everything else keeps the file rows.
  const handleSelectAllForSurface = useCallback(() => {
    if (isCollectionsRoute || isCollectionsArchiveRoute) {
      setSelectedFiles(
        new Set(collectionsApi.collections.map((c) => getCollectionEntryKey(c.collection_id)))
      );
      return;
    }
    handleSelectAll();
  }, [
    isCollectionsRoute,
    isCollectionsArchiveRoute,
    collectionsApi.collections,
    setSelectedFiles,
    handleSelectAll,
  ]);

  const bulkStateProps = useMemo(
    () => ({
      handleSelectAll: handleSelectAllForSurface,
      handleDeselectAll,
      allSelectedHaveWrite,
      hasReadOnlyInSelection,
    }),
    [handleSelectAllForSurface, handleDeselectAll, allSelectedHaveWrite, hasReadOnlyInSelection]
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
      propertiesCollections,
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
      propertiesCollections,
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
      // Operator rule (PLAN §14 client half): admin is a pure operator —
      // like/add callbacks are WITHHELD (undefined ⇒ rows hidden, not
      // disabled; callback-withhold pattern, pages/FileManager.md §7).
      handleToggleLike: user?.is_admin ? undefined : handleToggleLike,
      handleOpenAddToCollection: user?.is_admin ? undefined : handleOpenAddToCollection,
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
      user,
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
      handleOpenCollectionFromProperties,
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
      handleOpenCollectionFromProperties,
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
        membershipModel={membershipModel}
      />
      {(isCollectionsMemberRoute || isCollectionsLikedRoute) && (
        <MemberRowControls
          open={Boolean(memberMenu)}
          anchorEl={memberMenu?.anchorEl ?? null}
          member={memberMenu?.member ?? null}
          // P-5: the liked surface has NO parent collection — structural
          // MemberRowControls gate + host callback omission (no membership
          // mutations exist for a like); download/reveal/properties/like ride
          // the same seams as members.
          collection={isCollectionsLikedRoute ? null : memberCollection}
          onExclude={isCollectionsLikedRoute ? undefined : handleMemberExclude}
          onPublish={isCollectionsLikedRoute ? undefined : handleMemberPublish}
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
          anchorEl={addMenu?.anchorEl ?? null}
          targetNodes={addMenu?.targetNodes ?? []}
          targetNodeIds={addMenu?.targetNodeIds ?? null}
          collections={writableCollections}
          membershipIds={addMenuMembershipIds}
          seedItemVisible={false}
          onAdd={handleAddMenuAdd}
          onCreateAndAdd={handleAddMenuCreateAndAdd}
          onCreateSeed={async () => {}}
          onClose={closeAddMenu}
        />
      )}
      <SearchSaveDialog
        open={searchSaveDialog != null}
        term={searchSaveDialog?.term ?? ''}
        rows={searchSaveDialog?.rows ?? []}
        onClose={() => setSearchSaveDialog(null)}
        onConfirm={handleSearchSaveConfirm}
      />
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
          <CollectionPropertiesDialog
            open={collectionPropsTarget != null}
            onClose={closeCollectionProps}
            collection={collectionPropsCollection}
            initialTab="sharing"
            aiFlags={{ embed: llmConfigured, chat: false }}
            onPatch={handleCollectionPropsPatch}
            grants={collectionGrants}
            shareableUsers={collectionShareableUsers}
            preview={collectionPreview}
            seedName={collectionSeedName}
            onGrant={handleCollectionGrant}
            onRevoke={handleCollectionRevoke}
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
