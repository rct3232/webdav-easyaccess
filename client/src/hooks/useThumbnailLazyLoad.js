import { useEffect, useRef, useCallback } from 'react';
import { requestThumbnailsBatch } from '../services/fileService';

const DEBOUNCE_MS = 200;
const ROOT_MARGIN = '100px'; // 뷰포트 밖 100px까지 미리 로드

/**
 * 이미지/비디오 파일인지 확인
 */
const isImageOrVideoFile = (file) => {
  if (file.type === 'directory') return false;
  const basename = file.basename || file.name || '';
  const mime = file.mime || '';
  
  // MIME 타입으로 확인
  if (mime.startsWith('image/') || mime.startsWith('video/')) {
    return true;
  }
  
  // 확장자로 확인
  const ext = basename.toLowerCase().split('.').pop();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
  
  return imageExts.includes(ext) || videoExts.includes(ext);
};

/**
 * Intersection Observer를 사용한 썸네일 레이지 로딩 훅
 * 
 * @param {Array} files - 파일 목록
 * @param {Function} onThumbnailsLoaded - 썸네일 로드 완료 콜백
 * @returns {Object} { containerRef } - 컨테이너 참조 (필요시 사용)
 */
export const useThumbnailLazyLoad = (files, onThumbnailsLoaded) => {
  const observerRef = useRef(null);
  const requestedPathsRef = useRef(new Set());
  const pendingRequestRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const pendingPathsRef = useRef(new Set());
  const containerRef = useRef(null);

  /**
   * 썸네일 배치 요청 (디바운싱)
   */
  const requestThumbnails = useCallback((paths) => {
    if (paths.length === 0) return;

    // 디바운싱: 기존 타이머 취소
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 대기 중인 경로에 추가
    paths.forEach(path => pendingPathsRef.current.add(path));

    // 디바운싱된 요청
    debounceTimerRef.current = setTimeout(async () => {
      const pathsToRequest = Array.from(pendingPathsRef.current);
      pendingPathsRef.current.clear();

      if (pathsToRequest.length === 0 || pendingRequestRef.current) {
        return;
      }

      // 요청 중인 경로들 추가
      pathsToRequest.forEach(path => requestedPathsRef.current.add(path));

      pendingRequestRef.current = (async () => {
        try {
          const response = await requestThumbnailsBatch(pathsToRequest);
          if (response.thumbnails && onThumbnailsLoaded) {
            // 썸네일 URL을 Map으로 변환
            const thumbnailMap = new Map();
            response.thumbnails.forEach(({ path, thumbnailUrl }) => {
              if (thumbnailUrl) {
                thumbnailMap.set(path, thumbnailUrl);
              }
            });
            onThumbnailsLoaded(thumbnailMap);
          }
        } catch (error) {
          console.error('Failed to load thumbnails:', error);
          // 에러 발생 시 요청한 경로들을 다시 제거하여 재시도 가능하도록
          pathsToRequest.forEach(path => requestedPathsRef.current.delete(path));
        } finally {
          pendingRequestRef.current = null;
        }
      })();
    }, DEBOUNCE_MS);
  }, [onThumbnailsLoaded]);

  /**
   * Intersection Observer 콜백
   */
  const handleIntersection = useCallback((entries) => {
    const visiblePaths = [];

    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const filePath = entry.target.getAttribute('data-file-path');
        if (filePath) {
          const file = files.find(f => f.path === filePath);
          // 이미지/비디오 파일이고, 썸네일이 없으며, 아직 요청하지 않은 경우
          if (file && isImageOrVideoFile(file) && !file.thumbnailUrl && !requestedPathsRef.current.has(filePath)) {
            visiblePaths.push(filePath);
          }
        }
      }
    });

    if (visiblePaths.length > 0) {
      requestThumbnails(visiblePaths);
    }
  }, [files, requestThumbnails]);

  /**
   * Intersection Observer 설정
   */
  useEffect(() => {
    // Intersection Observer 지원 확인
    if (!window.IntersectionObserver) {
      console.warn('Intersection Observer not supported');
      return;
    }

    // Observer 생성
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: null, // 뷰포트를 루트로 사용
      rootMargin: ROOT_MARGIN,
      threshold: 0.01, // 1%만 보여도 감지
    });

    // 모든 파일 요소 관찰 시작
    const observeElements = () => {
      const fileElements = document.querySelectorAll('[data-file-path]');
      fileElements.forEach((element) => {
        observerRef.current.observe(element);
      });
    };

    // 초기 관찰 시작 (DOM이 렌더링될 시간을 줌)
    const initialTimeout = setTimeout(observeElements, 100);

    // 파일 목록이 변경되면 다시 관찰
    const refreshInterval = setInterval(observeElements, 500);

    // Cleanup
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(refreshInterval);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [handleIntersection]);

  /**
   * 파일 목록이 변경되면 요청 상태 초기화
   */
  useEffect(() => {
    requestedPathsRef.current.clear();
    pendingPathsRef.current.clear();
    pendingRequestRef.current = null;
  }, [files]);

  return {
    containerRef,
  };
};
