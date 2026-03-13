import { useState, useCallback, useEffect, useRef } from 'react';

const HIDE_UI_DELAY_MS = 2000;

export const useUIVisibility = ({ open, isMobile }) => {
  const [headerVisible, setHeaderVisible] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const startHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (isMobile) {
        setHeaderVisible(false);
      } else {
        setControlsVisible(false);
      }
    }, HIDE_UI_DELAY_MS);
  }, [isMobile, clearHideTimer]);

  const resetHideTimer = useCallback(() => {
    if (isMobile) {
      setHeaderVisible(true);
    } else {
      setControlsVisible(true);
    }
    startHideTimer();
  }, [isMobile, startHideTimer]);

  useEffect(() => {
    if (open) {
      setHeaderVisible(true);
      setControlsVisible(true);
    } else {
      clearHideTimer();
    }
  }, [open, clearHideTimer]);

  return {
    headerVisible,
    controlsVisible,
    setHeaderVisible,
    startHideTimer,
    clearHideTimer,
    resetHideTimer,
  };
};
