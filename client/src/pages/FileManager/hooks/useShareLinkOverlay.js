import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { addShareLinkToMyPermissions, checkMyPermissionForShare } from '../../../services/shareLinkService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { toFilesPath } from '../../../utils/pathUtils';

export function useShareLinkOverlay({
  isShareLinkMode,
  shareToken,
  linkInfo,
  user,
  navigate,
  showError,
  setDrawerOpen,
  t,
}) {
  const [addToSharedModalOpen, setAddToSharedModalOpen] = useState(false);
  const [addToSharedStatus, setAddToSharedStatus] = useState('loading');
  const [addToSharedConfirmLoading, setAddToSharedConfirmLoading] = useState(false);
  const [leaveShareConfirmOpen, setLeaveShareConfirmOpen] = useState(false);
  const [leaveShareConfirmTargetPath, setLeaveShareConfirmTargetPath] = useState(null);

  const addToSharedCheckDoneRef = useRef(null);
  const addToSharedRequestIdRef = useRef(0);

  // C2.5: share-directory routing is nodeId-first. linkInfo.nodeId is populated at
  // share-view entry (resolve-path fallback; removed in Phase 5). The legacy path
  // route is kept as a fallback when no nodeId is available.
  const shareDirectoryRoute = useMemo(
    () => (linkInfo?.nodeId != null ? `/files/node/${linkInfo.nodeId}` : toFilesPath(linkInfo?.filePath)),
    [linkInfo]
  );

  const runSharePermissionBootstrap = useCallback(() => {
    if (!shareToken) return;

    setAddToSharedModalOpen(true);
    setAddToSharedStatus('loading');
    addToSharedRequestIdRef.current += 1;
    const myRequestId = addToSharedRequestIdRef.current;
    const timeoutMs = 10000;
    const permissionPromise = checkMyPermissionForShare(shareToken);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    Promise.race([permissionPromise, timeoutPromise])
      .then((data) => {
        if (myRequestId !== addToSharedRequestIdRef.current) return;

        if (data.hasSufficientPermission && linkInfo?.isDirectory) {
          setAddToSharedModalOpen(false);
          navigate(shareDirectoryRoute);
        } else if (data.hasSufficientPermission) {
          setAddToSharedModalOpen(false);
        } else {
          setAddToSharedStatus('confirm');
        }
      })
      .catch(() => {
        if (myRequestId !== addToSharedRequestIdRef.current) return;
        setAddToSharedModalOpen(false);
      });
  }, [shareToken, linkInfo, navigate, shareDirectoryRoute]);

  useEffect(() => {
    if (!isShareLinkMode || !user || !shareToken) return;
    if (addToSharedCheckDoneRef.current === shareToken) return;

    addToSharedCheckDoneRef.current = shareToken;
    runSharePermissionBootstrap();
  }, [isShareLinkMode, user, shareToken, runSharePermissionBootstrap]);

  const handleAddToSharedConfirm = useCallback(async () => {
    if (!shareToken) return;

    setAddToSharedConfirmLoading(true);
    try {
      await addShareLinkToMyPermissions(shareToken);
      setAddToSharedModalOpen(false);
      if (linkInfo?.isDirectory) {
        navigate(shareDirectoryRoute);
      }
    } catch (err) {
      showError(getServerErrorDisplay(err?.response?.data, t) || err?.message || t('dialogs.addToSharedError'));
    } finally {
      setAddToSharedConfirmLoading(false);
    }
  }, [shareToken, linkInfo, navigate, showError, t, shareDirectoryRoute]);

  const openAddToSharedModal = useCallback(() => {
    runSharePermissionBootstrap();
  }, [runSharePermissionBootstrap]);

  const handleLeaveSharePathClick = useCallback((path) => {
    setLeaveShareConfirmTargetPath(path);
    setLeaveShareConfirmOpen(true);
  }, []);

  const handleLeaveShareConfirm = useCallback(() => {
    if (!leaveShareConfirmTargetPath) return;

    navigate(toFilesPath(leaveShareConfirmTargetPath));
    setLeaveShareConfirmOpen(false);
    setLeaveShareConfirmTargetPath(null);
    if (typeof setDrawerOpen === 'function') {
      setDrawerOpen(false);
    }
  }, [leaveShareConfirmTargetPath, navigate, setDrawerOpen]);

  return {
    addToSharedModalOpen,
    setAddToSharedModalOpen,
    addToSharedStatus,
    addToSharedConfirmLoading,
    openAddToSharedModal,
    handleAddToSharedConfirm,
    leaveShareConfirmOpen,
    setLeaveShareConfirmOpen,
    leaveShareConfirmTargetPath,
    setLeaveShareConfirmTargetPath,
    handleLeaveSharePathClick,
    handleLeaveShareConfirm,
  };
}
