import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export function deriveShareFolderAccessView({
  folderPath,
  folderPermissions,
  isAdminMode,
  userId,
  username,
  user,
  userInfoMap,
  users = [],
  getUserName,
  hasPermissionChanged = () => false,
} = {}) {
  const currentFolderUserPerms = folderPermissions?.get(folderPath) || new Map();
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

  const currentUserBaseFolder = isAdminMode ? `/${username}` : null;
  const currentIsUserBaseFolder = isAdminMode && folderPath === currentUserBaseFolder;
  const isFolderWithAdminPermission =
    isAdminMode && currentFolderUserPerms.get(userId) === PERMISSIONS.ADMIN;

  return {
    currentFolderUserPerms,
    displayUsers,
    userCount: displayUsers.length,
    currentIsUserBaseFolder,
    isFolderWithAdminPermission,
    isChanged: hasPermissionChanged(folderPath),
  };
}
