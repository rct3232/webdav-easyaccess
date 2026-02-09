import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Pull-to-refresh 훅
 * @param {Function} onRefresh - 새로고침 시 실행할 콜백
 * @param {Object} options - 옵션
 * @param {number} options.threshold - 새로고침을 트리거할 최소 당김 거리 (px, 기본 80px)
 * @param {number} options.maxPullDistance - 최대 당김 거리 (px, 기본 120px)
 * @param {React.RefObject} options.scrollContainerRef - 스크롤 컨테이너 ref
 * @param {boolean} options.showRefreshSuccess - 새로고침 완료 표시 중인지 여부 (이 값이 true일 때는 resetPull 호출 안 함)
 * @param {Function} options.onRefreshComplete - 새로고침 완료 시 호출할 콜백 (선택사항, onRefresh의 완료 콜백이 별도로 필요한 경우에만 사용)
 */
export const usePullToRefresh = (onRefresh, options = {}) => {
  const {
    threshold = 80,
    maxPullDistance = 120,
    scrollContainerRef,
    onRefreshComplete,
  } = options;

  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  // isRefreshing: pull-to-refresh 제스처로 인한 새로고침 진행 중인지 여부
  // (useFileManager의 loading과는 별개: 이 훅은 UI 제스처 상태만 관리)
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [canPull, setCanPull] = useState(false);

  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartContainerTop = useRef(0);
  const touchStartScrollTop = useRef(0);
  const isDragging = useRef(false);
  const rafId = useRef(null);
  const lastPullDistance = useRef(0);

  // 스크롤 위치 확인 (스크롤 이벤트 중에는 pullDistance 리셋하지 않음)
  const checkScrollPosition = useCallback(() => {
    if (!scrollContainerRef?.current) {
      setCanPull(false);
      return;
    }

    const container = scrollContainerRef.current;
    // 더 엄격한 최상단 체크: scrollTop <= 1
    const isAtTop = container.scrollTop <= 1;
    setCanPull(isAtTop);
    
    // 당기는 중이 아닐 때만 리셋 (스크롤 이벤트와의 충돌 방지)
    if (!isDragging.current && container.scrollTop > 5) {
      // 임계값 5px로 여유 두기 (미세한 스크롤 무시)
      setPullDistance(0);
      setIsPulling(false);
    }
  }, [scrollContainerRef]);

  // 스크롤 이벤트 리스너
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    checkScrollPosition();
    container.addEventListener('scroll', checkScrollPosition, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
    };
  }, [scrollContainerRef, checkScrollPosition]);

  const resetPull = useCallback(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    setPullDistance(0);
    setIsPulling(false);
    isDragging.current = false;
    touchStartY.current = 0;
    touchStartX.current = 0;
    touchStartContainerTop.current = 0;
    touchStartScrollTop.current = 0;
    lastPullDistance.current = 0;
  }, []);

  // requestAnimationFrame으로 상태 업데이트 최적화
  // 당기는 중에는 즉시 반응하도록 동기적으로 업데이트
  const updatePullDistance = useCallback((distance) => {
    const clampedDistance = Math.min(Math.max(0, distance), maxPullDistance);
    
    // 당기는 중에는 즉시 업데이트 (동기적)
    if (isDragging.current) {
      setPullDistance(clampedDistance);
      setIsPulling(clampedDistance > 0);
      lastPullDistance.current = clampedDistance;
    } else {
      // 당기지 않을 때는 requestAnimationFrame 사용
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      
      rafId.current = requestAnimationFrame(() => {
        setPullDistance(clampedDistance);
        setIsPulling(clampedDistance > 0);
        lastPullDistance.current = clampedDistance;
        rafId.current = null;
      });
    }
  }, [maxPullDistance]);

  // 터치 이벤트 핸들러들
  const handleTouchStart = useCallback((e) => {
    if (!scrollContainerRef?.current) return;
    
    const container = scrollContainerRef.current;
    // 더 엄격한 최상단 체크: scrollTop이 1 이하일 때만 허용 (iOS bounce 효과 미세 조정)
    const currentScrollTop = container.scrollTop;
    const isAtTop = currentScrollTop <= 1;
    
    // 다중 터치 처리: 단일 터치만 허용
    if (e.touches.length > 1) {
      resetPull();
      return;
    }
    
    // 터치 시작 위치와 스크롤 위치 저장 (resetPull 호출 전에 저장!)
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    const containerRect = container.getBoundingClientRect();
    touchStartContainerTop.current = containerRect.top;
    touchStartScrollTop.current = currentScrollTop; // 실제 스크롤 위치 저장
    
    // 초기 상태: 항상 false로 시작 (실제로 아래로 당길 때만 true로 변경)
    isDragging.current = false;
    lastPullDistance.current = 0;
    
    // 스크롤이 상단에 있으면 pull-to-refresh 가능 상태로 설정
    setCanPull(isAtTop);
    
    // 스크롤이 상단이 아니면 pull-to-refresh 비활성화 (하지만 touchStartScrollTop은 유지)
    if (!isAtTop) {
      // resetPull을 호출하면 touchStartScrollTop이 0으로 리셋되므로,
      // 대신 필요한 것만 리셋
      setPullDistance(0);
      setIsPulling(false);
      isDragging.current = false;
      lastPullDistance.current = 0;
    }
  }, [scrollContainerRef, resetPull]);

  const handleTouchMove = useCallback((e) => {
    if (!scrollContainerRef?.current) return;

    // 다중 터치 처리
    if (e.touches.length > 1) {
      resetPull();
      return;
    }

    const container = scrollContainerRef.current;
    
    // 가장 먼저 스크롤 위치 확인 (매번 확인하여 스크롤이 발생했는지 체크)
    const currentScrollTop = container.scrollTop;
    const isAtTop = currentScrollTop <= 1;
    
    // 터치 시작 시점의 스크롤 위치 확인 (엄격하게 체크)
    const startedAtTop = touchStartScrollTop.current <= 1;
    
    // 핵심 1: 시작 시점에 상단이 아니었으면 무조건 종료 (가장 먼저 체크)
    if (!startedAtTop) {
      if (isDragging.current) {
        resetPull();
      }
      return; // preventDefault 호출하지 않음 → 정상 스크롤 가능
    }
    
    // 핵심 2: 스크롤이 발생했는지 체크 (터치 시작 이후 스크롤 위치가 변경됨)
    // 아래로 당길 때 스크롤이 발생하면 안 됨
    if (currentScrollTop > touchStartScrollTop.current + 1) {
      // 스크롤이 아래로 발생함 (정상 스크롤)
      if (isDragging.current) {
        resetPull();
      }
      return; // preventDefault 호출하지 않음 → 정상 스크롤 가능
    }
    
    // 핵심 3: 현재 스크롤이 상단이 아니면 종료
    if (!isAtTop) {
      if (isDragging.current) {
        resetPull();
      }
      return; // preventDefault 호출하지 않음 → 정상 스크롤 가능
    }
    
    // 여기까지 왔으면: startedAtTop === true && isAtTop === true && 스크롤 발생하지 않음
    // 즉, 시작 시점에도 상단이었고, 현재도 상단에 있으며, 스크롤이 발생하지 않음
    
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    
    // 스크롤 방향 판단: 수직 스크롤만 처리
    const deltaX = Math.abs(currentX - touchStartX.current);
    const deltaY = currentY - touchStartY.current;
    
    // 수평 스크롤이 수직 스크롤보다 크면 무시
    if (deltaX > Math.abs(deltaY) && deltaX > 10) {
      if (isDragging.current) {
        resetPull();
      }
      return;
    }
    
    // 아래로 당기는 경우만 처리 (스크롤이 상단에 있을 때만)
    if (deltaY > 0) {
      // 추가 체크: 최소 당김 거리가 있어야 pull-to-refresh 활성화 (오탐지 방지)
      const minDragDistance = 5; // 5px 이상 당겨야 활성화
      
      if (deltaY >= minDragDistance) {
        // 실제로 아래로 당길 때만 isDragging 활성화
        if (!isDragging.current) {
          isDragging.current = true;
          setCanPull(true);
        }
        
        // preventDefault 호출하여 스크롤 방지
        e.preventDefault();
        
        // 최대 당김 거리 제한
        const distance = Math.min(deltaY, maxPullDistance);
        updatePullDistance(distance);
      }
    } else {
      // 위로 스크롤하는 경우 리셋
      if (isDragging.current) {
        resetPull();
      }
    }
  }, [scrollContainerRef, maxPullDistance, resetPull, updatePullDistance]);

  const handleTouchEnd = useCallback(() => {
    // 스크롤 위치 최종 확인
    if (!scrollContainerRef?.current) {
      resetPull();
      return;
    }
    
    const container = scrollContainerRef.current;
    const currentScrollTop = container.scrollTop;
    const isAtTop = currentScrollTop <= 1;
    const startedAtTop = touchStartScrollTop.current <= 1;
    
    // 스크롤이 상단이 아니거나, 시작 시점에 상단이 아니었으면 리셋하고 종료
    if (!isAtTop || !startedAtTop) {
      resetPull();
      return;
    }
    
    // isDragging이 false이거나 실제로 당기지 않았으면 리셋하고 종료
    if (!isDragging.current) {
      resetPull();
      return;
    }

    // 마지막 pullDistance 사용 (ref에서 가져오기)
    const finalDistance = lastPullDistance.current;

    // 실제로 당긴 거리가 임계값을 넘었고, 새로고침 중이 아니면 새로고침 실행
    if (finalDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setIsPulling(false);
      
      // 새로고침 콜백 실행
      Promise.resolve(onRefresh())
        .then(() => {
          // 새로고침 완료 후 isRefreshing을 false로 설정
          setIsRefreshing(false);
          // 즉시 showRefreshSuccess를 true로 설정하는 콜백 호출 (동기적 처리)
          if (onRefreshComplete) {
            onRefreshComplete();
          }
        })
        .catch(() => {
          setIsRefreshing(false);
          // 에러 발생 시에는 즉시 resetPull 호출
          resetPull();
        });
    } else {
      // 임계값을 넘지 않았으면 리셋
      resetPull();
    }
  }, [scrollContainerRef, threshold, isRefreshing, onRefresh, onRefreshComplete, resetPull]);

  // useEffect로 직접 이벤트 리스너 등록 (non-passive)
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    // non-passive 리스너로 등록하여 preventDefault 작동 보장
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      
      // cleanup: requestAnimationFrame 취소
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [scrollContainerRef, handleTouchStart, handleTouchMove, handleTouchEnd]);

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
    threshold,
    resetPull, // 외부에서 호출할 수 있도록 반환
    // touchHandlers는 더 이상 반환하지 않음 (훅에서 직접 처리)
    touchHandlers: {},
  };
};
