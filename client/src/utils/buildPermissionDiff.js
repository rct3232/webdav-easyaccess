/**
 * Pure permission diff for sharing dialogs.
 * @param {object} params
 * @param {Map<number, Map<string, string>>} params.initialNodePermissions nodeId -> (userId -> permission)
 * @param {Map<number, Map<string, string>>} params.nodePermissions nodeId -> (userId -> permission)
 * @returns {{ permissionsToRevoke: Array<{ userId: string, nodeId: number }>, permissionsToGrant: Array<{ userId: string, nodeId: number, permission: string }> }}
 */
export function buildPermissionDiff({ initialNodePermissions, nodePermissions } = {}) {
  const initial = normalizeNodePermissions(initialNodePermissions);
  const current = normalizeNodePermissions(nodePermissions);

  const permissionsToRevoke = [];
  const permissionsToGrant = [];

  // Grants: apply *all* current assignments (even unchanged ones) to match
  // the current dialog's effective "make desired state" behavior.
  for (const [nodeId, userPermMap] of current.entries()) {
    for (const [userId, permission] of userPermMap.entries()) {
      permissionsToGrant.push({ userId, nodeId, permission });
    }
  }

  // Revokes: remove only assignments that existed initially but are missing now.
  for (const [nodeId, initialUserPermMap] of initial.entries()) {
    const currentUserPermMap = current.get(nodeId);
    if (!currentUserPermMap) {
      for (const userId of initialUserPermMap.keys()) {
        permissionsToRevoke.push({ userId, nodeId });
      }
      continue;
    }

    for (const userId of initialUserPermMap.keys()) {
      if (!currentUserPermMap.has(userId)) {
        permissionsToRevoke.push({ userId, nodeId });
      }
    }
  }

  return { permissionsToRevoke, permissionsToGrant };
}

function normalizeNodePermissions(map) {
  if (!map) return new Map();
  const out = new Map();
  for (const [nodeId, userPermMap] of map.entries()) {
    if (!out.has(nodeId)) out.set(nodeId, new Map());
    const dest = out.get(nodeId);
    if (!userPermMap) continue;
    for (const [userId, permission] of userPermMap.entries()) {
      dest.set(String(userId), permission);
    }
  }
  return out;
}
