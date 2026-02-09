import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { useResponsive } from '../../hooks/useResponsive';
import { createShareLink, getShareLinkUrl } from '../../services/shareLinkService';

import { usePermissionManager } from '../../hooks/usePermissionManager';
import { useShareDialog } from '../../hooks/useShareDialog';
import ShareFolderTree from './ShareFolderTree';
import UserSelectionMenu from './UserSelectionMenu';
import ExternalShareSection from './ExternalShareSection';
import FolderShareSection from './FolderShareSection';

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
    isAdminMode,
    isShareMode,
    isReviewMode,
    users,
    folderTree,
    expandedPaths,
    loadingPaths,
    loadingAllFolders,
    folderMenuAnchor,
    setFolderMenuAnchor,
    folderMenuPath,
    setFolderMenuPath,
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

  const renderFolderTreeWrapper = (rootPathArg, level = 0) => (
    <ShareFolderTree
      rootPath={rootPathArg}
      folderTree={folderTree}
      expandedPaths={expandedPaths}
      loadingPaths={loadingPaths}
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
      setFolderMenuPath={setFolderMenuPath}
      loadingPermissions={loadingPermissions}
      isMobile={isMobile}
      level={level}
    />
  );

  const dialogTitle = isAdminMode
    ? `권한 설정 - ${username}`
    : isReviewMode
      ? `권한 검토 - ${folderName}`
      : `폴더 공유 - ${folderName}`;

  return (
    <>
      <style>
        {`
          @keyframes scrollText {
            0% { transform: translateX(0); }
            87.5% { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
            100% { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
          }
        `}
      </style>
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
          {enableExternalShare ? '외부 공유 링크 생성' : dialogTitle}
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
            {enableExternalShare ? '닫기' : '취소'}
          </Button>
          {!enableExternalShare && (
            <Button
              onClick={handleSave}
              variant="contained"
              color="primary"
              disabled={saving || loadingAllFolders}
              sx={{ ml: 1 }}
            >
              {saving ? '저장 중...' : '확인'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <UserSelectionMenu
        folderMenuAnchor={folderMenuAnchor}
        onClose={() => {
          setFolderMenuAnchor(null);
          setFolderMenuPath(null);
          setFolderMenuView('manage');
        }}
        folderMenuPath={folderMenuPath}
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
