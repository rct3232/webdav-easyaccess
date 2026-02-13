import { useState, useEffect, useCallback } from 'react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { revokePermission, checkPermission } from '../services/permissionService';
import {
  cancelPermissionRequest,
  createPermissionRequest,
  listOutboxPermissionRequests,
  checkOwnerExists,
} from '../services/permissionRequestService';
import { getParentPath } from '../utils/pathUtils';

export function useSharedManage({
  open,
  targetPath,
  displayName,
  isDirectory,
  user,
  directHasReadPermission,
  onMessage,
  onActionComplete,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [permissionInfo, setPermissionInfo] = useState(
    isDirectory ? { hasRead: false, hasWrite: false } : { hasRead: false, hasWrite: false, source: 'path' }
  );
  const [pathPermission, setPathPermission] = useState('none');
  const [pendingRequest, setPendingRequest] = useState({
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  });
  const [ownerExists, setOwnerExists] = useState(null);

  const normalizeLocalPath = useCallback((p) => {
    if (!p) return '/';
    let n = String(p).trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!n.startsWith('/')) n = '/' + n;
    if (n !== '/' && n.endsWith('/')) n = n.slice(0, -1);
    return n;
  }, []);

  useEffect(() => {
    if (!open || !targetPath || !user) {
      setInitialLoading(false);
      return;
    }
    if (user.is_admin) {
      setPermissionInfo(
        isDirectory ? { hasRead: true, hasWrite: true } : { hasRead: true, hasWrite: true, source: 'path' }
      );
      if (!isDirectory) setPathPermission('write');
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    const loadPermissionInfo = async () => {
      try {
        if (isDirectory) {
          const permission = await checkPermission(targetPath);
          setPermissionInfo({ hasRead: Boolean(permission.hasRead), hasWrite: Boolean(permission.hasWrite) });
        } else {
          const fileResult = await checkPermission(targetPath);
          const hasRead = Boolean(fileResult?.hasRead);
          const hasWrite = Boolean(fileResult?.hasWrite);
          const source = fileResult?.source === 'file' ? 'file' : 'path';
          setPermissionInfo({ hasRead, hasWrite, source });

          const parentPath = getParentPath(targetPath);
          let pathPerm = 'none';
          if (parentPath) {
            try {
              const pathResult = await checkPermission(parentPath);
              const pHasRead = Boolean(pathResult?.hasRead);
              const pHasWrite = Boolean(pathResult?.hasWrite);
              if (pHasWrite) pathPerm = 'write';
              else if (pHasRead) pathPerm = 'read';
            } catch {
              pathPerm = 'none';
            }
          }
          setPathPermission(pathPerm);
        }
      } catch (error) {
        console.error('Failed to check permission:', error);
        setPermissionInfo(
          isDirectory ? { hasRead: false, hasWrite: false } : { hasRead: false, hasWrite: false, source: 'path' }
        );
        if (!isDirectory) setPathPermission('none');
      } finally {
        setInitialLoading(false);
      }
    };
    loadPermissionInfo();
  }, [open, targetPath, user, isDirectory]);

  useEffect(() => {
    if (!open) {
      setOwnerExists(null);
      return;
    }
    if (!targetPath || !user) {
      setOwnerExists(null);
      return;
    }
    if (user.is_admin) {
      setOwnerExists(true);
      return;
    }
    setOwnerExists(null);
    const checkOwner = async () => {
      try {
        const result = await checkOwnerExists(targetPath, { forFile: !isDirectory });
        setOwnerExists(result?.ownerExists === true);
      } catch (error) {
        console.error('Failed to check owner existence:', error);
        setOwnerExists(false);
      }
    };
    checkOwner();
  }, [open, targetPath, user, isDirectory]);

  useEffect(() => {
    if (!open || !targetPath || !user || user.is_admin) {
      setPendingRequest({ read: { pending: false, id: null }, write: { pending: false, id: null } });
      return;
    }
    const loadPendingRequests = async () => {
      try {
        const outbox = await listOutboxPermissionRequests({ status: 'pending' });
        const normalizedTarget = normalizeLocalPath(targetPath);
        const list = Array.isArray(outbox) ? outbox : [];
        const findPending = (perm) =>
          isDirectory
            ? list.find(
                (r) => normalizeLocalPath(r.folder_path) === normalizedTarget && r.requested_permission === perm
              )
            : list.find(
                (r) =>
                  normalizeLocalPath(r.file_path || '') === normalizedTarget && r.requested_permission === perm
              );
        const pendingRead = findPending(PERMISSIONS.READ);
        const pendingWrite = findPending(PERMISSIONS.WRITE);
        setPendingRequest({
          read: { pending: Boolean(pendingRead), id: pendingRead?.id ?? null },
          write: { pending: Boolean(pendingWrite), id: pendingWrite?.id ?? null },
        });
      } catch (error) {
        setPendingRequest({ read: { pending: false, id: null }, write: { pending: false, id: null } });
      }
    };
    loadPendingRequests();
  }, [open, targetPath, user, isDirectory, normalizeLocalPath]);

  const hasReadPermission =
    typeof directHasReadPermission === 'boolean' ? directHasReadPermission : permissionInfo.hasRead;
  const hasWritePermission = permissionInfo.hasWrite;

  const handleCancelPendingRequest = useCallback(
    async (permissionToCancel) => {
      const target = pendingRequest?.[permissionToCancel];
      if (!target?.pending || !target?.id) return;
      setLoading(true);
      try {
        await cancelPermissionRequest(target.id);
        setPendingRequest((prev) => ({
          ...prev,
          [permissionToCancel]: { pending: false, id: null },
        }));
        if (onMessage) {
          onMessage({
            show: true,
            text: `${permissionToCancel === PERMISSIONS.READ ? '읽기' : '쓰기'} 권한 요청을 회수했습니다.`,
            type: 'success',
          });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 3000);
        }
      } catch (error) {
        console.error('Failed to cancel permission request:', error);
        const errorMsg = error.response?.data?.error || '요청 회수에 실패했습니다.';
        if (onMessage) {
          onMessage({ show: true, text: errorMsg, type: 'error' });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 5000);
        }
      } finally {
        setLoading(false);
      }
    },
    [pendingRequest, onMessage]
  );

  const handlePermissionRequest = useCallback(
    async (requestedPermission) => {
      if (!targetPath || !user) return;
      setLoading(true);
      try {
        if (
          requestedPermission === PERMISSIONS.WRITE &&
          !hasReadPermission &&
          pendingRequest.read.pending &&
          pendingRequest.read.id
        ) {
          await cancelPermissionRequest(pendingRequest.read.id);
          setPendingRequest((prev) => ({ ...prev, read: { pending: false, id: null } }));
        }
        const payload = isDirectory
          ? { folderPath: targetPath, permission: requestedPermission }
          : { filePath: targetPath, permission: requestedPermission };
        const created = await createPermissionRequest(payload);
        setPendingRequest((prev) => ({
          ...prev,
          [requestedPermission]: { pending: true, id: created?.id ?? prev[requestedPermission]?.id ?? null },
        }));
        if (onMessage) {
          onMessage({
            show: true,
            text: `${requestedPermission === 'read' ? '읽기' : '쓰기'} 권한 요청을 보냈습니다.`,
            type: 'success',
          });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 3000);
        }
      } catch (error) {
        console.error('Failed to create permission request:', error);
        const errorMsg = error.response?.data?.error || '권한 요청에 실패했습니다.';
        if (onMessage) {
          onMessage({ show: true, text: errorMsg, type: 'error' });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 5000);
        }
      } finally {
        setLoading(false);
      }
    },
    [targetPath, user, isDirectory, hasReadPermission, pendingRequest, onMessage]
  );

  const handleRevokePermission = useCallback(async () => {
    if (!user?.id || !targetPath) return;
    setLoading(true);
    try {
      if (isDirectory) {
        await revokePermission({ userId: user.id, folderPath: targetPath, includeSubfolders: true });
        if (onMessage) {
          onMessage({
            show: true,
            text: `"${displayName}" 폴더와 하위 폴더의 권한이 반납되었습니다.`,
            type: 'success',
          });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 3000);
        }
      } else {
        await revokePermission({ userId: user.id, folderPath: targetPath, scope: 'pathOnly' });
        if (onMessage) {
          onMessage({
            show: true,
            text: `"${displayName || targetPath}" 파일 권한이 반납되었습니다.`,
            type: 'success',
          });
          setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 3000);
        }
      }
      if (onActionComplete) onActionComplete();
      onClose();
    } catch (error) {
      console.error('Failed to revoke permission:', error);
      const errorMsg = error.response?.data?.error || '권한 반납에 실패했습니다.';
      if (onMessage) {
        onMessage({ show: true, text: errorMsg, type: 'error' });
        setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 5000);
      }
    } finally {
      setLoading(false);
      setConfirmDialogOpen(false);
    }
  }, [user, targetPath, displayName, isDirectory, onMessage, onActionComplete, onClose]);

  const hasFileLevelPermission = !isDirectory && permissionInfo.source === 'file';
  const filePermissionLevel = hasFileLevelPermission
    ? (permissionInfo.hasWrite ? 'write' : 'read')
    : null;

  return {
    loading,
    initialLoading,
    confirmDialogOpen,
    setConfirmDialogOpen,
    permissionInfo,
    pathPermission,
    filePermissionLevel,
    hasReadPermission,
    hasWritePermission,
    pendingRequest,
    ownerExists,
    handleCancelPendingRequest,
    handlePermissionRequest,
    handleRevokePermission,
  };
}
