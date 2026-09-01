import { buildPermissionDiff } from '../utils/buildPermissionDiff';
import sharePermissionGateway from './sharePermissionGateway';

/**
 * Persist ShareDialog share-mode permissions using diffed revoke/grant operations.
 */
export async function sharePermissionSaveUseCase({ initialNodePermissions, nodePermissions } = {}) {
  const { permissionsToRevoke, permissionsToGrant } = buildPermissionDiff({
    initialNodePermissions,
    nodePermissions,
  });

  for (const { userId, nodeId } of permissionsToRevoke) {
    try {
      await sharePermissionGateway.revokePermission({
        userId,
        nodeId,
      });
    } catch (error) {
      // Preserve current share-dialog behavior: revokes are best-effort.
    }
  }

  for (const { userId, nodeId, permission } of permissionsToGrant) {
    await sharePermissionGateway.grantPermission({
      userId,
      nodeId,
      permission,
    });
  }
}
