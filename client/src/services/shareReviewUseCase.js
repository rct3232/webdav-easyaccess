import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import { revokePermission, approvePermissionRequest } from './sharePermissionGateway';

/**
 * Review-mode use-case: revoke assignments removed in the dialog (best-effort),
 * then approve the permission request. The requested permission is granted
 * atomically by the server on approve, so no client-side grant is issued.
 */
export async function shareReviewUseCase({
  permissionRequestId,
  initialNodePermissions,
  nodePermissions,
} = {}) {
  const { permissionsToRevoke } = buildPermissionDiff({
    initialNodePermissions,
    nodePermissions,
  });

  // Revokes are best-effort: errors for individual entries should not block approve.
  for (const { userId, nodeId } of permissionsToRevoke) {
    try {
      await revokePermission({ userId, nodeId });
    } catch (e) {
      // Non-fatal revocation failure (matches current dialog behavior).
    }
  }

  await approvePermissionRequest(permissionRequestId);
}

