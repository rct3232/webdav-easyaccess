import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import { revokePermission, grantPermission, approvePermissionRequest } from './sharePermissionGateway';

/**
 * Review-mode use-case: apply permission changes and approve a permission request.
 */
export async function shareReviewUseCase({
  permissionRequestId,
  initialFolderPermissions,
  folderPermissions,
} = {}) {
  const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
    initialFolderPermissions,
    folderPermissions,
  });

  // Revokes are best-effort: errors for individual entries should not block later grants/approve.
  for (const { userId, folderPath } of permissionsToRevoke) {
    try {
      await revokePermission({ userId, folderPath, includeSubfolders: true });
    } catch (e) {
      // Non-fatal revocation failure (matches current dialog behavior).
    }
  }

  // Grants are required; any failure should abort the flow and surface to the caller.
  for (const { userId, folderPath, permission } of permissionsToGrant) {
    await grantPermission({ userId, folderPath, permission });
  }

  await approvePermissionRequest(permissionRequestId);
}

