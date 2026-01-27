/**
 * 최근 파일 추적 유틸리티
 * 서버의 .wea 디렉토리에 사용자별로 저장
 */

import { get, post, del } from '../services/apiClient';
import { normalizePath } from './pathUtils';

// 이벤트 리스너 배열
let recentFilesListeners = [];

/**
 * 최근 파일 변경 이벤트 리스너 등록
 * @param {Function} callback - 변경 시 호출될 콜백 함수
 * @returns {Function} 리스너 제거 함수 (unsubscribe)
 */
export const onRecentFilesChange = (callback) => {
  recentFilesListeners.push(callback);
  // 언마운트 시 제거를 위한 unsubscribe 함수 반환
  return () => {
    recentFilesListeners = recentFilesListeners.filter(cb => cb !== callback);
  };
};

/**
 * 모든 리스너에 최근 파일 변경 알림
 */
const notifyRecentFilesChange = () => {
  recentFilesListeners.forEach(callback => {
    try {
      callback();
    } catch (error) {
      console.error('Error in recent files change listener:', error);
    }
  });
};

/**
 * 최근 파일 목록 가져오기
 * @returns {Promise<Array>} 최근 파일 목록
 */
export const getRecentFiles = async () => {
  try {
    const response = await get('/recent-files');
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('Failed to load recent files:', error);
    // 네트워크 오류나 인증 오류 시 빈 배열 반환
    return [];
  }
};

/**
 * 최근 파일에 추가
 * @param {Object} file - 파일 정보 { path, name, type, basename }
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const addRecentFile = async (file) => {
  try {
    // 경로 정규화하여 전송
    const normalizedPath = normalizePath(file.path);
    await post('/recent-files', {
      path: normalizedPath,
      name: file.name || file.basename,
      type: file.type || 'file',
      basename: file.basename,
    });
    
    // 작업 완료 후 최신 리스트 조회하여 반환 (자동 새로고침)
    const result = await getRecentFiles();
    // 이벤트 알림
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    console.error('Failed to save recent file:', error);
    // 에러 발생 시에도 최신 리스트 조회 시도
    try {
      const result = await getRecentFiles();
      notifyRecentFilesChange();
      return result;
    } catch (err) {
      return [];
    }
  }
};

/**
 * 최근 파일에서 제거
 * @param {string} filePath - 파일 경로
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const removeRecentFile = async (filePath) => {
  try {
    // 경로 정규화 후 URL 인코딩하여 경로 전달
    const normalizedPath = normalizePath(filePath);
    const encodedPath = encodeURIComponent(normalizedPath);
    const response = await del(`/recent-files/${encodedPath}`);
    const result = Array.isArray(response.data) ? response.data : [];
    // 이벤트 알림
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    console.error('Failed to remove recent file:', error);
    // 에러 발생 시에도 조용히 처리
    return [];
  }
};

/**
 * 최근 파일 목록 초기화
 * @returns {Promise<void>}
 */
export const clearRecentFiles = async () => {
  try {
    await del('/recent-files');
    // 이벤트 알림
    notifyRecentFilesChange();
  } catch (error) {
    console.error('Failed to clear recent files:', error);
    // 에러 발생 시에도 조용히 처리
  }
};

/**
 * 폴더 이동/이름변경 시 하위 경로 업데이트
 * @param {string} oldPath - 기존 폴더 경로
 * @param {string} newPath - 새 폴더 경로
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const updateSubPathsOnPathChange = async (oldPath, newPath) => {
  try {
    const recentFiles = await getRecentFiles();
    const normalizedOldPath = normalizePath(oldPath);
    const normalizedNewPath = normalizePath(newPath);
    
    // 이동된 폴더의 하위 경로인 항목들 찾아서 경로 업데이트
    for (const recentFile of recentFiles) {
      const normalizedRecentPath = normalizePath(recentFile.path);
      
      // 이동된 폴더 경로로 시작하는 모든 경로 업데이트
      // 예: /tst를 /a/tst로 이동하면 /tst/ㅇㅇㅇ.ㅇㅇ -> /a/tst/ㅇㅇㅇ.ㅇㅇ
      if (normalizedRecentPath.startsWith(normalizedOldPath + '/') || 
          normalizedRecentPath === normalizedOldPath) {
        // 기존 경로 제거
        await removeRecentFile(recentFile.path);
        
        // 새 경로로 추가 (파일만, 폴더는 제외)
        if (recentFile.type !== 'directory') {
          const relativePath = normalizedRecentPath === normalizedOldPath 
            ? '' 
            : normalizedRecentPath.substring(normalizedOldPath.length);
          const updatedPath = normalizedNewPath + relativePath;
          await addRecentFile({
            path: updatedPath,
            name: recentFile.name,
            type: recentFile.type || 'file',
            basename: recentFile.basename || recentFile.name,
          });
        }
      }
    }
    
    // 작업 완료 후 최신 리스트 조회하여 반환 (자동 새로고침)
    const result = await getRecentFiles();
    // 이벤트 알림
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    console.error('Failed to update sub-paths in recent files:', error);
    // 에러 발생 시에도 최신 리스트 조회 시도
    try {
      const result = await getRecentFiles();
      notifyRecentFilesChange();
      return result;
    } catch (err) {
      return [];
    }
  }
};

/**
 * 폴더 삭제 시 하위 경로 제거
 * @param {string} folderPath - 삭제된 폴더 경로
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const removeSubPathsOnFolderDelete = async (folderPath) => {
  try {
    const recentFiles = await getRecentFiles();
    const normalizedFolderPath = normalizePath(folderPath);
    
    // 하위 경로인 항목들 찾아서 제거
    for (const recentFile of recentFiles) {
      const normalizedRecentPath = normalizePath(recentFile.path);
      if (normalizedRecentPath.startsWith(normalizedFolderPath + '/') || 
          normalizedRecentPath === normalizedFolderPath) {
        await removeRecentFile(recentFile.path);
      }
    }
    
    // 작업 완료 후 최신 리스트 조회하여 반환 (자동 새로고침)
    const result = await getRecentFiles();
    // 이벤트 알림
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    console.error('Failed to remove sub-paths from recent files:', error);
    // 에러 발생 시에도 최신 리스트 조회 시도
    try {
      const result = await getRecentFiles();
      notifyRecentFilesChange();
      return result;
    } catch (err) {
      return [];
    }
  }
};

/**
 * 여러 파일 경로 제거
 * @param {Array<string>} filePaths - 제거할 파일 경로 배열
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const removeMultiplePaths = async (filePaths) => {
  try {
    const recentFiles = await getRecentFiles();
    const deletedPathsSet = new Set(filePaths.map(p => normalizePath(p)));
    
    // 삭제된 파일 경로와 일치하는 최근항목 제거
    for (const recentFile of recentFiles) {
      const normalizedRecentPath = normalizePath(recentFile.path);
      if (deletedPathsSet.has(normalizedRecentPath)) {
        await removeRecentFile(recentFile.path);
      }
    }
    
    // 작업 완료 후 최신 리스트 조회하여 반환 (자동 새로고침)
    const result = await getRecentFiles();
    // 이벤트 알림
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    console.error('Failed to remove multiple paths from recent files:', error);
    // 에러 발생 시에도 최신 리스트 조회 시도
    try {
      const result = await getRecentFiles();
      notifyRecentFilesChange();
      return result;
    } catch (err) {
      return [];
    }
  }
};

/**
 * 파일 이동 후 최근 파일 갱신
 * @param {string} oldPath - 기존 경로
 * @param {string} newPath - 새 경로
 * @param {Object} file - 파일 정보 { type, name, basename }
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const applyRecentFilesAfterMove = async (oldPath, newPath, file) => {
  try {
    // 기존 경로 제거
    await removeRecentFile(oldPath);
    
    // 새 경로 추가 (파일만, 폴더는 제외)
    if (file?.type !== 'directory') {
      await addRecentFile({
        path: newPath,
        name: file?.name || file?.basename,
        type: file?.type || 'file',
        basename: file?.basename,
      });
    }
    
    // 폴더인 경우 하위 경로들도 업데이트
    if (file?.type === 'directory') {
      await updateSubPathsOnPathChange(oldPath, newPath);
    }
    
    return await getRecentFiles();
  } catch (error) {
    console.error('Failed to update recent files after move:', error);
    return [];
  }
};

/**
 * 파일 이름변경 후 최근 파일 갱신
 * @param {string} oldPath - 기존 경로
 * @param {string} newPath - 새 경로
 * @param {Object} file - 파일 정보 { type, name, basename }
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const applyRecentFilesAfterRename = async (oldPath, newPath, file) => {
  try {
    // 기존 경로 제거
    await removeRecentFile(oldPath);
    
    // 새 경로 추가 (파일만, 폴더는 제외)
    if (file?.type !== 'directory') {
      await addRecentFile({
        path: newPath,
        name: file?.name || file?.basename,
        type: file?.type || 'file',
        basename: file?.basename,
      });
    }
    
    // 폴더인 경우 하위 경로들도 업데이트
    if (file?.type === 'directory') {
      await updateSubPathsOnPathChange(oldPath, newPath);
    }
    
    return await getRecentFiles();
  } catch (error) {
    console.error('Failed to update recent files after rename:', error);
    return [];
  }
};

/**
 * 파일 삭제 후 최근 파일 갱신
 * @param {string} path - 삭제된 경로
 * @param {boolean} isDirectory - 폴더 여부
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const applyRecentFilesAfterDelete = async (path, isDirectory = false) => {
  try {
    await removeRecentFile(path);
    
    // 폴더인 경우 하위 경로들도 제거
    if (isDirectory) {
      await removeSubPathsOnFolderDelete(path);
    }
    
    return await getRecentFiles();
  } catch (error) {
    console.error('Failed to remove from recent files:', error);
    return [];
  }
};

/**
 * 일괄 삭제 후 최근 파일 갱신
 * @param {Array<string>} filePaths - 삭제된 파일 경로 배열
 * @param {Array<string>} folderPaths - 삭제된 폴더 경로 배열
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const applyRecentFilesAfterBulkDelete = async (filePaths = [], folderPaths = []) => {
  try {
    // 여러 파일 경로 제거
    if (filePaths.length > 0) {
      await removeMultiplePaths(filePaths);
    }
    
    // 여러 폴더의 하위 경로 제거
    for (const folderPath of folderPaths) {
      await removeSubPathsOnFolderDelete(folderPath);
    }
    
    return await getRecentFiles();
  } catch (error) {
    console.error('Failed to clean up recent files after bulk delete:', error);
    return [];
  }
};

/**
 * 일괄 이동 후 최근 파일 갱신
 * @param {Array<Object>} moves - 이동 정보 배열 { oldPath, newPath, file }
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
export const applyRecentFilesAfterBulkMove = async (moves = []) => {
  try {
    // 이동된 파일/폴더별로 최근항목 업데이트
    for (const { oldPath, newPath, file } of moves) {
      await applyRecentFilesAfterMove(oldPath, newPath, file);
    }
    
    return await getRecentFiles();
  } catch (error) {
    console.error('Failed to update recent files after bulk move:', error);
    return [];
  }
};
