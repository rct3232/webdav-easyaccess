import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/**
 * 무한 스크롤 훅 - IntersectionObserver 기반 점진적 로딩
 * 
 * @param {Array} files - 전체 파일 목록
 * @param {Object} options - 옵션
 * @param {number} options.initialCount - 초기 표시 개수 (기본: 50)
 * @param {number} options.incrementCount - 추가 로드 개수 (기본: 50)
 * @param {number} options.threshold - IntersectionObserver 임계값 (기본: 0.1)
 * @param {string} options.rootMargin - IntersectionObserver 루트 마진 (기본: '200px')
 * @returns {Object} { displayedFiles, loadMoreRef, hasMore, totalCount, displayedCount, reset }
 */
export const useInfiniteScroll = (files, options = {}) => {
  const {
    initialCount = 50,
    incrementCount = 50,
    threshold = 0.1,
    rootMargin = '200px',
  } = options;

  const [displayCount, setDisplayCount] = useState(initialCount);
  const loadMoreRef = useRef(null);
  const observerRef = useRef(null);
  const filesLengthRef = useRef(files.length);

  // 파일 목록이 변경되면 displayCount 리셋
  useEffect(() => {
    // 파일 목록이 완전히 새로 로드된 경우에만 리셋
    // (길이가 0이 되었다가 다시 채워지거나, 경로 변경으로 인한 새 목록)
    if (files.length !== filesLengthRef.current) {
      // 파일 수가 줄어들거나 완전히 새로운 목록인 경우
      if (files.length < filesLengthRef.current || filesLengthRef.current === 0) {
        setDisplayCount(initialCount);
      }
      filesLengthRef.current = files.length;
    }
  }, [files.length, initialCount]);

  // 추가 로드 함수
  const loadMore = useCallback(() => {
    setDisplayCount(prev => {
      const next = prev + incrementCount;
      return Math.min(next, files.length);
    });
  }, [incrementCount, files.length]);

  // 리셋 함수 (외부에서 수동 리셋 필요 시)
  const reset = useCallback(() => {
    setDisplayCount(initialCount);
  }, [initialCount]);

  // IntersectionObserver 설정
  useEffect(() => {
    // 이전 observer 정리
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // 더 로드할 항목이 없으면 observer 설정하지 않음
    if (displayCount >= files.length) {
      return;
    }

    // IntersectionObserver 생성
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null, // viewport 사용
        rootMargin,
        threshold,
      }
    );

    // sentinel 요소 관찰 시작
    const sentinel = loadMoreRef.current;
    if (sentinel) {
      observerRef.current.observe(sentinel);
    }

    // Cleanup
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [displayCount, files.length, loadMore, rootMargin, threshold]);

  // 표시할 파일 목록 계산
  const displayedFiles = useMemo(() => {
    return files.slice(0, displayCount);
  }, [files, displayCount]);

  // 더 로드할 항목이 있는지 여부
  const hasMore = displayCount < files.length;

  return {
    displayedFiles,
    loadMoreRef,
    hasMore,
    totalCount: files.length,
    displayedCount: Math.min(displayCount, files.length),
    reset,
  };
};

export default useInfiniteScroll;
