import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { useResponsive } from '../../../hooks/useResponsive';
import { openUrlInNewTab } from '../../../services/browserNavigation';
import { createShareLink, getShareLinkUrl } from '../../../services/shareLinkService';

import { usePermissionManager } from './hooks/usePermissionManager';
import { useShareDialog } from './hooks/useShareDialog';
import ShareFolderTree from '../ShareFolderTree';
import UserSelectionMenu from '../UserSelectionMenu';
import ExternalShareSection from '../ExternalShareSection';
import FolderShareSection from '../FolderShareSection';

const ShareDialog = ({
  open,
  onClose,
  mode = 'share',
  userId = null,
  username = null,
  onSave = null,
  startFromUserHome = false,
  folderPath = null,
  folderName = null,
  folderNodeId = null,
  targetNodeId = null,
  user = null,
  permissionRequest = null,
  onApprove = null,
  onMessage = null,
  enableExternalShare = false,
  filePath = null,
  fileName = null,
}) => {
  const { isMobile } = useResponsive();

  const permissionManager = usePermissionManager({
    mode,
    userId,
    username,
    permissionRequest,
    onMessage,
    onSave,
    onApprove,
    onClose,
  });

  const shareDialog = useShareDialog({
    open,
    mode,
    userId,
    username,
    startFromUserHome,
    folderPath,
    folderName,
    folderNodeId,
    targetNodeId,
    permissionRequest,
    enableExternalShare,
    onMessage,
    onSave,
    onApprove,
    onClose,
    folderPermissions: permissionManager.folderPermissions,
    setFolderPermissions: permissionManager.setFolderPermissions,
    initialFolderPermissions: permissionManager.initialFolderPermissions,
    setInitialFolderPermissions: permissionManager.setInitialFolderPermissions,
    userInfoMap: permissionManager.userInfoMap,
    setUserInfoMap: permissionManager.setUserInfoMap,
    setSaving: permissionManager.setSaving,
    setLoadingPermissions: permissionManager.setLoadingPermissions,
    handleAddUserPermission: permissionManager.handleAddUserPermission,
    handleRemoveUserPermission: permissionManager.handleRemoveUserPermission,
    handleToggleUserPermission: permissionManager.handleToggleUserPermission,
    hasPermissionChanged: permissionManager.hasPermissionChanged,
  });

  const {
    rootPath,
    baseFolderNodeId,
    isAdminMode,
    isShareMode,
    isReviewMode,
    users,
    folderTree,
    expandedNodeIds,
    loadingNodeIds,
    loadingAllFolders,
    folderMenuAnchor,
    setFolderMenuAnchor,
    folderMenuNodeId,
    setFolderMenuNodeId,
    folderMenuView,
    setFolderMenuView,
    externalShareLoading,
    setExternalShareLoading,
    externalShareLink,
    setExternalShareLink,
    externalShareExpiresInDays,
    setExternalShareExpiresInDays,
    externalShareUnlimited,
    setExternalShareUnlimited,
    linkCopied,
    setLinkCopied,
    toggleExpand,
    getUserName,
    handleAddUser,
    handleUserSelect,
    handleTogglePermission,
    handleRemoveUser,
    handleSave,
    handleClose,
  } = shareDialog;

  const {
    folderPermissions,
    saving,
    loadingPermissions,
    hasPermissionChanged,
  } = permissionManager;

  const { t } = useTranslation();
  const dialogTitle = isAdminMode
    ? `${t('dialogs.permissionSettings')} - ${username}`
    : isReviewMode
      ? `${t('dialogs.permissionReview')} - ${folderName}`
      : `${t('dialogs.folderShare')} - ${folderName}`;

  const renderFolderTreeWrapper = (identifier, level = 0) => {
    const node = folderTree.get(identifier);
    const resolvedNodeId = node?.nodeId != null ? node.nodeId : (typeof identifier === 'number' ? identifier : null);
    return (
      <ShareFolderTree
        rootNodeId={resolvedNodeId}
        folderTree={folderTree}
        expandedNodeIds={expandedNodeIds}
        loadingNodeIds={loadingNodeIds}
        toggleExpand={toggleExpand}
        folderPermissions={folderPermissions}
        isAdminMode={isAdminMode}
        userId={userId}
        user={user}
        userInfoMap={permissionManager.userInfoMap}
        users={users}
        getUserName={getUserName}
        hasPermissionChanged={hasPermissionChanged}
        setFolderMenuAnchor={setFolderMenuAnchor}
        setFolderMenuNodeId={setFolderMenuNodeId}
        loadingPermissions={loadingPermissions}
        isMobile={isMobile}
        baseFolderNodeId={baseFolderNodeId}
        level={level}
      />
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullScreen={isMobile}
        PaperProps={{
          sx: isMobile ? {} : {
            width: '49%',
            maxWidth: '49%',
            height: '70vh',
            maxHeight: '70vh',
          },
        }}
      >
        <DialogTitle>
          {enableExternalShare ? t('dialogs.externalShareTitle') : dialogTitle}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'hidden' }}>
          {enableExternalShare && filePath && (
            <ExternalShareSection
              externalShareLink={externalShareLink}
              setExternalShareLink={setExternalShareLink}
              externalShareLoading={externalShareLoading}
              setExternalShareLoading={setExternalShareLoading}
              externalShareExpiresInDays={externalShareExpiresInDays}
              setExternalShareExpiresInDays={setExternalShareExpiresInDays}
              externalShareUnlimited={externalShareUnlimited}
              setExternalShareUnlimited={setExternalShareUnlimited}
              linkCopied={linkCopied}
              setLinkCopied={setLinkCopied}
              createShareLink={createShareLink}
              getShareLinkUrl={getShareLinkUrl}
              onOpenShareLink={openUrlInNewTab}
              filePath={filePath}
              fileName={fileName}
              onMessage={onMessage}
            />
          )}

          {!enableExternalShare && (
            <FolderShareSection
              loadingAllFolders={loadingAllFolders}
              folderTree={folderTree}
              isAdminMode={isAdminMode}
              startFromUserHome={startFromUserHome}
              username={username}
              isShareMode={isShareMode}
              isReviewMode={isReviewMode}
              user={user}
              rootPath={rootPath}
              renderFolderTreeWrapper={renderFolderTreeWrapper}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose} disabled={saving || externalShareLoading}>
            {enableExternalShare ? t('common.close') : t('common.cancel')}
          </Button>
          {!enableExternalShare && (
            <Button
              onClick={handleSave}
              variant="contained"
              color="primary"
              disabled={saving || loadingAllFolders}
              sx={{ ml: 1 }}
            >
              {saving ? t('common.saving') : t('common.confirm')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <UserSelectionMenu
        folderMenuAnchor={folderMenuAnchor}
        onClose={() => {
          setFolderMenuAnchor(null);
          setFolderMenuNodeId(null);
          setFolderMenuView('manage');
        }}
        folderMenuPath={folderMenuNodeId}
        folderPermissions={folderPermissions}
        isAdminMode={isAdminMode}
        userId={userId}
        username={username}
        user={user}
        userInfoMap={permissionManager.userInfoMap}
        users={users}
        getUserName={getUserName}
        handleTogglePermission={handleTogglePermission}
        handleRemoveUser={handleRemoveUser}
        folderMenuView={folderMenuView}
        setFolderMenuView={setFolderMenuView}
        isShareMode={isShareMode}
        isReviewMode={isReviewMode}
        handleAddUser={handleAddUser}
        permissionRequest={permissionRequest}
        handleUserSelect={handleUserSelect}
      />
    </>
  );
};

export default ShareDialog;
