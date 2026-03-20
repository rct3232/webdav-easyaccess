import { useState, useRef, useCallback, useMemo } from 'react';

import { usePullToRefresh } from '../../../hooks/usePullToRefresh';

const REFRESH_SUCCESS_DURATION = 500;
const INDICATOR_BASE_HEIGHT = 60;
const MAX_PULL_MARGIN = 40;

export function useExplorerRefreshIndicator({
  isMobile,
  loading,
  loadFiles,
  scrollContainerRef,
  t,
}) {
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false);
  const refreshSuccessTimeoutRef = useRef(null);

  const {
    pullDistance,
    isPulling,
    isRefreshing,
    threshold,
    resetPull,
  } = usePullToRefresh(loadFiles, {
    scrollContainerRef: isMobile ? scrollContainerRef : null,
    threshold: 240,
    maxPullDistance: 300,
    showRefreshSuccess: isMobile ? showRefreshSuccess : false,
    onRefreshComplete: isMobile ? () => {
      handleRefreshCompleteRef.current?.();
    } : undefined,
  });

  const showRefreshSuccessIndicator = useCallback((options = {}) => {
    const { shouldResetPull = false, shouldCheckRefreshing = false } = options;

    if (!isMobile) return;
    if (shouldCheckRefreshing && isRefreshing) return;

    if (refreshSuccessTimeoutRef.current) {
      clearTimeout(refreshSuccessTimeoutRef.current);
    }

    setShowRefreshSuccess(true);
    refreshSuccessTimeoutRef.current = setTimeout(() => {
      setShowRefreshSuccess(false);
      if (shouldResetPull && resetPull) {
        resetPull();
      }
    }, REFRESH_SUCCESS_DURATION);
  }, [isMobile, isRefreshing, resetPull]);

  const handleLoadComplete = useCallback(() => {
    showRefreshSuccessIndicator({ shouldCheckRefreshing: true });
  }, [showRefreshSuccessIndicator]);

  const handleRefreshComplete = useCallback(() => {
    showRefreshSuccessIndicator({ shouldResetPull: true });
  }, [showRefreshSuccessIndicator]);

  const handleRefreshCompleteRef = useRef(handleRefreshComplete);
  handleRefreshCompleteRef.current = handleRefreshComplete;

  const progress = Math.min(pullDistance / threshold, 1);
  const hasReachedThreshold = pullDistance >= threshold;
  const shouldShowIndicator = isPulling || isRefreshing || loading || showRefreshSuccess;
  const isActiveLoading = isRefreshing || loading || showRefreshSuccess;
  const isPullingOnly = isPulling && !isRefreshing && !loading && !showRefreshSuccess;
  const isDeterminateProgress = isPullingOnly;

  const indicatorStyles = useMemo(() => ({
    paddingTop: shouldShowIndicator ? '16px' : '0px',
    paddingBottom: shouldShowIndicator ? '16px' : '0px',
    marginTop: isActiveLoading
      ? '0px'
      : `${Math.max(-pullDistance * 0.5, -MAX_PULL_MARGIN)}px`,
    transition: isActiveLoading
      ? 'margin-top 0.3s ease-out, min-height 0.3s ease-out, opacity 0.3s ease-out'
      : isPulling
        ? 'none'
        : 'margin-top 0.15s ease-out, min-height 0.15s ease-out, opacity 0.15s ease-out',
    opacity: shouldShowIndicator
      ? (isActiveLoading ? 1 : Math.min(pullDistance / threshold, 1))
      : 0,
    minHeight: shouldShowIndicator
      ? (isPullingOnly ? `${INDICATOR_BASE_HEIGHT + pullDistance}px` : `${INDICATOR_BASE_HEIGHT}px`)
      : 0,
    height: shouldShowIndicator
      ? (isPullingOnly ? `${INDICATOR_BASE_HEIGHT + pullDistance}px` : 'auto')
      : 0,
    overflow: 'hidden',
  }), [shouldShowIndicator, isActiveLoading, isPullingOnly, isPulling, pullDistance, threshold]);

  const iconStyles = useMemo(() => ({
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    mb: 1,
    transform: isPullingOnly ? `rotate(${pullDistance * 2}deg)` : 'none',
    transition: 'transform 0.1s ease-out, color 0.2s ease',
  }), [isPullingOnly, pullDistance]);

  const progressColor = useMemo(() => {
    if (hasReachedThreshold && isPullingOnly) {
      return 'primary.main';
    }
    if (isPullingOnly) {
      return 'text.disabled';
    }
    return 'primary.main';
  }, [hasReachedThreshold, isPullingOnly]);

  const textColor = useMemo(() => {
    if (showRefreshSuccess) {
      return 'success.main';
    }
    if (hasReachedThreshold && isPullingOnly) {
      return 'primary.main';
    }
    return 'text.secondary';
  }, [showRefreshSuccess, hasReachedThreshold, isPullingOnly]);

  const textContent = useMemo(() => {
    if (showRefreshSuccess) {
      return t('fileManager.pullRefreshDone');
    }
    if (isRefreshing || loading) {
      return t('fileManager.pullRefreshLoading');
    }
    if (hasReachedThreshold) {
      return t('fileManager.pullRefreshRelease');
    }
    return t('fileManager.pullRefreshPull');
  }, [showRefreshSuccess, isRefreshing, loading, hasReachedThreshold, t]);

  return {
    pullDistance,
    isPulling,
    isRefreshing,
    threshold,
    showRefreshSuccess,
    handleLoadComplete,
    handleRefreshComplete,
    indicatorStyles,
    iconStyles,
    progress,
    progressColor,
    textColor,
    textContent,
    shouldShowIndicator,
    isDeterminateProgress,
  };
}
