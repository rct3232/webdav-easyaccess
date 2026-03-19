import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import {
  checkPermission,
  checkOwnerExists,
  listOutboxPermissionRequests,
  createPermissionRequest,
  cancelPermissionRequest,
  revokePermission,
} from '../services/sharePermissionGateway';
import { deriveSharedAccessState } from '../utils/deriveSharedAccessState';
import { buildPendingRequestState } from '../utils/buildPendingRequestState';
import { getParentPath, normalizePath } from '../utils/pathUtils';
import {
  buildShareManageErrorMessage,
  buildShareManageSuccessMessage,
  getShareManageHideDuration,
  HIDDEN_SHARE_MANAGE_MESSAGE,
} from '../utils/shareManageMessageUtils';

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
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [permissionCheck, setPermissionCheck] = useState(null);
  const [parentPermissionCheck, setParentPermissionCheck] = useState(null);
  const [pendingRequest, setPendingRequest] = useState({
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  });
  const [ownerExists, setOwnerExists] = useState(null);
  const hideMessageTimerRef = useRef(null);

  const clearScheduledMessageHide = useCallback(() => {
    if (hideMessageTimerRef.current) {
      clearTimeout(hideMessageTimerRef.current);
      hideMessageTimerRef.current = null;
    }
  }, []);

  const emitTransientMessage = useCallback((message) => {
    if (!onMessage) {
      return;
    }

    clearScheduledMessageHide();
    onMessage(message);

    hideMessageTimerRef.current = setTimeout(() => {
      onMessage(HIDDEN_SHARE_MANAGE_MESSAGE);
      hideMessageTimerRef.current = null;
    }, getShareManageHideDuration(message.type));
  }, [clearScheduledMessageHide, onMessage]);

  useEffect(() => clearScheduledMessageHide, [clearScheduledMessageHide]);

  useEffect(() => {
    if (!open || !targetPath || !user) {
      setInitialLoading(false);
      setPermissionCheck(null);
      setParentPermissionCheck(null);
      return;
    }
    if (user.is_admin) {
      // For admin: skip API, but still synthesize enough data for consistent derivation.
      setPermissionCheck(isDirectory
        ? { hasRead: true, hasWrite: true }
        : { hasRead: true, hasWrite: true, source: 'path' });
      setParentPermissionCheck(isDirectory ? null : { hasRead: true, hasWrite: true });
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    const loadPermissionInfo = async () => {
      try {
        if (isDirectory) {
          const permission = await checkPermission(targetPath);
          setPermissionCheck({ hasRead: Boolean(permission.hasRead), hasWrite: Boolean(permission.hasWrite) });
          setParentPermissionCheck(null);
        } else {
          const fileResult = await checkPermission(targetPath);
          const hasRead = Boolean(fileResult?.hasRead);
          const hasWrite = Boolean(fileResult?.hasWrite);
          const source = fileResult?.source === 'file' ? 'file' : 'path';
          setPermissionCheck({ hasRead, hasWrite, source });

          const parentPath = getParentPath(targetPath);
          if (parentPath) {
            try {
              const pathResult = await checkPermission(parentPath);
              setParentPermissionCheck({
                hasRead: Boolean(pathResult?.hasRead),
                hasWrite: Boolean(pathResult?.hasWrite),
              });
            } catch {
              setParentPermissionCheck(null);
            }
          } else {
            setParentPermissionCheck(null);
          }
        }
      } catch (error) {
        console.error('Failed to check permission:', error);
        setPermissionCheck(
          isDirectory ? { hasRead: false, hasWrite: false } : { hasRead: false, hasWrite: false, source: 'path' }
        );
        setParentPermissionCheck(null);
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
        setPendingRequest(buildPendingRequestState({
          requests: outbox,
          targetPath: normalizePath(targetPath),
          isDirectory,
        }));
      } catch (error) {
        setPendingRequest({ read: { pending: false, id: null }, write: { pending: false, id: null } });
      }
    };
    loadPendingRequests();
  }, [open, targetPath, user, isDirectory]);

  const { hasReadPermission, hasWritePermission, pathPermission, filePermissionLevel } = deriveSharedAccessState({
    isDirectory,
    permissionCheck,
    parentPermissionCheck,
    directHasReadPermission,
    pendingRequest,
    ownerExists,
  });

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
        emitTransientMessage(buildShareManageSuccessMessage({
          kind: 'requestCancelled',
          permission: permissionToCancel,
          t,
        }));
      } catch (error) {
        console.error('Failed to cancel permission request:', error);
        emitTransientMessage(buildShareManageErrorMessage({
          error,
          fallbackKey: 'sharedManage.cancelRequestFail',
          t,
        }));
      } finally {
        setLoading(false);
      }
    },
    [pendingRequest, emitTransientMessage, t]
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
        emitTransientMessage(buildShareManageSuccessMessage({
          kind: 'requestSent',
          permission: requestedPermission,
          t,
        }));
      } catch (error) {
        console.error('Failed to create permission request:', error);
        emitTransientMessage(buildShareManageErrorMessage({
          error,
          fallbackKey: 'sharedManage.requestSentFail',
          t,
        }));
      } finally {
        setLoading(false);
      }
    },
    [targetPath, user, isDirectory, hasReadPermission, pendingRequest, emitTransientMessage, t]
  );

  const handleRevokePermission = useCallback(async () => {
    if (!user?.id || !targetPath) return;
    setLoading(true);
    try {
      if (isDirectory) {
        await revokePermission({ userId: user.id, folderPath: targetPath, includeSubfolders: true });
      } else {
        await revokePermission({ userId: user.id, folderPath: targetPath, scope: 'pathOnly' });
      }
      emitTransientMessage(buildShareManageSuccessMessage({
        kind: 'revoke',
        displayName,
        isDirectory,
        targetPath,
        t,
      }));
      if (onActionComplete) onActionComplete();
      onClose();
    } catch (error) {
      console.error('Failed to revoke permission:', error);
      emitTransientMessage(buildShareManageErrorMessage({
        error,
        fallbackKey: 'sharedManage.revokeFail',
        t,
      }));
    } finally {
      setLoading(false);
      setConfirmDialogOpen(false);
    }
  }, [displayName, emitTransientMessage, isDirectory, onActionComplete, onClose, t, targetPath, user]);

  return {
    loading,
    initialLoading,
    confirmDialogOpen,
    setConfirmDialogOpen,
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
