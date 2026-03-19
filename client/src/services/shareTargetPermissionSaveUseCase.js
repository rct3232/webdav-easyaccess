import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import sharePermissionGateway from './sharePermissionGateway';
import { collectSubfolderPaths } from '../utils/folderUtils';

export async function shareTargetPermissionSaveUseCase({
  targetPath,
  isDirectory,
  initialAccessList = [],
  accessList = [],
} = {}) {
  const initialIds = new Set(initialAccessList.map((entry) => entry.id));
  const currentMap = new Map(accessList.map((entry) => [entry.id, entry]));

  if (isDirectory) {
    const pathsToGrant = await collectSubfolderPaths(targetPath);

    for (const userId of initialIds) {
      if (currentMap.has(userId)) continue;
      try {
        await sharePermissionGateway.revokePermission({
          userId,
          folderPath: targetPath,
          includeSubfolders: true,
        });
      } catch (error) {
        // Preserve the existing best-effort revoke behavior.
      }
    }

    for (const entry of accessList) {
      for (const folderPath of pathsToGrant) {
        await sharePermissionGateway.grantPermission({
          userId: entry.id,
          folderPath,
          permission: entry.permission,
        });
      }
    }

    return;
  }

  const currentIds = new Set(accessList.map((entry) => entry.id));
  for (const initialEntry of initialAccessList) {
    if (currentIds.has(initialEntry.id)) continue;
    try {
      await sharePermissionGateway.revokePermission({
        userId: initialEntry.id,
        folderPath: targetPath,
        scope: 'pathOnly',
      });
    } catch (error) {
      // Preserve the existing best-effort revoke behavior.
    }
  }

  for (const entry of accessList) {
    if (entry.permission === 'revoke') {
      try {
        await sharePermissionGateway.revokePermission({
          userId: entry.id,
          folderPath: targetPath,
          scope: 'pathOnly',
        });
      } catch (error) {
        // Preserve the existing best-effort revoke behavior.
      }
      continue;
    }

    const initialEntry = initialAccessList.find((candidate) => candidate.id === entry.id);
    const pathDefault = entry.pathPermission ?? PERMISSIONS.READ;
    const skipCond1 = entry.permission === pathDefault && initialEntry?.filePermission == null;
    const skipCond2 = entry.permission === pathDefault && initialEntry?.filePermission != null;

    if (entry.pathPermission != null && skipCond1) {
      continue;
    }

    if (skipCond2) {
      try {
        await sharePermissionGateway.revokePermission({
          userId: entry.id,
          folderPath: targetPath,
          scope: 'pathOnly',
        });
      } catch (error) {
        // Preserve the existing best-effort revoke behavior.
      }
      continue;
    }

    await sharePermissionGateway.grantPermission({
      userId: entry.id,
      folderPath: targetPath,
      permission: entry.permission,
      target: 'file',
    });
  }
}
