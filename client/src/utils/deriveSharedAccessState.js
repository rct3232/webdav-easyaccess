/**
 * Pure helper that derives UI-ready sharing permission state for shared-manage dialogs.
 * @see docs/spec/client/utils/deriveSharedAccessState.md
 */
export function deriveSharedAccessState({
  isDirectory,
  permissionCheck,
  parentPermissionCheck = null,
  directHasReadPermission,
  pendingRequest,
  ownerExists = null,
} = {}) {
  const check = permissionCheck ?? {};
  const permissionHasRead = Boolean(check.hasRead);
  const permissionHasWrite = Boolean(check.hasWrite);

  // Effective read can be overridden by optimistic/direct state.
  const hasReadPermission = typeof directHasReadPermission === 'boolean' ? directHasReadPermission : permissionHasRead;
  const hasWritePermission = permissionHasWrite;

  // Directory targets do not have path/file-level permission fields.
  if (isDirectory) {
    return {
      hasReadPermission,
      hasWritePermission,
      pathPermission: null,
      filePermissionLevel: null,
      pendingRequest,
      ownerExists,
    };
  }

  // File targets:
  // - pathPermission derives from parent permission check
  // - filePermissionLevel derives from whether the check came from file-level
  const hasParentWrite = Boolean(parentPermissionCheck?.hasWrite);
  const hasParentRead = Boolean(parentPermissionCheck?.hasRead);

  // Spec: parentPermissionCheck === null => 'none'
  const pathPermission = parentPermissionCheck === null ? 'none' : hasParentWrite ? 'write' : hasParentRead ? 'read' : 'none';

  const source = check.source;
  const filePermissionLevel =
    source === 'file' ? (hasWritePermission ? 'write' : 'read') : null;

  return {
    hasReadPermission,
    hasWritePermission,
    pathPermission,
    filePermissionLevel,
    pendingRequest,
    ownerExists,
  };
}

