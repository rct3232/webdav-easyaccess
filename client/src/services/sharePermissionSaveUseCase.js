import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import sharePermissionGateway from './sharePermissionGateway';

/**
 * Persist ShareDialog share-mode permissions using diffed revoke/grant operations.
 */
export async function sharePermissionSaveUseCase({
  initialFolderPermissions,
  folderPermissions,
} = {}) {
  const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
    initialFolderPermissions,
    folderPermissions,
  });

  for (const { userId, folderPath } of permissionsToRevoke) {
    try {
      await sharePermissionGateway.revokePermission({
        userId,
        folderPath,
        includeSubfolders: true,
      });
    } catch (error) {
      // Preserve current share-dialog behavior: revokes are best-effort.
    }
  }

  for (const { userId, folderPath, permission } of permissionsToGrant) {
    await sharePermissionGateway.grantPermission({
      userId,
      folderPath,
      permission,
    });
  }
}
