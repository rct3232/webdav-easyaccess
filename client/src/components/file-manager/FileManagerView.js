import React from 'react';
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

import { FLOATING_BOTTOM_HEIGHT_MOBILE, FLOATING_BOTTOM_HEIGHT_DESKTOP, VIEW_MODES } from '../../constants/fileManager';
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
}) => {
  const { t } = useTranslation();
  const {
    shareToken,
    isShareLinkMode,
    shareRootPath,
    shareRootName,
  } = shareContext;
  const {
    user,
    navigate,
    isMobile,
    fileContentRef,
    scrollContainerRef,
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
    setLeaveShareConfirmTargetPath,
    handleLeaveShareConfirm,
  } = overlayState;
  const {
    controlsState,
    listingState,
  } = explorerSession;
  const {
    currentPath,
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    searchQuery,
    setSearchQuery,
  } = controlsState;
  const {
    displayedFiles,
    loading,
    processingMap,
    handleThumbnailsLoaded,
    loadMoreRef,
    hasMore,
  } = listingState;
  const {
    selectionModel,
    bulkState,
  } = selectionState;
  const {
    selectionMode,
    selectedFiles,
    handleFileCheck,
  } = selectionModel;
  const {
    handleSelectAll,
    handleDeselectAll,
    allSelectedHaveWrite,
    hasReadOnlyInSelection,
  } = bulkState;
  const {
    capabilityState,
    treeState,
    transferState,
  } = explorerActionState;
  const {
    hasWritePermission,
  } = capabilityState;
  const {
    treeUpdateTrigger,
  } = treeState;
  const {
    contentAreaDraggedPath,
    bulkMoveCopyInProgress,
  } = transferState;
  const {
    actionContext,
    pickerState,
    modalDialogs,
    fileTargets,
  } = dialogState;
  const {
    actionSheetOpen,
    closeActionSheet,
    actionSheetFile,
    contextMenu,
    setContextMenu,
  } = actionContext;
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
  const {
    dropMessage,
    setDropMessage,
    message,
    clearMessage,
    showError,
    showWarning,
  } = messaging;
  const {
    interaction,
    commands,
    progress,
    refreshIndicator,
  } = explorerHandlers;
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
    handlePathClick,
    handleScrollAreaClick,
    handleFileDownloadOp,
    contentAreaDnD,
    isFileAreaDraggingOver,
    contentAreaDragType,
    handleActionSheetDownload,
    handleActionSheetPreview,
  } = interaction;
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
                internalDraggedPath={contentAreaDraggedPath}
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
        >
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
                  internalDraggedPath={contentAreaDraggedPath}
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
            sortMode={sortMode}
            setSortMode={setSortMode}
            viewMode={viewMode}
            setViewMode={setViewMode}
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
            sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
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
                  {contentAreaDragType === 'internal' ? t('fileManager.moveDropHere') : t('dialogs.uploadDropHere')}
                </Typography>
              </Box>
            )}

            <Box
              ref={scrollContainerRef}
              onClick={handleScrollAreaClick}
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

              {viewMode === VIEW_MODES.LIST ? (
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
                  internalDraggedPath={contentAreaDraggedPath}
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
                  onContextMenu={handleViewContextMenu}
                  onFileDrop={handleFileDrop}
                  onDropPermissionDenied={handleDropPermissionDenied}
                  onDragStart={handleDragStartFromView}
                  onDragEnd={handleDragEndFromView}
                  internalDraggedPath={contentAreaDraggedPath}
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
                  onContextMenu={handleViewContextMenu}
                  onFileDrop={handleFileDrop}
                  onDropPermissionDenied={handleDropPermissionDenied}
                  onDragStart={handleDragStartFromView}
                  onDragEnd={handleDragEndFromView}
                  internalDraggedPath={contentAreaDraggedPath}
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

      {(!isShareLinkMode || (isShareLinkMode && user)) && (
        <FloatingSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isMobile={isMobile}
          fabVisible={!selectionMode}
        />
      )}

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
          onPreview={isShareLinkMode ? undefined : handleActionSheetPreview}
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
              onSave={onShareTargetSave}
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

export default FileManagerView;

