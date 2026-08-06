import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export function deriveShareFolderAccessView({
  nodeId,
  folderPermissions,
  isAdminMode,
  userId,
  username,
  user,
  userInfoMap,
  users = [],
  getUserName,
  hasPermissionChanged = () => false,
  isReviewMode = false,
  permissionRequest = null,
  baseFolderNodeId = null,
} = {}) {
  const currentFolderUserPerms = folderPermissions?.get(nodeId) || new Map();
  const currentFolderUsers = Array.from(currentFolderUserPerms.entries());
  const rawDisplayUsers = isAdminMode
    ? currentFolderUsers.filter(([targetUserId]) => targetUserId === userId)
    : currentFolderUsers.filter(([targetUserId]) => {
        if (user && targetUserId === user.id) return false;
        const info = userInfoMap?.get(targetUserId);
        if (info?.is_admin) return false;
        const fullUser = users.find((candidate) => candidate.id === targetUserId);
        if (fullUser?.is_admin) return false;
        return true;
      });

  const displayUsers = rawDisplayUsers
    .map(([targetUserId, permission]) => ({
      userId: targetUserId,
      permission,
      userName: getUserName(targetUserId),
    }))
    .filter((entry) => entry.userName && entry.userName.trim() !== '');

  const availableUsers = users.filter((candidate) => {
    if (!candidate || currentFolderUserPerms.has(candidate.id)) {
      return false;
    }
    if (user && candidate.id === user.id) {
      return false;
    }
    if (candidate.is_admin) {
      return false;
    }
    return true;
  });

  const requesterId = permissionRequest?.requester_id;
  const reviewRequesterOption = isReviewMode && requesterId
    ? {
        userId: requesterId,
        userName: permissionRequest.requester_username || getUserName(requesterId) || '',
        alreadyAdded: currentFolderUserPerms.has(requesterId),
      }
    : null;

  const currentUserBaseFolder = isAdminMode ? `/${username}` : null;
  const currentIsUserBaseFolder =
    isAdminMode && (nodeId === currentUserBaseFolder || (baseFolderNodeId != null && nodeId === baseFolderNodeId));
  const isFolderWithAdminPermission =
    isAdminMode && currentFolderUserPerms.get(userId) === PERMISSIONS.ADMIN;

  return {
    currentFolderUserPerms,
    displayUsers,
    availableUsers,
    reviewRequesterOption,
    userCount: displayUsers.length,
    currentIsUserBaseFolder,
    isFolderWithAdminPermission,
    isChanged: hasPermissionChanged(nodeId),
  };
}
