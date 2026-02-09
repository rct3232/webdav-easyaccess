import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { checkPermission } from '../services/fileService';
import {
  cancelPermissionRequest,
  createPermissionRequest,
  listOutboxPermissionRequests,
  checkOwnerExists,
} from '../services/permissionRequestService';

export function useSharedFolderManage({
  open,
  folderPath,
  folderName,
  user,
  directHasReadPermission,
  onMessage,
  onActionComplete,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [permissionInfo, setPermissionInfo] = useState({ hasRead: false, hasWrite: false });
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
    if (!open || !folderPath || !user) return;
    if (user.is_admin) {
      setPermissionInfo({ hasRead: true, hasWrite: true });
      return;
    }
    const loadPermissionInfo = async () => {
      try {
        const permission = await checkPermission(folderPath);
        setPermissionInfo({ hasRead: Boolean(permission.hasRead), hasWrite: Boolean(permission.hasWrite) });
      } catch (error) {
        console.error('Failed to check write permission:', error);
        setPermissionInfo({ hasRead: false, hasWrite: false });
      }
    };
    loadPermissionInfo();
  }, [open, folderPath, user]);

  useEffect(() => {
    if (!open) {
      setOwnerExists(null);
      return;
    }
    if (!folderPath || !user) {
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
        const result = await checkOwnerExists(folderPath);
        setOwnerExists(result?.ownerExists === true);
      } catch (error) {
        console.error('Failed to check owner existence:', error);
        setOwnerExists(false);
      }
    };
    checkOwner();
  }, [open, folderPath, user]);

  useEffect(() => {
    if (!open || !folderPath || !user || user.is_admin) {
      setPendingRequest({ read: { pending: false, id: null }, write: { pending: false, id: null } });
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    const loadPendingRequests = async () => {
      try {
        const outbox = await listOutboxPermissionRequests({ status: 'pending' });
        const normalizedTarget = normalizeLocalPath(folderPath);
        const list = Array.isArray(outbox) ? outbox : [];
        const findPending = (perm) =>
          list.find((r) => normalizeLocalPath(r.folder_path) === normalizedTarget && r.requested_permission === perm);
        const pendingRead = findPending(PERMISSIONS.READ);
        const pendingWrite = findPending(PERMISSIONS.WRITE);
        setPendingRequest({
          read: { pending: Boolean(pendingRead), id: pendingRead?.id ?? null },
          write: { pending: Boolean(pendingWrite), id: pendingWrite?.id ?? null },
        });
      } catch (error) {
        setPendingRequest({ read: { pending: false, id: null }, write: { pending: false, id: null } });
      } finally {
        setInitialLoading(false);
      }
    };
    loadPendingRequests();
  }, [open, folderPath, user, normalizeLocalPath]);

  const hasReadPermission =
    typeof directHasReadPermission === 'boolean' ? directHasReadPermission : permissionInfo.hasRead;
  const hasWritePermission = permissionInfo.hasWrite;

  const handleCancelPendingRequest = useCallback(async (permissionToCancel) => {
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
  }, [pendingRequest, onMessage]);

  const handlePermissionRequest = useCallback(async (requestedPermission) => {
    if (!folderPath || !user) return;
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
      const created = await createPermissionRequest({ folderPath, permission: requestedPermission });
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
  }, [folderPath, user, hasReadPermission, pendingRequest, onMessage]);

  const handleRevokePermission = useCallback(async () => {
    if (!user?.id || !folderPath) return;
    setLoading(true);
    try {
      await axios.delete('/api/permissions/revoke', {
        params: { userId: user.id, folderPath, includeSubfolders: 'true' },
      });
      if (onMessage) {
        onMessage({
          show: true,
          text: `"${folderName}" 폴더와 하위 폴더의 권한이 반납되었습니다.`,
          type: 'success',
        });
        setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 3000);
      }
      if (onActionComplete) onActionComplete();
      onClose();
    } catch (error) {
      console.error('Failed to revoke permissions:', error);
      const errorMsg = error.response?.data?.error || '권한 반납에 실패했습니다.';
      if (onMessage) {
        onMessage({ show: true, text: errorMsg, type: 'error' });
        setTimeout(() => onMessage({ show: false, text: '', type: 'success' }), 5000);
      }
    } finally {
      setLoading(false);
      setConfirmDialogOpen(false);
    }
  }, [user, folderPath, folderName, onMessage, onActionComplete, onClose]);

  return {
    loading,
    initialLoading,
    confirmDialogOpen,
    setConfirmDialogOpen,
    permissionInfo,
    hasReadPermission,
    hasWritePermission,
    pendingRequest,
    ownerExists,
    handleCancelPendingRequest,
    handlePermissionRequest,
    handleRevokePermission,
  };
}
