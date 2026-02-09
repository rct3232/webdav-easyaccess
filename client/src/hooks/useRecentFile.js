import { useRef, useCallback, useState, useEffect } from 'react';
import { normalizePath } from '../utils/pathUtils';
import { getRecentFiles, removeRecentFile } from '../utils/recentFiles';
import { listFiles } from '../services/fileService';
import { determineErrorType, getErrorMessageByType } from '../utils/errorUtils';
import { canPreview } from '../utils/fileUtils';

/**
 * 최근 파일 관련 통합 훅
 * 경로 추적, 에러 처리, 미리보기 로직을 하나로 통합
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
}) => {
  // --- useRecentFileNavigation 로직 ---
  const recentFilePathsRef = useRef(new Map());
  const pathHistoryRef = useRef(new Map());
  const processingErrorRef = useRef(new Set());

  const trackRecentFileClick = useCallback((filePath, parentPath = null) => {
    const normalizedFilePath = normalizePath(filePath);
    const normalizedParentPath = parentPath ? normalizePath(parentPath) : null;

    if (normalizedParentPath) {
      recentFilePathsRef.current.set(normalizedParentPath, normalizedFilePath);
      recentFilePathsRef.current.set(parentPath, filePath);
    }

    recentFilePathsRef.current.set(normalizedFilePath, normalizedFilePath);
    recentFilePathsRef.current.set(filePath, filePath);
  }, []);

  const trackPathHistory = useCallback((path, previousPath) => {
    const normalizedPath = normalizePath(path);
    pathHistoryRef.current.set(normalizedPath, previousPath);
    pathHistoryRef.current.set(path, previousPath);
  }, []);

  const clearTracking = useCallback((path) => {
    const normalizedPath = normalizePath(path);
    recentFilePathsRef.current.delete(normalizedPath);
    recentFilePathsRef.current.delete(path);
    pathHistoryRef.current.delete(normalizedPath);
    pathHistoryRef.current.delete(path);
    processingErrorRef.current.delete(normalizedPath);
    processingErrorRef.current.delete(path);
  }, []);

  const clearAllTracking = useCallback(() => {
    recentFilePathsRef.current.clear();
    pathHistoryRef.current.clear();
    processingErrorRef.current.clear();
  }, []);

  const clearPathHistory = useCallback((path) => {
    const normalizedPath = normalizePath(path);
    pathHistoryRef.current.delete(normalizedPath);
    pathHistoryRef.current.delete(path);
  }, []);

  // --- useRecentFileErrorHandler 로직 ---
  const handleRecentFileError = useCallback(
    async (error, path) => {
      const normalizedPath = normalizePath(path);

      if (processingErrorRef.current.has(normalizedPath) || processingErrorRef.current.has(path)) {
        return;
      }

      processingErrorRef.current.add(normalizedPath);
      processingErrorRef.current.add(path);

      const is404Error = error.response?.status === 404;
      const isRecentFilePath =
        recentFilePathsRef.current.has(normalizedPath) || recentFilePathsRef.current.has(path);
      let actualFilePath = null;
      if (isRecentFilePath) {
        actualFilePath =
          recentFilePathsRef.current.get(normalizedPath) || recentFilePathsRef.current.get(path);
      }

      if (is404Error && isRecentFilePath && actualFilePath) {
        const normalizedFilePath = normalizePath(actualFilePath);
        const parentPath =
          normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf('/')) || '/';
        const normalizedParentPath = normalizePath(parentPath);

        try {
          const parentFiles = await listFiles(normalizedParentPath);
          const fileExists = parentFiles.some((f) => {
            const fPath = normalizePath(f.path);
            return fPath === normalizedFilePath;
          });

          if (!fileExists) {
            try {
              const recentFiles = await getRecentFiles();
              const foundRecentFile = recentFiles.find((rf) => {
                const rfNormalized = normalizePath(rf.path);
                return rfNormalized === normalizedFilePath;
              });

              if (foundRecentFile) {
                await removeRecentFile(foundRecentFile.path);
                showError('파일 또는 경로가 존재하지 않습니다. 최근항목에서 제거되었습니다.');
              } else {
                showError('파일 또는 경로가 존재하지 않습니다.');
              }
            } catch (err) {
              console.error('Failed to remove from recent files on 404:', err);
              showError('파일 또는 경로가 존재하지 않습니다.');
            }
          } else {
            showError('폴더에 접근할 수 없습니다. 권한을 확인해주세요.');
          }
        } catch (verifyError) {
          console.error('Failed to verify file existence on 404:', verifyError);
          if (
            verifyError.response?.status === 404 ||
            verifyError.response?.status === 403
          ) {
            try {
              const recentFiles = await getRecentFiles();
              const foundRecentFile = recentFiles.find((rf) => {
                const rfNormalized = normalizePath(rf.path);
                return rfNormalized === normalizedFilePath;
              });

              if (foundRecentFile) {
                await removeRecentFile(foundRecentFile.path);
                showError('파일 또는 경로가 존재하지 않습니다. 최근항목에서 제거되었습니다.');
              } else {
                showError('파일 또는 경로가 존재하지 않습니다.');
              }
            } catch (err) {
              console.error('Failed to remove from recent files on verify error:', err);
              showError('파일 또는 경로가 존재하지 않습니다.');
            }
          } else {
            showError('파일 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          }
        }

        recentFilePathsRef.current.delete(normalizedPath);
        recentFilePathsRef.current.delete(path);
        if (actualFilePath !== normalizedPath && actualFilePath !== path) {
          recentFilePathsRef.current.delete(normalizePath(actualFilePath));
          recentFilePathsRef.current.delete(actualFilePath);
        }
      }

      const currentPathNow = currentPathRef.current;
      const currentNormalized = normalizePath(currentPathNow);

      let previousPath = pathHistoryRef.current.get(normalizedPath);
      if (!previousPath) previousPath = pathHistoryRef.current.get(path);
      if (!previousPath) previousPath = pathHistoryRef.current.get(currentPathNow);
      if (!previousPath) previousPath = pathHistoryRef.current.get(currentNormalized);

      if (is404Error) {
        if (previousPath) {
          setCurrentPath(previousPath);
          pathHistoryRef.current.delete(normalizedPath);
          pathHistoryRef.current.delete(path);
          pathHistoryRef.current.delete(currentPathNow);
          pathHistoryRef.current.delete(currentNormalized);
        } else {
          const defaultPath = user?.is_admin ? '/' : `/${user?.username || ''}`;
          setCurrentPath(defaultPath);
        }
      } else if (previousPath) {
        if (currentNormalized === normalizedPath || currentPathNow === path) {
          setCurrentPath(previousPath);
        }
        pathHistoryRef.current.delete(normalizedPath);
        pathHistoryRef.current.delete(path);
        pathHistoryRef.current.delete(currentPathNow);
        pathHistoryRef.current.delete(currentNormalized);
      }

      const errorType = determineErrorType(error);
      const errorMessage = getErrorMessageByType(errorType);
      showError(errorMessage);

      processingErrorRef.current.delete(path);
      processingErrorRef.current.delete(normalizedPath);
    },
    [
      recentFilePathsRef,
      pathHistoryRef,
      processingErrorRef,
      setCurrentPath,
      showError,
      user,
      currentPathRef,
    ]
  );

  // --- useRecentFilePreview 로직 ---
  const [recentFileToPreview, setRecentFileToPreview] = useState(null);

  useEffect(() => {
    if (!recentFileToPreview) return;

    const { filePath, fileName, parentPath } = recentFileToPreview;
    const normalizedCurrentPath = normalizePath(currentPath);
    const normalizedParentPath = normalizePath(parentPath);

    if (normalizedCurrentPath === normalizedParentPath && !loading) {
      const normalizedFilePath = normalizePath(filePath);

      const foundFile = files.find((f) => {
        const fPath = normalizePath(f.path);
        return fPath === normalizedFilePath;
      });

      if (foundFile) {
        const canPreviewFile = canPreview(fileName);
        setSelectedFile({ ...foundFile, name: fileName, canPreview: canPreviewFile });
        setPreviewDialogOpen(true);
        setRecentFileToPreview(null);
        clearTracking(normalizedParentPath);
        clearTracking(parentPath);
      } else {
        (async () => {
          try {
            const parentFiles = await listFiles(normalizedParentPath);
            const serverFoundFile = parentFiles.find((f) => {
              const fPath = normalizePath(f.path);
              return fPath === normalizedFilePath;
            });

            if (
              serverFoundFile &&
              normalizePath(serverFoundFile.path) === normalizedFilePath
            ) {
              const canPreviewFile = canPreview(fileName);
              setSelectedFile({
                ...serverFoundFile,
                name: fileName,
                canPreview: canPreviewFile,
              });
              setPreviewDialogOpen(true);
              setRecentFileToPreview(null);
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            } else {
              handleRecentFileError(
                { response: { status: 404 }, message: 'File not found' },
                filePath
              );
              setRecentFileToPreview(null);
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            }
          } catch (error) {
            console.error('Failed to verify file existence:', error);
            if (error.response?.status === 404 || error.response?.status === 403) {
              handleRecentFileError(
                { response: { status: 404 }, message: 'File not found' },
                filePath
              );
            } else {
              showError('파일 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
            setRecentFileToPreview(null);
            clearTracking(normalizedParentPath);
            clearTracking(parentPath);
          }
        })();
      }
    }
  }, [
    files,
    loading,
    currentPath,
    recentFileToPreview,
    handleRecentFileError,
    showError,
    clearTracking,
    setSelectedFile,
    setPreviewDialogOpen,
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
