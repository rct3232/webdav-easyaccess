import { useRef, useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from '../../../utils/pathUtils';
import explorerGateway from '../../../services/explorerGateway';
import { determineErrorType, getErrorMessageByType } from '../../../utils/errorUtils';
import { canPreview } from '../../../utils/fileUtils';

const isMissingRecentVerificationError = (error) => {
  const status = error?.response?.status;
  return status === HTTP_STATUS.NOT_FOUND || status === HTTP_STATUS.FORBIDDEN;
};

const findEntryByNodeId = (entries, nodeId) => {
  if (!Array.isArray(entries)) {
    return null;
  }
  return entries.find((entry) => entry?.nodeId === nodeId) || null;
};

// Tolerant key extraction: recent tracking is keyed by nodeId, but legacy
// callers may pass path strings (or full entry objects). Always produce the
// stable nodeId when available, otherwise fall back to the raw path string.
const toNodeKey = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value?.nodeId != null) return value.nodeId;
  return value;
};

const recentKeysFor = (value) => {
  if (value == null) return [];
  if (typeof value === 'string') {
    const normalized = normalizePath(value);
    return normalized === value ? [value] : [value, normalized];
  }
  return [value];
};

/**
 * 최근 파일 관련 통합 훅
 * nodeId 추적, 에러 처리, 미리보기 로직을 하나로 통합
 *
 * @param {Object} options - 옵션
 * @param {Function} options.setCurrentPath - 현재 경로 설정 함수
 * @param {Function} options.showError - 에러 메시지 표시 함수
 * @param {Object} options.user - 사용자 객체
 * @param {React.RefObject} options.currentPathRef - 현재 경로 ref
 * @param {Function} options.setSelectedFile - 선택된 파일 설정 함수
 * @param {Function} options.setPreviewDialogOpen - 미리보기 다이얼로그 열기 함수
 * @param {Array} options.files - 현재 파일 목록
 * @param {boolean} options.loading - 로딩 상태
 * @param {string} options.currentPath - 현재 경로
 */
export const useRecentFile = ({
  setCurrentPath,
  showError,
  user,
  currentPathRef,
  setSelectedFile,
  setPreviewDialogOpen,
  files,
  loading,
  currentPath,
  recentGateway = explorerGateway,
}) => {
  const { t } = useTranslation();
  // --- useRecentFileNavigation 로직 ---
  const recentFilePathsRef = useRef(new Map());
  const pathHistoryRef = useRef(new Map());
  const processingErrorRef = useRef(new Set());

  const removeRecentEntry = useCallback(
    async (fileNodeId) => {
      const recentFiles = await recentGateway.loadRecentFiles();
      const recentFile = findEntryByNodeId(recentFiles, fileNodeId);

      if (!recentFile?.nodeId) {
        return false;
      }

      await recentGateway.removeRecentFile(recentFile.nodeId);
      return true;
    },
    [recentGateway]
  );

  const verifyRecentEntry = useCallback(
    async (nodeIdOrPath) => {
      const parentFiles = await recentGateway.listDirectory({});
      if (typeof nodeIdOrPath === 'number') {
        return findEntryByNodeId(parentFiles, nodeIdOrPath) || { nodeId: nodeIdOrPath };
      }
      const normalizedTarget = normalizePath(nodeIdOrPath);
      const matched =
        parentFiles.find((entry) => normalizePath(entry?.path) === normalizedTarget) || null;
      return matched || { path: nodeIdOrPath };
    },
    [recentGateway]
  );

  const showMissingRecentFileOutcome = useCallback(
    async (fileNodeId, logContext) => {
      try {
        const removed = await removeRecentEntry(fileNodeId);
        showError(t(removed ? 'errors.recentRemovedFromList' : 'errors.fileNotFound'));
      } catch (error) {
        console.error(logContext, error);
        showError(t('errors.fileNotFound'));
      }
    },
    [removeRecentEntry, showError, t]
  );

  const trackRecentFileClick = useCallback((nodeIdOrEntry, parentNodeIdOrPath = null) => {
    const nodeId = toNodeKey(nodeIdOrEntry);
    const parentNodeId = toNodeKey(parentNodeIdOrPath);

    if (parentNodeId != null) {
      recentFilePathsRef.current.set(parentNodeId, nodeId);
    }

    if (nodeId != null) {
      recentFilePathsRef.current.set(nodeId, nodeId);
    }

    // Tolerant: legacy callers may pass path strings; keep raw + normalized aliases.
    if (typeof nodeIdOrEntry === 'string') {
      const normalized = normalizePath(nodeIdOrEntry);
      recentFilePathsRef.current.set(normalized, nodeIdOrEntry);
      recentFilePathsRef.current.set(nodeIdOrEntry, nodeIdOrEntry);
    }
    if (typeof parentNodeIdOrPath === 'string') {
      const normalized = normalizePath(parentNodeIdOrPath);
      recentFilePathsRef.current.set(normalized, parentNodeIdOrPath);
      recentFilePathsRef.current.set(parentNodeIdOrPath, parentNodeIdOrPath);
    }
  }, []);

  const trackPathHistory = useCallback((path, previousPath) => {
    const normalizedPath = normalizePath(path);
    pathHistoryRef.current.set(normalizedPath, previousPath);
    pathHistoryRef.current.set(path, previousPath);
  }, []);

  const clearTracking = useCallback((nodeIdOrPath) => {
    recentKeysFor(nodeIdOrPath).forEach((key) => {
      recentFilePathsRef.current.delete(key);
      pathHistoryRef.current.delete(key);
      processingErrorRef.current.delete(key);
    });
  }, []);

  const clearAllTracking = useCallback(() => {
    recentFilePathsRef.current.clear();
    pathHistoryRef.current.clear();
    processingErrorRef.current.clear();
  }, []);

  const clearPathHistory = useCallback((path) => {
    recentKeysFor(path).forEach((key) => {
      pathHistoryRef.current.delete(key);
    });
  }, []);

  // --- useRecentFileErrorHandler 로직 ---
  const handleRecentFileError = useCallback(
    async (error, nodeIdOrPath) => {
      const keys = recentKeysFor(nodeIdOrPath);
      if (keys.length === 0) return;

      if (keys.some((key) => processingErrorRef.current.has(key))) {
        return;
      }
      keys.forEach((key) => processingErrorRef.current.add(key));

      const is404Error = error.response?.status === 404;
      const isRecentFilePath = keys.some((key) => recentFilePathsRef.current.has(key));
      let actualNodeId = null;
      if (isRecentFilePath) {
        for (const key of keys) {
          const value = recentFilePathsRef.current.get(key);
          if (value != null) {
            actualNodeId = value;
            break;
          }
        }
      }

      if (is404Error && isRecentFilePath && actualNodeId != null) {
        let handledRecentOutcome = false;

        try {
          const existingFile = await verifyRecentEntry(actualNodeId);

          if (!existingFile) {
            await showMissingRecentFileOutcome(
              actualNodeId,
              'Failed to remove from recent files on 404:'
            );
          } else {
            showError(t('errors.folderAccessDenied'));
          }
          handledRecentOutcome = true;
        } catch (verifyError) {
          console.error('Failed to verify file existence on 404:', verifyError);
          if (isMissingRecentVerificationError(verifyError)) {
            await showMissingRecentFileOutcome(
              actualNodeId,
              'Failed to remove from recent files on verify error:'
            );
          } else {
            showError(t('errors.fileCheckError'));
          }
          handledRecentOutcome = true;
        }

        keys.forEach((key) => recentFilePathsRef.current.delete(key));
        if (actualNodeId !== nodeIdOrPath && !keys.includes(actualNodeId)) {
          recentFilePathsRef.current.delete(actualNodeId);
        }

        if (handledRecentOutcome) {
          const currentPathNow = currentPathRef.current;
          const currentNormalized = normalizePath(currentPathNow);

          let previousPath = keys.reduce(
            (acc, key) => acc || pathHistoryRef.current.get(key),
            null
          );
          if (!previousPath) previousPath = pathHistoryRef.current.get(currentPathNow);
          if (!previousPath) previousPath = pathHistoryRef.current.get(currentNormalized);

          if (previousPath) {
            setCurrentPath(previousPath);
            keys.forEach((key) => pathHistoryRef.current.delete(key));
            pathHistoryRef.current.delete(currentPathNow);
            pathHistoryRef.current.delete(currentNormalized);
          } else {
            const defaultPath = user?.is_admin ? '/' : `/${user?.username || ''}`;
            setCurrentPath(defaultPath);
          }

          keys.forEach((key) => processingErrorRef.current.delete(key));
          return;
        }
      }

      const currentPathNow = currentPathRef.current;
      const currentNormalized = normalizePath(currentPathNow);

      let previousPath = keys.reduce((acc, key) => acc || pathHistoryRef.current.get(key), null);
      if (!previousPath) previousPath = pathHistoryRef.current.get(currentPathNow);
      if (!previousPath) previousPath = pathHistoryRef.current.get(currentNormalized);

      if (is404Error) {
        if (previousPath) {
          setCurrentPath(previousPath);
          keys.forEach((key) => pathHistoryRef.current.delete(key));
          pathHistoryRef.current.delete(currentPathNow);
          pathHistoryRef.current.delete(currentNormalized);
        } else {
          const defaultPath = user?.is_admin ? '/' : `/${user?.username || ''}`;
          setCurrentPath(defaultPath);
        }
      } else if (previousPath) {
        const currentMatchesTarget =
          keys.includes(currentPathNow) || keys.includes(currentNormalized);
        if (currentMatchesTarget) {
          setCurrentPath(previousPath);
        }
        keys.forEach((key) => pathHistoryRef.current.delete(key));
        pathHistoryRef.current.delete(currentPathNow);
        pathHistoryRef.current.delete(currentNormalized);
      }

      const errorType = determineErrorType(error);
      showError(t(getErrorMessageByType(errorType)));

      keys.forEach((key) => processingErrorRef.current.delete(key));
    },
    [
      recentFilePathsRef,
      pathHistoryRef,
      processingErrorRef,
      setCurrentPath,
      showError,
      user,
      currentPathRef,
      showMissingRecentFileOutcome,
      t,
      verifyRecentEntry,
    ]
  );

  // --- useRecentFilePreview 로직 ---
  const [recentFileToPreview, setRecentFileToPreview] = useState(null);

  useEffect(() => {
    if (!recentFileToPreview) return;

    const {
      filePath,
      fileName,
      parentPath,
      nodeId: previewNodeId,
      originalFile,
    } = recentFileToPreview;
    const targetNodeId = previewNodeId ?? originalFile?.nodeId ?? null;
    const normalizedCurrentPath = normalizePath(currentPath);
    const normalizedParentPath = normalizePath(parentPath);

    if (normalizedCurrentPath === normalizedParentPath && !loading) {
      const normalizedFilePath = normalizePath(filePath);

      const foundFile =
        targetNodeId != null
          ? files.find((f) => f.nodeId === targetNodeId) || null
          : files.find((f) => normalizePath(f.path) === normalizedFilePath) || null;

      if (foundFile) {
        const canPreviewFile = canPreview(fileName);
        setSelectedFile({ ...foundFile, name: fileName, canPreview: canPreviewFile });
        setPreviewDialogOpen(true);
        setRecentFileToPreview(null);
        if (targetNodeId != null) clearTracking(targetNodeId);
        clearTracking(normalizedParentPath);
        clearTracking(parentPath);
      } else {
        (async () => {
          try {
            const serverFoundFile = await verifyRecentEntry(targetNodeId ?? normalizedFilePath);

            const serverMatched =
              targetNodeId != null
                ? serverFoundFile?.nodeId === targetNodeId
                : serverFoundFile && normalizePath(serverFoundFile.path) === normalizedFilePath;

            if (serverMatched) {
              const canPreviewFile = canPreview(fileName);
              setSelectedFile({
                ...serverFoundFile,
                name: fileName,
                canPreview: canPreviewFile,
              });
              setPreviewDialogOpen(true);
              setRecentFileToPreview(null);
              if (targetNodeId != null) clearTracking(targetNodeId);
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            } else {
              await handleRecentFileError(
                { response: { status: HTTP_STATUS.NOT_FOUND }, message: t('errors.fileNotFound') },
                targetNodeId ?? filePath
              );
              setRecentFileToPreview(null);
              if (targetNodeId != null) clearTracking(targetNodeId);
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            }
          } catch (error) {
            console.error('Failed to verify file existence:', error);
            if (isMissingRecentVerificationError(error)) {
              await handleRecentFileError(
                { response: { status: HTTP_STATUS.NOT_FOUND }, message: t('errors.fileNotFound') },
                targetNodeId ?? filePath
              );
            } else {
              showError(t('errors.fileCheckError'));
            }
            setRecentFileToPreview(null);
            if (targetNodeId != null) clearTracking(targetNodeId);
            clearTracking(normalizedParentPath);
            clearTracking(parentPath);
          }
        })();
      }
    }
  }, [
    files,
    loading,
    t,
    currentPath,
    recentFileToPreview,
    handleRecentFileError,
    showError,
    clearTracking,
    setSelectedFile,
    setPreviewDialogOpen,
    verifyRecentEntry,
  ]);

  return {
    recentFilePathsRef,
    pathHistoryRef,
    processingErrorRef,
    trackRecentFileClick,
    trackPathHistory,
    clearTracking,
    clearAllTracking,
    clearPathHistory,
    handleRecentFileError,
    recentFileToPreview,
    setRecentFileToPreview,
  };
};
