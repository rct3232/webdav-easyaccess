import { useEffect, useRef } from 'react';

const WHEEL_SENSITIVITY = 0.004;
const MAX_SCALE_PER_EVENT = 0.45;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const useZoomInputs = ({
  containerRef,
  setZoom,
  isMobile,
  enabled,
  minZoom = 0.5,
  maxZoom = 3,
  previewFileType,
}) => {
  const pinchRef = useRef({ lastDistance: null });

  useEffect(() => {
    const el = containerRef?.current;
    if (!enabled || !el) return;

    const handleWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY;
      const scaleFactor = 1 + delta * WHEEL_SENSITIVITY;
      const clampedScale = Math.max(
        1 - MAX_SCALE_PER_EVENT,
        Math.min(1 + MAX_SCALE_PER_EVENT, scaleFactor)
      );
      setZoom((prev) => clamp(prev * clampedScale, minZoom, maxZoom));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });

    let touchCleanup = () => {};
    if (isMobile) {
      const handleTouchStart = (e) => {
        if (e.touches.length === 2) {
          const d = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
          );
          pinchRef.current.lastDistance = d;
        }
      };

      const handleTouchMove = (e) => {
        if (e.touches.length === 2 && pinchRef.current.lastDistance !== null) {
          const lastD = pinchRef.current.lastDistance;
          const d = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
          );
          if (lastD < 10) {
            pinchRef.current.lastDistance = d;
            return;
          }
          const ratio = d / lastD;
          pinchRef.current.lastDistance = d;
          setZoom((prev) => clamp(prev * ratio, minZoom, maxZoom));
        }
      };

      const handleTouchEnd = () => {
        pinchRef.current.lastDistance = null;
      };

      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchmove', handleTouchMove, { passive: true });
      el.addEventListener('touchend', handleTouchEnd);
      el.addEventListener('touchcancel', handleTouchEnd);

      touchCleanup = () => {
        el.removeEventListener('touchstart', handleTouchStart);
        el.removeEventListener('touchmove', handleTouchMove);
        el.removeEventListener('touchend', handleTouchEnd);
        el.removeEventListener('touchcancel', handleTouchEnd);
      };
    }

    return () => {
      el.removeEventListener('wheel', handleWheel);
      touchCleanup();
    };
  }, [enabled, containerRef, setZoom, minZoom, maxZoom, isMobile, previewFileType]);
};
