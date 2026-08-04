import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import { revokePermission, grantPermission, approvePermissionRequest } from './sharePermissionGateway';

/**
 * Review-mode use-case: apply permission changes and approve a permission request.
 */
export async function shareReviewUseCase({
  permissionRequestId,
  initialNodePermissions,
  nodePermissions,
} = {}) {
  const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
    initialNodePermissions,
    nodePermissions,
  });

  // Revokes are best-effort: errors for individual entries should not block later grants/approve.
  for (const { userId, nodeId } of permissionsToRevoke) {
    try {
      await revokePermission({ userId, nodeId });
    } catch (e) {
      // Non-fatal revocation failure (matches current dialog behavior).
    }
  }

  // Grants are required; any failure should abort the flow and surface to the caller.
  for (const { userId, nodeId, permission } of permissionsToGrant) {
    await grantPermission({ userId, nodeId, permission });
  }

  await approvePermissionRequest(permissionRequestId);
}

