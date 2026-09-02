import { useState, useEffect, useMemo, useRef } from 'react';
import { pixelMiddleTruncate } from '../../../../utils/stringUtils';

const HEADER_FONT = '500 1.25rem Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
const HEADER_SAFETY_PX = 24;
const HEADER_GAP_PX = 8;
const HEADER_FALLBACK_WIDTH_PX = 360;

export const useHeaderTruncation = ({ open, hideCloseButton, textContent, displayFile, file }) => {
  const titleRowRef = useRef(null);
  const actionsRef = useRef(null);
  const textContainerRef = useRef(null);
  const textPreRef = useRef(null);
  const [titleRowWidth, setTitleRowWidth] = useState(0);
  const [actionsWidth, setActionsWidth] = useState(0);
  const [textOverflows, setTextOverflows] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (typeof ResizeObserver === 'undefined') return;

    const updateHeaderSizes = () => {
      setTitleRowWidth(titleRowRef.current?.clientWidth ?? 0);
      setActionsWidth(actionsRef.current?.clientWidth ?? 0);
    };

    let ro = null;
    let cancelled = false;

    const setupObserver = () => {
      if (cancelled) return;
      updateHeaderSizes();
      ro = new ResizeObserver(updateHeaderSizes);
      if (titleRowRef.current) ro.observe(titleRowRef.current);
      if (actionsRef.current) ro.observe(actionsRef.current);
    };

    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      setupObserver();
    });

    window.addEventListener('resize', updateHeaderSizes);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateHeaderSizes);
    };
  }, [open, hideCloseButton]);

  // Text overflow detection for vertical layout
  useEffect(() => {
    if (!open || !textContent) {
      setTextOverflows(false);
      return;
    }
    const container = textContainerRef.current;
    const pre = textPreRef.current;
    if (!container || !pre) return;

    const check = () => {
      if (container && pre) {
        setTextOverflows(pre.scrollHeight > container.clientHeight);
      }
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);

    return () => ro.disconnect();
  }, [open, textContent]);

  const originalHeaderName = (displayFile || file)?.name || (displayFile || file)?.basename || '';
  const maxHeaderTitleWidth =
    titleRowWidth > 0
      ? Math.max(40, titleRowWidth - actionsWidth - HEADER_SAFETY_PX - HEADER_GAP_PX)
      : HEADER_FALLBACK_WIDTH_PX;

  const truncatedHeaderName = useMemo(
    () => pixelMiddleTruncate(originalHeaderName, maxHeaderTitleWidth, HEADER_FONT),
    [originalHeaderName, maxHeaderTitleWidth]
  );
  const isHeaderTruncated = truncatedHeaderName !== originalHeaderName;

  return {
    titleRowRef,
    actionsRef,
    textContainerRef,
    textPreRef,
    truncatedHeaderName,
    isHeaderTruncated,
    textOverflows,
    originalHeaderName,
  };
};
