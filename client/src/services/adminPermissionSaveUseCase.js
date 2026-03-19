import { getUserBaseFolder } from '../utils/userUtils';
import sharePermissionGateway from './sharePermissionGateway';

/**
 * Persist the target user's edited folder permissions from ShareDialog admin mode.
 */
export async function adminPermissionSaveUseCase({
  userId,
  username,
  folderPermissions,
} = {}) {
  const userBaseFolder = getUserBaseFolder({ username });
  const permissions = [];

  folderPermissions?.forEach((userPermMap, folderPath) => {
    userPermMap?.forEach((permission, targetUserId) => {
      if (targetUserId !== userId) return;
      permissions.push({
        folderPath,
        permission: folderPath === userBaseFolder ? 'write' : permission,
      });
    });
  });

  await sharePermissionGateway.updateUserPermissions(userId, permissions);
}
