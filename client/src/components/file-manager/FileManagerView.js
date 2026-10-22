import React, { useMemo, useState } from 'react';
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
  IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AutoAwesome as AutoAwesomeIcon,
  CheckCircle as CheckCircleIcon,
  Cloud as CloudIcon,
  FolderOpen as FolderOpenIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';

import {
  FLOATING_BOTTOM_HEIGHT_MOBILE,
  FLOATING_BOTTOM_HEIGHT_DESKTOP,
  VIEW_MODES,
} from '../../constants/fileManager';
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
} from '.';
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
} from '../dialogs';
import { FolderTree } from '../folder-tree';
import CollectionsListView from './CollectionsListView';
import SearchQueryChipBar from './SearchQueryChipBar';
import { FileListSkeleton, FileGridSkeleton, FileDetailSkeleton } from './FileSkeletons';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { UndoToast } from '../feedback';

// -- Search results-mode zones (FileManagerView.md §3) — presentational
// composition only: rows, ordering, counts and callbacks all arrive prepared
// on the `searchResults` model (pure-view rule). Zone headers carry plain
// icons: A FolderOpen + path, B Cloud, C wand-stars (unmirrored).

const SearchZoneHeader = ({ zoneKey, icon, label, count, collapsed, onToggle }) => (
  <Box
    data-testid={`search-zone-header-${zoneKey}`}
    onClick={onToggle}
    sx={{
      position: 'sticky',
      top: 0,
      zIndex: 5,
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      py: 0.5,
      cursor: 'pointer',
      backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.7),
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid',
      borderColor: 'divider',
    }}
  >
    {icon}
    <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
      {label}
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
      {count}
    </Typography>
    <IconButton
      data-testid={`search-zone-toggle-${zoneKey}`}
      size="small"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      sx={{
        ml: 'auto',
        flexShrink: 0,
        color: 'primary.main',
        minWidth: 44,
        minHeight: 44,
      }}
    >
      {collapsed ? <KeyboardArrowDownIcon /> : <KeyboardArrowUpIcon />}
    </IconButton>
  </Box>
);

const SearchZone = ({
  zoneKey,
  label,
  count,
  rows,
  viewMode,
  collapsed,
  pending = false,
  onToggle,
  rendererProps,
}) => {
  const { displayedFiles, loadMoreRef, hasMore } = useInfiniteScroll(rows, {
    initialCount: 50,
    incrementCount: 50,
  });

  const icon =
    zoneKey === 'a' ? (
      <FolderOpenIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
    ) : zoneKey === 'b' ? (
      <CloudIcon
        data-testid="search-zone-glyph-b"
        fontSize="small"
        sx={{ color: 'text.secondary', flexShrink: 0 }}
      />
    ) : (
      <AutoAwesomeIcon
        data-testid="search-zone-glyph-c"
        fontSize="small"
        sx={{ color: 'text.secondary', flexShrink: 0 }}
      />
    );

  const renderRows = () => {
    if (pending) return <SearchZoneSkeleton viewMode={viewMode} />;
    if (rows.length === 0) return null;
    if (viewMode === VIEW_MODES.GRID) {
      return (
        <FileGrid
          {...rendererProps}
          files={displayedFiles}
          loadMoreRef={loadMoreRef}
          hasMore={hasMore}
        />
      );
    }
    if (viewMode === VIEW_MODES.DETAIL) {
      return <FileDetail {...rendererProps} files={displayedFiles} />;
    }
    return (
      <FileList
        {...rendererProps}
        files={displayedFiles}
        loadMoreRef={loadMoreRef}
        hasMore={hasMore}
      />
    );
  };

  return (
    <Box>
      <SearchZoneHeader
        zoneKey={zoneKey}
        icon={icon}
        label={label}
        count={count}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      <Collapse in={!collapsed} unmountOnExit>
        {renderRows()}
      </Collapse>
    </Box>
  );
};

const SearchZoneSkeleton = ({ viewMode }) => (
  <Box data-testid="search-zone-skeleton">
    {viewMode === VIEW_MODES.GRID ? (
      <FileGridSkeleton count={4} />
    ) : viewMode === VIEW_MODES.DETAIL ? (
      <FileDetailSkeleton count={4} />
    ) : (
      <FileListSkeleton count={4} />
    )}
  </Box>
);

const FileManagerView = ({
  shareContext,
  shellContext,
  overlayState,
  explorerSession,
  selectionState,
  explorerActionState,
  dialogState,
  messaging,
  explorerHandlers,
  trashState,
  collectionsModel,
  searchResults,
}) => {
  const { t } = useTranslation();
  const { shareToken, isShareLinkMode, shareRootPath, shareRootName, shareRootNodeId } =
    shareContext;
  const {
    user,
    navigate,
    isMobile,
    fileContentRef,
    scrollContainerRef,
    backendHealth,
    activeFileStorage,
    activeMetadataBackend,
  } = shellContext;
  const {
    drawerOpen,
    setDrawerOpen,
    progressDrawerOpen,
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
    setLeaveShareConfirmTargetNodeId,
    setLeaveShareConfirmTargetPath,
    handleLeaveShareConfirm,
  } = overlayState;
  const { controlsState, listingState } = explorerSession;
  // DEF-16 P9: trash view overlay state (must destructure before any use).
  const {
    trashMode,
    trail: trashTrail,
    canEmptyTrash,
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
  } = trashState ?? {};
  const {
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
    setSearchQuery,
    onSubmitQuery,
    llmConfigured = false,
    onSearchBarExpandedChange,
  } = controlsState;
  // AI-platform §3: results-mode surface — the shell prepares the model; the
  // view swaps the breadcrumb row for the chip bar and hosts the accordion
  // zones inside the listing (no separate overlay surface exists).
  const searchResultsMode = searchResults?.mode === 'results';
  const searchPending = searchResults?.mode === 'pending';
  const searchSurfaceActive = Boolean(searchResults) && (searchResultsMode || searchPending);
  // FAB ↔ search-button morph truth (FloatingSearchBar §2.5 — the bar reports
  // it; the FAB is controlled-mount through this boolean).
  const [searchBarMorphed, setSearchBarMorphed] = useState(false);
  const isTrashView = trashMode === true || currentPath === '/__trash__';
  // P-2: the single toolbar sort button swaps its menu by surface — collections
  // list AND archive surfaces show the 5 server options (ephemeral), everything
  // else keeps the files radio menu.
  // P-4 toggle contract: the collections LIST/ARCHIVE surfaces hide the
  // view-mode buttons (grid-parity cards); the MEMBERS surface keeps the sort
  // HIDDEN (server-fixed activity→node_id order) but SHOWS the three view-mode
  // buttons bound to the per-surface `memberViewMode` key (file viewMode
  // untouched) — the P-3 inert flags retire here.
  const isCollectionsListSurface = collectionsModel?.mode === 'list';
  const isCollectionsMemberSurface = collectionsModel?.mode === 'members';
  // P-5: the Likes surface is a member-parity CONSUMER of the same mode — the
  // shell flags it (likedSurface) so ONLY the view-mode key binding swaps
  // (`likedViewMode`); sort/bulk stay member-treated, banners never arrive
  // (the liked model omits digest/publishPendingCount/onPublishBatch).
  const isCollectionsLikedSurface =
    isCollectionsMemberSurface && collectionsModel?.likedSurface === true;
  const memberSurfaceViewMode = isCollectionsLikedSurface ? likedViewMode : memberViewMode;
  const setMemberSurfaceViewMode = isCollectionsLikedSurface ? setLikedViewMode : setMemberViewMode;
  // M-9: the member-route breadcrumb NAME resolves from the shell's already-fetched
  // useCollections list (matched by collectionId). null ⇒ Breadcrumb renders the
  // transient ellipsis segment (owner option (a) — the trail never hides).
  const memberCollectionName = useMemo(() => {
    if (!isCollectionsMemberSurface || isCollectionsLikedSurface) return null;
    const found = (collectionsModel?.collections ?? []).find(
      (collection) => collection.collection_id === collectionsModel?.collectionId
    );
    return found?.name ?? null;
  }, [isCollectionsMemberSurface, isCollectionsLikedSurface, collectionsModel]);
  // FAB가 자신의 실제 표시 여부를 보고(single source of truth) — 검색창 확장 트리거로 사용
  const [fabPresent, setFabPresent] = useState(false);
  const { displayedFiles, loading, processingMap, handleThumbnailsLoaded, loadMoreRef, hasMore } =
    listingState;
  const { selectionModel, bulkState } = selectionState;
  const { selectionMode, selectedFiles, handleFileCheck } = selectionModel;
  const { handleSelectAll, handleDeselectAll, allSelectedHaveWrite, hasReadOnlyInSelection } =
    bulkState;
  const { capabilityState, treeState, transferState } = explorerActionState;
  const { hasWritePermission } = capabilityState;
  const { treeUpdateTrigger } = treeState;
  const { contentAreaDraggedNodeId, bulkMoveCopyInProgress } = transferState;
  const { actionContext, pickerState, modalDialogs, fileTargets } = dialogState;
  const { actionSheetOpen, closeActionSheet, actionSheetFile, contextMenu, setContextMenu } =
    actionContext;
  const {
    mobilePickerFile,
    setMobilePickerFile,
    mobilePickerAction,
    setMobilePickerAction,
    folderPickerOpen,
    folderPickerAction,
    setFolderPickerOpen,
    setFolderPickerAction,
  } = pickerState;
  const {
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
  } = modalDialogs;
  const {
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
  } = fileTargets;
  const { dropMessage, setDropMessage, message, clearMessage, showError, showWarning } = messaging;
  const { interaction, commands, progress, refreshIndicator } = explorerHandlers;
  const {
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
  } = interaction;
  // T0.5: like rows render only where the set seam applies — share-link and
  // trash views withhold the callback (hidden, not disabled; §3.1).
  const likeToggleHandler = isShareLinkMode || isTrashView ? undefined : handleToggleLike;
  const {
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
  } = commands;
  const {
    progressItems,
    updateProgress,
    handleRetryUpload,
    handleCancelUploadFileWrapper,
    handleCancelAllWrapper,
  } = progress;
  const {
    indicatorStyles,
    iconStyles,
    isDeterminateProgress,
    progress: refreshProgress,
    progressColor,
    textColor,
    shouldShowIndicator,
    showRefreshSuccess,
    textContent,
  } = refreshIndicator;

  // §3 results-mode zones — view-ready rows/callbacks from the shell-prepared
  // `searchResults` model; the view only pages (50+50 per zone) and swaps
  // regions. Row identity/ordering/promotion are `useSearchResults`-owned.
  const zoneARows = searchResults?.zoneARows ?? [];
  const zoneBRows = searchResults?.zoneBRows ?? [];
  const zoneCRows = searchResults?.zoneCRows ?? [];
  const zoneCounts = searchResults?.zoneCounts ?? { zoneA: 0, zoneB: 0, zoneC: 0 };
  const zonesCollapsed = searchResults?.zonesCollapsed ?? {};
  const zoneRendererProps = {
    processingMap,
    onFileClick: searchResults?.onRowOpen,
    onMoreClick: handleMoreClick,
    showMoreButton: !selectionMode,
    onLongPressSelect: handleLongPressSelect,
    onContextMenu: handleViewContextMenu,
    onFileDrop: handleFileDrop,
    onDropPermissionDenied: handleDropPermissionDenied,
    onDragStart: handleDragStartFromView,
    onDragEnd: handleDragEndFromView,
    internalDraggedNodeId: contentAreaDraggedNodeId,
    selectionMode,
    selectedFiles,
    onFileCheck: handleFileCheck,
    loading: false,
    onThumbnailsLoaded: handleThumbnailsLoaded,
  };
  // Zone B/C rows are snapshot entries, not session rows — their lazy-load
  // answers land on the zone-local merge in `useSearchResults` (view stays
  // pure); Zone A rows ARE session rows and keep the session merge above.
  const zoneServerRendererProps = {
    ...zoneRendererProps,
    onThumbnailsLoaded: searchResults?.onZoneThumbnailsLoaded ?? handleThumbnailsLoaded,
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
      {!isShareLinkMode || (isShareLinkMode && user) ? (
        <FileManagerHeader isMobile={isMobile} user={user} navigate={navigate} />
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
                currentNodeId={currentNodeId}
                currentPath={currentPath}
                ancestors={ancestors}
                onNodeClick={handleFolderTreeNodeClick}
                onLeaveShareClick={isShareLinkMode ? handleLeaveSharePathClick : undefined}
                onFileClick={handleFileClick}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
                hasWritePermission={hasWritePermission}
                onExplorerDrop={handleExplorerDrop}
                onInternalFileDrop={handleInternalFileDrop}
                onInternalDragStart={handleDragStartFromView}
                onInternalDragEnd={handleDragEndFromView}
                internalDraggedNodeId={contentAreaDraggedNodeId}
                isMobile={false}
                shareLinkSection={
                  isShareLinkMode
                    ? {
                        shareRootNodeId,
                        shareRootPath,
                        shareRootName,
                        shareToken,
                        onNodeClick: handleFolderTreeNodeClick,
                      }
                    : undefined
                }
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
        >
          {searchSurfaceActive ? (
            <SearchQueryChipBar
              terms={searchResults.terms ?? []}
              isMobile={isMobile}
              inExpandSlot={isMobile}
              onRevertToStep={searchResults.onRevertToStep}
              onExit={searchResults.onExit}
              onLibraryAdd={searchResults.onLibraryAdd}
              onSave={searchResults.onSave}
            />
          ) : (
            <Breadcrumb
              currentPath={currentPath}
              collectionName={isCollectionsMemberSurface ? memberCollectionName : undefined}
              ancestors={isTrashView ? (trashTrail ?? []) : ancestors}
              onNodeClick={isTrashView ? handleTrashBreadcrumbClick : handleFolderTreeNodeClick}
              {...(isShareLinkMode
                ? { shareRootPath, shareRootName, showFolderTreeToggle: true }
                : { user })}
              {...(isMobile
                ? {
                    onToggleFolderTree: () => setDrawerOpen(!drawerOpen),
                    isFolderTreeOpen: drawerOpen,
                  }
                : {})}
            />
          )}

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
                  currentNodeId={currentNodeId}
                  currentPath={currentPath}
                  ancestors={ancestors}
                  onNodeClick={(target) => {
                    handleFolderTreeNodeClick(target);
                    setDrawerOpen(false);
                  }}
                  onLeaveShareClick={(target) => {
                    handleLeaveSharePathClick(target);
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
                  internalDraggedNodeId={contentAreaDraggedNodeId}
                  isMobile
                  shareLinkSection={
                    isShareLinkMode
                      ? {
                          shareRootNodeId,
                          shareRootPath,
                          shareRootName,
                          shareToken,
                          onNodeClick: (target) => {
                            handleFolderTreeNodeClick(target);
                            setDrawerOpen(false);
                          },
                        }
                      : undefined
                  }
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
            sortMode={isCollectionsMemberSurface ? memberSortMode : sortMode}
            setSortMode={isCollectionsMemberSurface ? setMemberSortMode : setSortMode}
            sortSurface={isCollectionsListSurface ? 'collections' : 'files'}
            collectionSort={isCollectionsListSurface ? collectionsModel.sort : undefined}
            onCollectionSortChange={
              isCollectionsListSurface ? collectionsModel.onSortChange : undefined
            }
            viewModeHidden={isCollectionsListSurface}
            memberMode={isCollectionsMemberSurface}
            collectionsMode={isCollectionsListSurface}
            collectionsArchiveView={
              isCollectionsListSurface && collectionsModel.include === 'mine,archived'
            }
            onCollectionsBulkAction={
              isCollectionsListSurface ? collectionsModel.onBulkAction : undefined
            }
            onBulkMemberExclude={
              isCollectionsMemberSurface ? collectionsModel.onBulkMemberExclude : undefined
            }
            onBulkAddToCollection={
              isCollectionsMemberSurface ? collectionsModel.onBulkAddToCollection : undefined
            }
            viewMode={isCollectionsMemberSurface ? memberSurfaceViewMode : viewMode}
            setViewMode={isCollectionsMemberSurface ? setMemberSurfaceViewMode : setViewMode}
            selectionActionsDisabled={bulkMoveCopyInProgress}
            handleBulkMove={handleBulkMove}
            handleBulkCopy={handleBulkCopy}
            handleBulkDownload={handleBulkDownload}
            openBulkDeleteDialog={openBulkDeleteDialog}
            bulkWritePermission={isShareLinkMode ? false : allSelectedHaveWrite}
            hasReadOnlyInSelection={hasReadOnlyInSelection}
            bulkActionsDisabled={bulkMoveCopyInProgress}
            downloadOnly={isShareLinkMode}
            trashMode={isTrashView}
            handleBulkRestore={isTrashView ? openRestoreConfirm : undefined}
            handleBulkPurge={isTrashView ? openPurgeConfirm : undefined}
            onEmptyTrash={isTrashView && canEmptyTrash ? openEmptyTrashConfirm : undefined}
          />

          {user &&
            !isShareLinkMode &&
            backendHealth &&
            ((activeFileStorage && backendHealth[activeFileStorage] === 'fail') ||
              (activeMetadataBackend === 'postgresql' && backendHealth.postgresql === 'fail')) && (
              <Alert severity="warning" sx={{ mx: 2, mb: 1 }} data-testid="backend-health-banner">
                {user?.is_admin
                  ? t('admin.health.banner')
                  : activeMetadataBackend === 'postgresql' && backendHealth.postgresql === 'fail'
                    ? t('files.maintenanceNotice')
                    : t('files.storageUnavailable')}
              </Alert>
            )}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
            onDragEnter={contentAreaDnD.handleContentAreaDragEnter}
            onDragOver={contentAreaDnD.handleContentAreaDragOver}
            onDragLeave={contentAreaDnD.handleContentAreaDragLeave}
            onDrop={contentAreaDnD.handleContentAreaDrop}
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
                  {contentAreaDragType === 'internal'
                    ? t('fileManager.moveDropHere')
                    : t('dialogs.uploadDropHere')}
                </Typography>
              </Box>
            )}

            <Box
              ref={scrollContainerRef}
              onClick={handleScrollAreaClick}
              data-testid="explorer-container"
              sx={{
                flex: 1,
                overflow: 'auto',
                p: 2,
                minHeight: 0,
                position: 'relative',
                pb: `calc(${isMobile ? FLOATING_BOTTOM_HEIGHT_MOBILE : FLOATING_BOTTOM_HEIGHT_DESKTOP}px + env(safe-area-inset-bottom))`,
                WebkitOverflowScrolling: 'touch',
                overscrollBehaviorY: 'contain',
                touchAction: 'pan-y',
              }}
            >
              {isMobile && (
                <Box
                  data-testid="refresh-indicator"
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
                        value={isDeterminateProgress ? refreshProgress * 100 : undefined}
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

              {searchSurfaceActive ? (
                <Box sx={{ display: 'grid', gap: 2 }}>
                  {zoneCounts.zoneA > 0 && (
                    <SearchZone
                      zoneKey="a"
                      label={currentPath}
                      count={zoneCounts.zoneA}
                      rows={zoneARows}
                      viewMode={viewMode}
                      pending={searchPending}
                      collapsed={zonesCollapsed.a === true && !searchPending}
                      onToggle={() => searchResults.onToggleZone?.('a')}
                      rendererProps={zoneRendererProps}
                    />
                  )}
                  {zoneCounts.zoneB > 0 && (
                    <SearchZone
                      zoneKey="b"
                      label={t('fileManager.searchZoneAllResults')}
                      count={zoneCounts.zoneB}
                      rows={zoneBRows}
                      viewMode={viewMode}
                      pending={searchPending}
                      collapsed={zonesCollapsed.b === true && !searchPending}
                      onToggle={() => searchResults.onToggleZone?.('b')}
                      rendererProps={zoneServerRendererProps}
                    />
                  )}
                  {zoneCounts.zoneC > 0 && (
                    <SearchZone
                      zoneKey="c"
                      label={t('fileManager.searchZoneSuggestedResults')}
                      count={zoneCounts.zoneC}
                      rows={zoneCRows}
                      viewMode={viewMode}
                      pending={searchPending}
                      collapsed={zonesCollapsed.c === true && !searchPending}
                      onToggle={() => searchResults.onToggleZone?.('c')}
                      rendererProps={zoneServerRendererProps}
                    />
                  )}
                  {zoneCounts.zoneA === 0 &&
                    zoneCounts.zoneB === 0 &&
                    zoneCounts.zoneC === 0 &&
                    (searchPending ? (
                      <SearchZoneSkeleton viewMode={viewMode} />
                    ) : (
                      <Typography
                        data-testid="search-no-results"
                        variant="body2"
                        color="text.secondary"
                        sx={{ py: 1 }}
                      >
                        {t('fileManager.searchNoResults')}
                      </Typography>
                    ))}
                </Box>
              ) : collectionsModel ? (
                /* AI-platform §3: __collections__ virtual node replaces the FileList
                   region (list cards / member rows) — no file-grid fallback. */
                <CollectionsListView
                  mode={collectionsModel.mode}
                  collections={collectionsModel.collections}
                  sort={collectionsModel.sort}
                  mergeSlot={collectionsModel.mergeSlot}
                  include={collectionsModel.include}
                  onPseudoTileNavigate={collectionsModel.onPseudoTileNavigate}
                  items={collectionsModel.items}
                  memberViewMode={memberSurfaceViewMode}
                  memberSortMode={isCollectionsMemberSurface ? memberSortMode : undefined}
                  memberLoading={loading}
                  onMemberRowClick={handleFileClick}
                  onMemberRowCheck={handleFileCheck}
                  onMemberRowLongPressSelect={handleLongPressSelect}
                  onMemberThumbnailsLoaded={collectionsModel.onMemberThumbnailsLoaded}
                  digest={collectionsModel.digest}
                  publishPendingCount={collectionsModel.publishPendingCount}
                  onCardAction={collectionsModel.onCardAction}
                  onMemberAction={collectionsModel.onMemberAction}
                  onPublishBatch={collectionsModel.onPublishBatch}
                  selectionMode={selectionMode}
                  selectedFiles={selectedFiles}
                  onCardClick={collectionsModel.onCardClick}
                  onCardLongPressSelect={collectionsModel.onCardLongPressSelect}
                  previewThumbnails={collectionsModel.previewThumbnails}
                  onPreviewThumbnailsLoaded={collectionsModel.onPreviewThumbnailsLoaded}
                  bulkConfirm={collectionsModel.bulkConfirm}
                  onBulkConfirm={collectionsModel.onBulkConfirm}
                  onBulkConfirmDismiss={collectionsModel.onBulkConfirmDismiss}
                />
              ) : viewMode === VIEW_MODES.LIST ? (
                <FileList
                  files={displayedFiles}
                  processingMap={processingMap}
                  onFileClick={handleFileClick}
                  onMoreClick={handleMoreClick}
                  showMoreButton={!selectionMode}
                  onLongPressSelect={handleLongPressSelect}
                  onContextMenu={handleViewContextMenu}
                  onFileDrop={handleFileDrop}
                  onDropPermissionDenied={handleDropPermissionDenied}
                  onDragStart={handleDragStartFromView}
                  onDragEnd={handleDragEndFromView}
                  internalDraggedNodeId={contentAreaDraggedNodeId}
                  selectionMode={selectionMode}
                  selectedFiles={selectedFiles}
                  onFileCheck={handleFileCheck}
                  loading={loading}
                  onThumbnailsLoaded={handleThumbnailsLoaded}
                  loadMoreRef={loadMoreRef}
                  hasMore={hasMore}
                  shareToken={isShareLinkMode ? shareToken : undefined}
                  emptyText={isTrashView ? t('fileManager.trashEmpty') : undefined}
                />
              ) : viewMode === VIEW_MODES.GRID ? (
                <FileGrid
                  files={displayedFiles}
                  processingMap={processingMap}
                  onFileClick={handleFileClick}
                  onMoreClick={handleMoreClick}
                  showMoreButton={!selectionMode}
                  onLongPressSelect={handleLongPressSelect}
                  onContextMenu={handleViewContextMenu}
                  onFileDrop={handleFileDrop}
                  onDropPermissionDenied={handleDropPermissionDenied}
                  onDragStart={handleDragStartFromView}
                  onDragEnd={handleDragEndFromView}
                  internalDraggedNodeId={contentAreaDraggedNodeId}
                  selectionMode={selectionMode}
                  selectedFiles={selectedFiles}
                  onFileCheck={handleFileCheck}
                  loading={loading}
                  onThumbnailsLoaded={handleThumbnailsLoaded}
                  loadMoreRef={loadMoreRef}
                  hasMore={hasMore}
                  shareToken={isShareLinkMode ? shareToken : undefined}
                  emptyText={isTrashView ? t('fileManager.trashEmpty') : undefined}
                />
              ) : (
                <FileDetail
                  files={displayedFiles}
                  processingMap={processingMap}
                  onFileClick={handleFileClick}
                  onMoreClick={handleMoreClick}
                  showMoreButton={!selectionMode}
                  onLongPressSelect={handleLongPressSelect}
                  onContextMenu={handleViewContextMenu}
                  onFileDrop={handleFileDrop}
                  onDropPermissionDenied={handleDropPermissionDenied}
                  onDragStart={handleDragStartFromView}
                  onDragEnd={handleDragEndFromView}
                  internalDraggedNodeId={contentAreaDraggedNodeId}
                  selectionMode={selectionMode}
                  selectedFiles={selectedFiles}
                  onFileCheck={handleFileCheck}
                  loading={loading}
                  shareToken={isShareLinkMode ? shareToken : undefined}
                  emptyText={isTrashView ? t('fileManager.trashEmpty') : undefined}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {!isShareLinkMode && (
        <>
          <UploadDialog
            open={uploadDialogOpen}
            onClose={closeUploadDialog}
            parentNodeId={currentNodeId ?? null}
            onUploadStart={handleUploadStart}
          />
          <CreateFolderDialog
            open={createFolderDialogOpen}
            onClose={closeCreateFolderDialog}
            onComplete={handleCreateFolderComplete}
            currentPath={currentPath}
            parentNodeId={currentNodeId ?? null}
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
          setLeaveShareConfirmTargetNodeId(null);
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
        onDownload={
          isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                handleFileDownloadOp(file);
              }
        }
        onRename={
          isShareLinkMode || isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                openRenameDialog(file);
              }
        }
        onMove={
          isShareLinkMode || isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                setMobilePickerFile(file);
                setMobilePickerAction('move');
                setFolderPickerAction('move');
                setFolderPickerOpen(true);
              }
        }
        onCopy={
          isShareLinkMode || isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                setMobilePickerFile(file);
                setMobilePickerAction('copy');
                setFolderPickerAction('copy');
                setFolderPickerOpen(true);
              }
        }
        onToggleLike={likeToggleHandler}
        onAddToCollection={
          isShareLinkMode || isTrashView || !handleOpenAddToCollection
            ? undefined
            : (file) => {
                // The closure captures the still-open contextMenu position
                // (handleAction closes the menu before invoking the callback),
                // anchoring the shell-owned submenu at the same spot.
                handleOpenAddToCollection(file, {
                  mouseX: contextMenu?.mouseX ?? 0,
                  mouseY: contextMenu?.mouseY ?? 0,
                });
              }
        }
        onShare={
          isShareLinkMode || isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                openShareDialogV2(file);
              }
        }
        onProperties={
          isShareLinkMode
            ? undefined
            : (file) => {
                setContextMenu(null);
                openPropertiesDialog(file);
              }
        }
        onDelete={
          isShareLinkMode || isTrashView
            ? undefined
            : (file) => {
                setContextMenu(null);
                openBulkDeleteDialog([file.nodeId]);
              }
        }
        onRestore={
          isTrashView
            ? (file) => {
                setContextMenu(null);
                handleTrashRestore(file);
              }
            : undefined
        }
        onPurge={
          isTrashView
            ? (file) => {
                setContextMenu(null);
                openPurgeConfirm([file.nodeId]);
              }
            : undefined
        }
      />

      <FolderPickerDialog
        open={folderPickerOpen}
        onClose={() => {
          setFolderPickerOpen(false);
          setFolderPickerAction(null);
          if (mobilePickerFile) {
            setMobilePickerFile(null);
            setMobilePickerAction(null);
          }
        }}
        onSelect={(selectedNodeId) => {
          const sourceNodeIds = mobilePickerFile
            ? [mobilePickerFile.nodeId]
            : actionSheetFile
              ? [actionSheetFile.nodeId]
              : Array.from(selectedFiles);
          if (sourceNodeIds.length > 0 && folderPickerAction) {
            handleFolderPickerSelect(selectedNodeId, {
              type: folderPickerAction,
              nodeIds: sourceNodeIds,
            });
          }
        }}
        title={
          mobilePickerFile
            ? `${mobilePickerAction === 'move' ? t('actions.move') : t('actions.copy')}: ${mobilePickerFile.basename}`
            : folderPickerAction === 'move'
              ? t('dialogs.moveFolderSelect')
              : t('dialogs.copyFolderSelect')
        }
        currentNodeId={currentNodeId}
        user={user}
        action={folderPickerAction}
        sourceNodeId={
          mobilePickerFile
            ? mobilePickerFile.nodeId
            : actionSheetFile
              ? actionSheetFile.nodeId
              : undefined
        }
        sourceNodeIds={
          !mobilePickerFile &&
          !actionSheetFile &&
          (folderPickerAction === 'copy' || folderPickerAction === 'move')
            ? Array.from(selectedFiles)
            : undefined
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

      {message.action ? (
        /* useMessage action slot (undo toasts, T0.7): the snackbar host renders
           the action variant through UndoToast — [icon] {text} [action]. */
        <UndoToast
          show={message.show}
          text={message.text}
          type={message.type}
          action={{
            label: t(message.action.labelKey),
            onAction: message.action.onClick,
            disabled: message.action.disabled,
          }}
          onClose={clearMessage}
        />
      ) : (
        <Snackbar
          open={message.show}
          autoHideDuration={message.type === 'error' ? 5000 : 3000}
          onClose={clearMessage}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={clearMessage} severity={message.type} sx={{ width: '100%' }}>
            {message.text}
          </Alert>
        </Snackbar>
      )}

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

      {(!isShareLinkMode || (isShareLinkMode && user)) && (
        <FloatingSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isMobile={isMobile}
          fabVisible={fabPresent}
          {...(onSubmitQuery
            ? {
                onSubmitQuery,
                resultsModeActive: searchResultsMode || searchPending,
                isPending: searchPending,
                llmConfigured,
                onExpandedChange: (isExpanded) => {
                  setSearchBarMorphed(isExpanded);
                  if (typeof onSearchBarExpandedChange === 'function') {
                    onSearchBarExpandedChange(isExpanded);
                  }
                },
              }
            : {})}
        />
      )}

      {!selectionMode &&
        (isShareLinkMode ? (
          <FAB
            shareLinkMode={{
              user,
              onLoginClick: () => setLoginModalOpen(true),
              onAddToSharedClick: openAddToSharedModal,
            }}
            isMobile={isMobile}
            onVisibilityChange={setFabPresent}
            morphed={searchBarMorphed}
          />
        ) : (
          <FAB
            onUpload={openUploadDialog}
            onCreateFolder={openCreateFolderDialog}
            hasWritePermission={hasWritePermission}
            isMobile={isMobile}
            onVisibilityChange={setFabPresent}
            morphed={searchBarMorphed}
          />
        ))}

      {isMobile && (
        <FileActionSheet
          open={actionSheetOpen}
          onClose={closeActionSheet}
          file={actionSheetFile}
          hasWritePermission={isShareLinkMode ? false : hasWritePermission}
          user={user}
          onDownload={isTrashView ? undefined : handleActionSheetDownload}
          onRename={
            isShareLinkMode || isTrashView
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    openRenameDialog(actionSheetFile);
                  }
                }
          }
          onMove={
            isShareLinkMode || isTrashView
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    setMobilePickerFile(actionSheetFile);
                    setMobilePickerAction('move');
                    setFolderPickerAction('move');
                    setFolderPickerOpen(true);
                  }
                }
          }
          onCopy={
            isShareLinkMode || isTrashView
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    setMobilePickerFile(actionSheetFile);
                    setMobilePickerAction('copy');
                    setFolderPickerAction('copy');
                    setFolderPickerOpen(true);
                  }
                }
          }
          onDelete={
            isShareLinkMode || isTrashView
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    openBulkDeleteDialog([actionSheetFile.nodeId]);
                  }
                }
          }
          onShare={
            isShareLinkMode || isTrashView
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    openShareDialogV2(actionSheetFile);
                  }
                }
          }
          onPreview={
            isTrashView ? undefined : isShareLinkMode ? undefined : handleActionSheetPreview
          }
          onToggleLike={likeToggleHandler}
          onAddToCollection={
            isShareLinkMode || isTrashView || !handleOpenAddToCollection
              ? undefined
              : (file) => {
                  // The sheet closes before invoking (handleAction); the
                  // shell-owned AddToCollectionMenu opens viewport-centered —
                  // the mobile analogue of the context-menu-anchored desktop
                  // flow (FileManager.md §7 host wiring).
                  handleOpenAddToCollection(file, {
                    mouseX: Math.max(16, window.innerWidth / 2 - 140),
                    mouseY: Math.max(16, window.innerHeight / 2 - 120),
                  });
                }
          }
          onProperties={
            isShareLinkMode
              ? undefined
              : () => {
                  if (actionSheetFile) {
                    openPropertiesDialog(actionSheetFile);
                  }
                }
          }
          onRestore={
            isTrashView
              ? () => {
                  closeActionSheet();
                  handleTrashRestore(actionSheetFile);
                }
              : undefined
          }
          onPurge={
            isTrashView
              ? () => {
                  closeActionSheet();
                  if (actionSheetFile) {
                    openPurgeConfirm([actionSheetFile.nodeId]);
                  }
                }
              : undefined
          }
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
              onSave={onShareTargetSave}
            />
          )}
          {(mobileShareFile || actionSheetFile) && (
            <ShareDialog
              open={shareDialogOpen}
              onClose={closeShareDialog}
              folderNodeId={
                (mobileShareFile || actionSheetFile)?.type === 'directory'
                  ? (mobileShareFile || actionSheetFile)?.nodeId
                  : null
              }
              folderPath={
                (mobileShareFile || actionSheetFile)?.type === 'directory'
                  ? (mobileShareFile || actionSheetFile)?.path
                  : null
              }
              folderName={
                (mobileShareFile || actionSheetFile)?.type === 'directory'
                  ? (mobileShareFile || actionSheetFile)?.basename ||
                    (mobileShareFile || actionSheetFile)?.name
                  : null
              }
              user={user}
              onMessage={setDropMessage}
              enableExternalShare={(mobileShareFile || actionSheetFile)?.type !== 'directory'}
              fileNodeId={
                (mobileShareFile || actionSheetFile)?.type !== 'directory'
                  ? (mobileShareFile || actionSheetFile)?.nodeId
                  : null
              }
              fileName={
                (mobileShareFile || actionSheetFile)?.type !== 'directory'
                  ? (mobileShareFile || actionSheetFile)?.basename ||
                    (mobileShareFile || actionSheetFile)?.name
                  : null
              }
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
            operationType={
              bulkConflictData?.action === 'move' ? t('actions.move') : t('actions.copy')
            }
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

      {propertiesFile && (
        <FilePropertiesDialog
          open={propertiesDialogOpen}
          onClose={closePropertiesDialog}
          file={propertiesFile}
          activeFileStorage={activeFileStorage}
          {...(likeToggleHandler &&
          propertiesFile?.isRecentFile !== true &&
          propertiesFile?.isTrashed !== true
            ? { onToggleLike: likeToggleHandler }
            : {})}
          onTrashRestore={isTrashView ? handleTrashRestore : undefined}
          onTrashPurge={isTrashView ? handleTrashPurge : undefined}
        />
      )}

      {/* DEF-16 P9: trash confirm dialogs (restore / permanent delete / empty). */}
      <ConfirmDialog
        open={restoreConfirmState != null}
        onClose={closeRestoreConfirm}
        onConfirm={confirmRestore}
        title={t('actions.restore')}
        message={t('dialogs.restoreConfirm', {
          count: restoreConfirmState?.nodeIds?.length ?? 0,
        })}
        confirmText={t('actions.restore')}
        cancelText={t('common.cancel')}
        confirmColor="error"
      />
      <ConfirmDialog
        open={purgeConfirmState != null}
        onClose={closePurgeConfirm}
        onConfirm={confirmPurge}
        title={t('actions.purge')}
        message={t('dialogs.purgeBulkMessage', {
          count: purgeConfirmState?.nodeIds?.length ?? 0,
        })}
        confirmText={t('actions.purge')}
        cancelText={t('common.cancel')}
        confirmColor="error"
      />
      <ConfirmDialog
        open={emptyTrashConfirmOpen}
        onClose={closeEmptyTrashConfirm}
        onConfirm={confirmEmptyTrash}
        title={t('actions.emptyTrash')}
        message={t('dialogs.emptyTrashConfirm')}
        confirmText={t('actions.emptyTrash')}
        cancelText={t('common.cancel')}
        confirmColor="error"
      />
    </Box>
  );
};

export default FileManagerView;
