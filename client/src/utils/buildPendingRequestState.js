import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export function buildPendingRequestState({
  requests,
  targetNodeId,
  isDirectory,
} = {}) {
  const emptyState = {
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  };

  if (!targetNodeId || !Array.isArray(requests)) {
    return emptyState;
  }

  const findPending = (permission) =>
    isDirectory
      ? requests.find(
          (request) =>
            request.file_node_id === targetNodeId &&
            request.requested_permission === permission
        )
      : requests.find(
          (request) =>
            request.file_node_id === targetNodeId &&
            request.requested_permission === permission
        );

  const pendingRead = findPending(PERMISSIONS.READ);
  const pendingWrite = findPending(PERMISSIONS.WRITE);

  return {
    read: { pending: Boolean(pendingRead), id: pendingRead?.id ?? null },
    write: { pending: Boolean(pendingWrite), id: pendingWrite?.id ?? null },
  };
}
