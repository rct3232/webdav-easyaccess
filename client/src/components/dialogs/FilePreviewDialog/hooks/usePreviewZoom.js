import { useState, useCallback, useEffect } from 'react';

const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 3;
const DEFAULT_STEP = 0.25;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const usePreviewZoom = ({
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  initialZoom = 1,
  step = DEFAULT_STEP,
  open,
  previewFileType,
  displayFile,
} = {}) => {
  const [zoom, setZoomState] = useState(initialZoom);

  const setZoom = useCallback(
    (valueOrUpdater) => {
      setZoomState((prev) => {
        const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
        return clamp(next, minZoom, maxZoom);
      });
    },
    [minZoom, maxZoom]
  );

  const zoomIn = useCallback(() => {
    setZoom((prev) => clamp(prev + step, minZoom, maxZoom));
  }, [minZoom, maxZoom, step]);

  const zoomOut = useCallback(() => {
    setZoom((prev) => clamp(prev - step, minZoom, maxZoom));
  }, [minZoom, maxZoom, step]);

  const resetZoom = useCallback(() => {
    setZoomState(1);
  }, []);

  useEffect(() => {
    setZoomState(1);
  }, [open, previewFileType, displayFile?.path]);

  return { zoom, zoomIn, zoomOut, resetZoom, setZoom };
};
