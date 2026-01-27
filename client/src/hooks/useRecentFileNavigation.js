import { useRef, useCallback } from 'react';
import { normalizePath } from '../utils/pathUtils';

/**
 * 최근 파일 경로 추적 훅
 * 최근 파일 클릭 시 경로 추적, 경로 히스토리 관리, 에러 처리 중인 경로 추적을 담당
 * 
 * @returns {Object} 추적 관련 ref와 메서드
 */
export const useRecentFileNavigation = () => {
  // 최근 파일에서 이동한 경로 추적 (에러 처리용)
  const recentFilePathsRef = useRef(new Map()); // path -> recentFilePath 매핑
  // 경로 변경 전 이전 경로 추적 (롤백용)
  const pathHistoryRef = useRef(new Map()); // path -> previousPath 매핑
  // 에러 처리 중인 경로 추적 (중복 처리 방지)
  const processingErrorRef = useRef(new Set()); // 처리 중인 경로들

  /**
   * 최근 파일 클릭 추적
   * @param {string} filePath - 파일 경로
   * @param {string} parentPath - 부모 경로 (선택사항)
   */
  const trackRecentFileClick = useCallback((filePath, parentPath = null) => {
    const normalizedFilePath = normalizePath(filePath);
    const normalizedParentPath = parentPath ? normalizePath(parentPath) : null;
    
    // 부모 경로가 있으면 부모 경로 -> 파일 경로 매핑
    if (normalizedParentPath) {
      recentFilePathsRef.current.set(normalizedParentPath, normalizedFilePath);
      recentFilePathsRef.current.set(parentPath, filePath); // 원본 경로도 저장
    }
    
    // 파일 경로 자체도 추적
    recentFilePathsRef.current.set(normalizedFilePath, normalizedFilePath);
    recentFilePathsRef.current.set(filePath, filePath); // 원본 경로도 저장
  }, []);

  /**
   * 경로 히스토리에 저장
   * @param {string} path - 현재 경로
   * @param {string} previousPath - 이전 경로
   */
  const trackPathHistory = useCallback((path, previousPath) => {
    const normalizedPath = normalizePath(path);
    pathHistoryRef.current.set(normalizedPath, previousPath);
    pathHistoryRef.current.set(path, previousPath); // 원본 경로도 저장
  }, []);

  /**
   * 추적 정보 제거
   * @param {string} path - 제거할 경로
   */
  const clearTracking = useCallback((path) => {
    const normalizedPath = normalizePath(path);
    recentFilePathsRef.current.delete(normalizedPath);
    recentFilePathsRef.current.delete(path);
    pathHistoryRef.current.delete(normalizedPath);
    pathHistoryRef.current.delete(path);
    processingErrorRef.current.delete(normalizedPath);
    processingErrorRef.current.delete(path);
  }, []);

  /**
   * 모든 추적 정보 초기화
   */
  const clearAllTracking = useCallback(() => {
    recentFilePathsRef.current.clear();
    pathHistoryRef.current.clear();
    processingErrorRef.current.clear();
  }, []);

  /**
   * 경로 히스토리에서 제거 (성공적으로 로드된 경우)
   * @param {string} path - 제거할 경로
   */
  const clearPathHistory = useCallback((path) => {
    const normalizedPath = normalizePath(path);
    pathHistoryRef.current.delete(normalizedPath);
    pathHistoryRef.current.delete(path);
  }, []);

  return {
    recentFilePathsRef,
    pathHistoryRef,
    processingErrorRef,
    trackRecentFileClick,
    trackPathHistory,
    clearTracking,
    clearAllTracking,
    clearPathHistory,
  };
};
