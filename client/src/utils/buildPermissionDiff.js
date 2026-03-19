import { normalizePath } from './pathUtils';

/**
 * Pure permission diff for sharing dialogs.
 * @param {object} params
 * @param {Map<string, Map<string, string>>} params.initialFolderPermissions Path -> (userId -> permission)
 * @param {Map<string, Map<string, string>>} params.folderPermissions Path -> (userId -> permission)
 * @returns {{ permissionsToRevoke: Array<{ userId: string, folderPath: string }>, permissionsToGrant: Array<{ userId: string, folderPath: string, permission: string }> }}
 */
export function buildPermissionDiff({ initialFolderPermissions, folderPermissions } = {}) {
  const initial = normalizeFolderPermissions(initialFolderPermissions);
  const current = normalizeFolderPermissions(folderPermissions);

  const permissionsToRevoke = [];
  const permissionsToGrant = [];

  // Grants: apply *all* current assignments (even unchanged ones) to match
  // the current dialog's effective "make desired state" behavior.
  for (const [folderPath, userPermMap] of current.entries()) {
    for (const [userId, permission] of userPermMap.entries()) {
      permissionsToGrant.push({ userId, folderPath, permission });
    }
  }

  // Revokes: remove only assignments that existed initially but are missing now.
  for (const [folderPath, initialUserPermMap] of initial.entries()) {
    const currentUserPermMap = current.get(folderPath);
    if (!currentUserPermMap) {
      for (const userId of initialUserPermMap.keys()) {
        permissionsToRevoke.push({ userId, folderPath });
      }
      continue;
    }

    for (const userId of initialUserPermMap.keys()) {
      if (!currentUserPermMap.has(userId)) {
        permissionsToRevoke.push({ userId, folderPath });
      }
    }
  }

  return { permissionsToRevoke, permissionsToGrant };
}

function normalizeFolderPermissions(map) {
  if (!map) return new Map();
  const out = new Map();
  for (const [folderPath, userPermMap] of map.entries()) {
    const normalizedFolderPath = normalizePath(folderPath);
    if (!out.has(normalizedFolderPath)) out.set(normalizedFolderPath, new Map());
    const dest = out.get(normalizedFolderPath);
    if (!userPermMap) continue;
    for (const [userId, permission] of userPermMap.entries()) {
      dest.set(String(userId), permission);
    }
  }
  return out;
}

