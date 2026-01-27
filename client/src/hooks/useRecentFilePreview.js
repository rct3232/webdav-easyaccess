import { useState, useEffect } from 'react';
import { normalizePath } from '../utils/pathUtils';
import { listFiles } from '../services/fileService';
import { canPreview } from '../utils/fileUtils';

/**
 * 최근 파일 미리보기 훅
 * 최근 파일 클릭 시 파일 존재 확인 및 미리보기 열기 로직을 담당
 * 
 * @param {Object} options - 옵션
 * @param {Array} options.files - 현재 파일 목록
 * @param {boolean} options.loading - 로딩 상태
 * @param {string} options.currentPath - 현재 경로
 * @param {Function} options.setSelectedFile - 선택된 파일 설정 함수
 * @param {Function} options.setPreviewDialogOpen - 미리보기 다이얼로그 열기 함수
 * @param {Function} options.handleRecentFileError - 최근 파일 에러 처리 함수
 * @param {Function} options.showError - 에러 메시지 표시 함수
 * @param {Function} options.clearTracking - 추적 정보 제거 함수
 * @returns {Array} [recentFileToPreview, setRecentFileToPreview]
 */
export const useRecentFilePreview = ({
  files,
  loading,
  currentPath,
  setSelectedFile,
  setPreviewDialogOpen,
  handleRecentFileError,
  showError,
  clearTracking,
}) => {
  const [recentFileToPreview, setRecentFileToPreview] = useState(null);

  useEffect(() => {
    if (!recentFileToPreview) return;
    
    const { filePath, fileName, parentPath } = recentFileToPreview;
    
    // 현재 경로가 부모 경로와 일치하고 로딩이 완료되었을 때만 처리
    // 경로가 일치하고 로딩이 완료되었으며, 파일 목록이 있거나 빈 배열인 경우 처리
    const normalizedCurrentPath = normalizePath(currentPath);
    const normalizedParentPath = normalizePath(parentPath);
    
    if (normalizedCurrentPath === normalizedParentPath && !loading) {
      // 경로 정규화
      const normalizedFilePath = normalizePath(filePath);
      
      // 파일 목록에서 해당 파일 찾기 (정규화된 경로로 정확히 비교)
      // basename만으로는 부정확할 수 있으므로 정확한 경로 일치만 확인
      const foundFile = files.find(f => {
        const fPath = normalizePath(f.path);
        // 정확한 경로 일치만 허용
        return fPath === normalizedFilePath;
      });
      
      if (foundFile) {
        // 파일을 찾은 경우
        const canPreviewFile = canPreview(fileName);
        setSelectedFile({ ...foundFile, name: fileName, canPreview: canPreviewFile });
        setPreviewDialogOpen(true);
        setRecentFileToPreview(null);
        // 추적에서 제거 (성공적으로 로드됨)
        clearTracking(normalizedParentPath);
        clearTracking(parentPath);
      } else {
        // 파일 목록에서 찾지 못한 경우, 서버에 직접 확인
        // 파일 목록이 완전히 로드되지 않았거나 경로 정규화 문제일 수 있음
        (async () => {
          try {
            const parentFiles = await listFiles(normalizedParentPath);
            
            // 서버에서 가져온 파일 목록에서 다시 찾기
            // 정확한 경로 일치만 확인 (basename만으로는 부정확할 수 있음)
            const serverFoundFile = parentFiles.find(f => {
              const fPath = normalizePath(f.path);
              // 정확한 경로 일치만 허용
              return fPath === normalizedFilePath;
            });
            
            // 파일이 실제로 존재하는지 엄격하게 확인
            if (serverFoundFile && normalizePath(serverFoundFile.path) === normalizedFilePath) {
              // 서버에서 파일을 찾은 경우에만 미리보기 열기
              const canPreviewFile = canPreview(fileName);
              setSelectedFile({ ...serverFoundFile, name: fileName, canPreview: canPreviewFile });
              setPreviewDialogOpen(true);
              setRecentFileToPreview(null);
              // 추적에서 제거 (성공적으로 로드됨)
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            } else {
              // 서버에서도 파일을 찾지 못한 경우 - 파일이 실제로 없음
              handleRecentFileError(
                { response: { status: 404 }, message: 'File not found' },
                filePath
              );
              setRecentFileToPreview(null);
              // 추적에서 제거
              clearTracking(normalizedParentPath);
              clearTracking(parentPath);
            }
          } catch (error) {
            // 서버 확인 중 에러 발생
            // listFiles가 404/403을 반환하는 경우 부모 폴더가 없거나 접근 권한이 없음
            // 이 경우 파일도 존재하지 않을 가능성이 높음
            console.error('Failed to verify file existence:', error);
            
            if (error.response?.status === 404 || error.response?.status === 403) {
              // 부모 폴더가 없거나 접근 권한이 없는 경우 - 파일도 없을 가능성이 높음
              handleRecentFileError(
                { response: { status: 404 }, message: 'File not found' },
                filePath
              );
            } else {
              // 네트워크 에러 등으로 확인할 수 없는 경우
              // 파일이 실제로 없는지 확인할 수 없으므로 제거하지 않음
              showError('파일 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
            
            setRecentFileToPreview(null);
            // 추적에서 제거
            clearTracking(normalizedParentPath);
            clearTracking(parentPath);
          }
        })();
      }
    }
  }, [files, loading, currentPath, recentFileToPreview, handleRecentFileError, showError, clearTracking, setSelectedFile, setPreviewDialogOpen]);

  return [recentFileToPreview, setRecentFileToPreview];
};
