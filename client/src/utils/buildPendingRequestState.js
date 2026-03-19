import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from './pathUtils';

export function buildPendingRequestState({
  requests,
  targetPath,
  isDirectory,
} = {}) {
  const emptyState = {
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  };

  if (!targetPath || !Array.isArray(requests)) {
    return emptyState;
  }

  const normalizedTarget = normalizePath(targetPath);
  const findPending = (permission) =>
    isDirectory
      ? requests.find(
          (request) =>
            normalizePath(request.folder_path || '') === normalizedTarget &&
            request.requested_permission === permission
        )
      : requests.find(
          (request) =>
            normalizePath(request.file_path || '') === normalizedTarget &&
            request.requested_permission === permission
        );

  const pendingRead = findPending(PERMISSIONS.READ);
  const pendingWrite = findPending(PERMISSIONS.WRITE);

  return {
    read: { pending: Boolean(pendingRead), id: pendingRead?.id ?? null },
    write: { pending: Boolean(pendingWrite), id: pendingWrite?.id ?? null },
  };
}
