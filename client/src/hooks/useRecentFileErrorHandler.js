import { useCallback } from 'react';
import { normalizePath } from '../utils/pathUtils';
import { getRecentFiles, removeRecentFile } from '../utils/recentFiles';
import { listFiles } from '../services/fileService';
import { determineErrorType, getErrorMessageByType, ERROR_TYPES } from '../utils/errorUtils';

/**
 * 최근 파일 에러 처리 훅
 * 최근 파일 클릭으로 인한 404 에러 처리, 파일 존재 확인, 경로 롤백 로직을 담당
 * 
 * @param {Object} refs - ref 객체들
 * @param {React.MutableRefObject<Map>} refs.recentFilePathsRef - 최근 파일 경로 추적 ref
 * @param {React.MutableRefObject<Map>} refs.pathHistoryRef - 경로 히스토리 ref
 * @param {React.MutableRefObject<Set>} refs.processingErrorRef - 처리 중인 에러 경로 ref
 * @param {Function} setCurrentPath - 현재 경로 설정 함수
 * @param {Function} showError - 에러 메시지 표시 함수
 * @param {Object} user - 사용자 객체
 * @returns {Function} handleRecentFileError - 에러 처리 함수
 */
export const useRecentFileErrorHandler = ({
  recentFilePathsRef,
  pathHistoryRef,
  processingErrorRef,
  setCurrentPath,
  showError,
  user,
  currentPathRef,
}) => {
  const handleRecentFileError = useCallback(async (error, path) => {
    // 경로 정규화
    const normalizedPath = normalizePath(path);
    
    // 중복 처리 방지: 이미 처리 중인 경로는 무시
    if (processingErrorRef.current.has(normalizedPath) || processingErrorRef.current.has(path)) {
      return;
    }
    
    // 처리 중 표시
    processingErrorRef.current.add(normalizedPath);
    processingErrorRef.current.add(path);
    
    const is404Error = error.response?.status === 404;
    
    // 404 에러인 경우, 최근 파일 클릭으로 인한 경로인지 확인
    // recentFilePathsRef에 경로가 있는 경우에만 최근항목에서 제거
    // (부모 경로로 이동할 때도 recentFilePathsRef에 저장되므로 확인)
    const isRecentFilePath = recentFilePathsRef.current.has(normalizedPath) || 
                             recentFilePathsRef.current.has(path);
    
    // recentFilePathsRef의 값(실제 파일 경로)도 확인
    let actualFilePath = null;
    if (isRecentFilePath) {
      // recentFilePathsRef에서 실제 파일 경로 찾기
      actualFilePath = recentFilePathsRef.current.get(normalizedPath) || 
                      recentFilePathsRef.current.get(path);
    }
    
    if (is404Error && isRecentFilePath && actualFilePath) {
      // 최근 파일 클릭으로 인한 404 에러인 경우
      // 하지만 실제로 파일이 존재하는지 서버에 확인해야 함
      // 부모 폴더 접근 실패일 수도 있고, 파일이 실제로 없을 수도 있음
      const normalizedFilePath = normalizePath(actualFilePath);
      const parentPath = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf('/')) || '/';
      const normalizedParentPath = normalizePath(parentPath);
      
      // 부모 폴더로 이동 중 404가 발생한 경우, 파일 자체가 없을 수도 있음
      // 하지만 파일이 실제로 존재하는지 확인하기 위해 부모 폴더의 파일 목록을 확인
      try {
        const parentFiles = await listFiles(normalizedParentPath);
        
        // 서버에서 파일 존재 여부 확인
        const fileExists = parentFiles.some(f => {
          const fPath = normalizePath(f.path);
          return fPath === normalizedFilePath;
        });
        
        if (!fileExists) {
          // 파일이 실제로 존재하지 않는 경우에만 제거
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
              // 최근항목에서 찾지 못한 경우에도 에러 메시지 표시
              showError('파일 또는 경로가 존재하지 않습니다.');
            }
          } catch (err) {
            console.error('Failed to remove from recent files on 404:', err);
            showError('파일 또는 경로가 존재하지 않습니다.');
          }
        } else {
          // 파일이 실제로 존재하는 경우 - 부모 폴더 접근 권한 문제일 수 있음
          // 최근항목에서 제거하지 않고 에러 메시지만 표시
          showError('폴더에 접근할 수 없습니다. 권한을 확인해주세요.');
        }
      } catch (verifyError) {
        // 파일 존재 여부 확인 중 에러 발생
        // listFiles가 404를 반환하는 경우 부모 폴더 자체가 없거나 접근 권한이 없을 수 있음
        // 이 경우 파일이 실제로 없는지 확인할 수 없으므로 제거하지 않음
        console.error('Failed to verify file existence on 404:', verifyError);
        
        // verifyError가 404인 경우 부모 폴더가 없는 것으로 간주
        // 파일도 존재하지 않을 가능성이 높으므로 제거
        if (verifyError.response?.status === 404 || verifyError.response?.status === 403) {
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
          // 네트워크 에러 등으로 확인할 수 없는 경우 제거하지 않음
          showError('파일 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
      }
      
      // 추적에서 제거 (정규화된 경로와 원본 경로 모두)
      recentFilePathsRef.current.delete(normalizedPath);
      recentFilePathsRef.current.delete(path);
      if (actualFilePath !== normalizedPath && actualFilePath !== path) {
        recentFilePathsRef.current.delete(normalizePath(actualFilePath));
        recentFilePathsRef.current.delete(actualFilePath);
      }
    } else if (is404Error && !isRecentFilePath) {
      // 최근 파일 클릭과 무관한 404 에러는 최근항목에서 제거하지 않음
      // 단순히 경로 롤백만 수행
    }
    
    // 경로 롤백: currentPathRef를 기준으로 찾기 (더 정확함)
    const currentPathNow = currentPathRef.current;
    const currentNormalized = normalizePath(currentPathNow);
    
    // pathHistoryRef에서 찾기 (정규화된 경로와 원본 경로 모두 확인)
    let previousPath = pathHistoryRef.current.get(normalizedPath);
    if (!previousPath) {
      previousPath = pathHistoryRef.current.get(path);
    }
    // currentPathRef를 기준으로도 찾기
    if (!previousPath) {
      previousPath = pathHistoryRef.current.get(currentPathNow);
    }
    if (!previousPath) {
      previousPath = pathHistoryRef.current.get(currentNormalized);
    }
    
    // 404 에러인 경우 이전 경로로 롤백 (previousPath가 없으면 기본 경로로)
    if (is404Error) {
      if (previousPath) {
        // 이전 경로로 롤백
        setCurrentPath(previousPath);
        // 히스토리에서 제거 (정규화된 경로와 원본 경로 모두)
        pathHistoryRef.current.delete(normalizedPath);
        pathHistoryRef.current.delete(path);
        pathHistoryRef.current.delete(currentPathNow);
        pathHistoryRef.current.delete(currentNormalized);
      } else {
        // 이전 경로가 없으면 사용자 기본 경로로 이동
        const defaultPath = user?.is_admin ? '/' : `/${user?.username || ''}`;
        setCurrentPath(defaultPath);
      }
    } else if (previousPath) {
      // 404가 아닌 다른 에러도 이전 경로로 롤백
      if (currentNormalized === normalizedPath || currentPathNow === path) {
        setCurrentPath(previousPath);
      }
      // 히스토리에서 제거 (정규화된 경로와 원본 경로 모두)
      pathHistoryRef.current.delete(normalizedPath);
      pathHistoryRef.current.delete(path);
      pathHistoryRef.current.delete(currentPathNow);
      pathHistoryRef.current.delete(currentNormalized);
    }
    
    // 에러 메시지 표시
    // 부모 폴더 로딩 실패는 파일이 없다는 의미가 아니므로, 최근 파일 관련 처리는 하지 않음
    const errorType = determineErrorType(error);
    const errorMessage = getErrorMessageByType(errorType);
    showError(errorMessage);
    
    // 처리 완료 표시 제거
    processingErrorRef.current.delete(path);
    processingErrorRef.current.delete(normalizedPath);
  }, [recentFilePathsRef, pathHistoryRef, processingErrorRef, setCurrentPath, showError, user, currentPathRef]);

  return handleRecentFileError;
};
