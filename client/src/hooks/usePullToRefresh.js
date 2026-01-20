import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Pull-to-refresh 훅
 * @param {Function} onRefresh - 새로고침 시 실행할 콜백
 * @param {Object} options - 옵션
 * @param {number} options.threshold - 새로고침을 트리거할 최소 당김 거리 (px, 기본 80px)
 * @param {number} options.maxPullDistance - 최대 당김 거리 (px, 기본 120px)
 * @param {React.RefObject} options.scrollContainerRef - 스크롤 컨테이너 ref
 */
export const usePullToRefresh = (onRefresh, options = {}) => {
  const {
    threshold = 80,
    maxPullDistance = 120,
    scrollContainerRef,
  } = options;

  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [canPull, setCanPull] = useState(false);

  const touchStartY = useRef(0);
  const touchStartContainerTop = useRef(0);
  const touchStartScrollTop = useRef(0);
  const isDragging = useRef(false);

  // 스크롤 위치 확인
  const checkScrollPosition = useCallback(() => {
    if (!scrollContainerRef?.current) {
      setCanPull(false);
      return;
    }

    const container = scrollContainerRef.current;
    const isAtTop = container.scrollTop === 0;
    setCanPull(isAtTop);
  }, [scrollContainerRef]);

  // 스크롤 이벤트 리스너
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    checkScrollPosition();
    container.addEventListener('scroll', checkScrollPosition);
    
    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
    };
  }, [scrollContainerRef, checkScrollPosition]);

  const handleTouchStart = useCallback((e) => {
    if (!scrollContainerRef?.current) return;
    
    const container = scrollContainerRef.current;
    const isAtTop = container.scrollTop === 0;
    
    if (isAtTop) {
      // 터치 시작 위치와 컨테이너 상단 위치를 모두 저장
      touchStartY.current = e.touches[0].clientY;
      const containerRect = container.getBoundingClientRect();
      touchStartContainerTop.current = containerRect.top;
      touchStartScrollTop.current = container.scrollTop;
      isDragging.current = true;
      setCanPull(true);
    }
  }, [scrollContainerRef]);

  const resetPull = useCallback(() => {
    setPullDistance(0);
    setIsPulling(false);
    isDragging.current = false;
    touchStartY.current = 0;
    touchStartContainerTop.current = 0;
    touchStartScrollTop.current = 0;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging.current || !scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    const currentY = e.touches[0].clientY;
    
    // 터치 Y 좌표의 차이를 계산 (이것이 실제 당김 거리)
    const deltaY = currentY - touchStartY.current;

    // 아래로 당기는 경우만 처리 (터치가 아래로 이동했고, 스크롤이 최상단인 경우)
    if (deltaY > 0 && container.scrollTop === 0) {
      // 기본 스크롤 동작 방지
      if (deltaY > 10) {
        e.preventDefault();
      }

      // 최대 당김 거리 제한
      const distance = Math.min(deltaY, maxPullDistance);
      setPullDistance(distance);
      setIsPulling(distance > 0);
    } else {
      // 위로 스크롤하거나 스크롤 위치가 변경된 경우 리셋
      if (container.scrollTop > 0) {
        resetPull();
      }
    }
  }, [scrollContainerRef, maxPullDistance, resetPull]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;

    // 임계값을 넘었으면 새로고침 실행
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setIsPulling(false);
      
      // 새로고침 콜백 실행
      Promise.resolve(onRefresh())
        .then(() => {
          // 새로고침 완료 후 약간의 딜레이를 두고 리셋
          setTimeout(() => {
            setIsRefreshing(false);
            resetPull();
          }, 300);
        })
        .catch(() => {
          setIsRefreshing(false);
          resetPull();
        });
    } else {
      // 임계값을 넘지 않았으면 리셋
      resetPull();
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh, resetPull]);

  // 새로고침 중이 아닐 때만 리셋 가능
  useEffect(() => {
    if (!isRefreshing && pullDistance === 0) {
      isDragging.current = false;
    }
  }, [isRefreshing, pullDistance]);

  return {
    pullDistance,
    isPulling,
    isRefreshing,
    canPull,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
};
