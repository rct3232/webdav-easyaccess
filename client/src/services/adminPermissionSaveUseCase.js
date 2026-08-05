import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import sharePermissionGateway from './sharePermissionGateway';

/**
 * Persist the target user's edited node permissions from ShareDialog admin mode.
 * Computes a diff between the initial and current nodeId-keyed permission maps and
 * applies grants/revokes per nodeId through the shared permission gateway
 * (the legacy PUT /users/:id/permissions route is Phase 7 scope and is not used).
 */
export async function adminPermissionSaveUseCase({
  userId,
  homeFolderNodeId,
  initialFolderPermissions,
  folderPermissions,
} = {}) {
  const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
    initialNodePermissions: initialFolderPermissions,
    nodePermissions: folderPermissions,
  });

  for (const { userId: revokeUserId, nodeId } of permissionsToRevoke) {
    if (homeFolderNodeId != null && nodeId === homeFolderNodeId) continue;
    try {
      await sharePermissionGateway.revokePermission({ userId: revokeUserId, nodeId });
    } catch (error) {
      // Preserve admin-dialog behavior: revokes are best-effort.
    }
  }

  for (const { userId: grantUserId, nodeId, permission } of permissionsToGrant) {
    await sharePermissionGateway.grantPermission({ userId: grantUserId, nodeId, permission });
  }

  // Guard the target user's own home folder: never leave it without at least write access.
  if (homeFolderNodeId != null && userId != null) {
    const homeAlreadyGranted = permissionsToGrant.some(
      ({ userId: grantUserId, nodeId }) => grantUserId === String(userId) && nodeId === homeFolderNodeId
    );
    if (!homeAlreadyGranted) {
      await sharePermissionGateway.grantPermission({
        userId,
        nodeId: homeFolderNodeId,
        permission: PERMISSIONS.WRITE,
      });
    }
  }
}
