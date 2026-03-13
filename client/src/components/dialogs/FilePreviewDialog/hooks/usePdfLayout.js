import { useState, useEffect, useMemo, useRef } from 'react';

export const usePdfLayout = ({ open, previewUrl, isMobile }) => {
  const [containerWidth, setContainerWidth] = useState(null);
  const [containerHeight, setContainerHeight] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const pdfContainerRef = useRef(null);
  const stableWidthRef = useRef(null);

  // Reset PDF state when dialog closes or previewUrl changes
  useEffect(() => {
    if (!open) {
      setContainerWidth(null);
      setContainerHeight(null);
      setPageInfo(null);
      setNumPages(null);
      stableWidthRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    stableWidthRef.current = null;
  }, [previewUrl]);

  // Measure container dimensions
  useEffect(() => {
    if (!open || !pdfContainerRef.current) {
      return;
    }

    const updateContainerSize = () => {
      if (pdfContainerRef.current) {
        const width = pdfContainerRef.current.clientWidth;
        const height = pdfContainerRef.current.clientHeight;
        setContainerWidth(width - 32); // account for padding
        setContainerHeight(height - 32); // account for padding
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(pdfContainerRef.current);

    window.addEventListener('resize', updateContainerSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateContainerSize);
    };
  }, [open, previewUrl]);

  const calculatedWidth = useMemo(() => {
    if (!containerWidth) {
      return isMobile ? undefined : Math.min(800, window.innerWidth - 100);
    }

    if (!containerHeight || !pageInfo) {
      return containerWidth;
    }

    if (stableWidthRef.current !== null) {
      return stableWidthRef.current;
    }

    const { width: pageWidth, height: pageHeight } = pageInfo;
    const widthRatio = containerWidth / pageWidth;
    const heightRatio = containerHeight / pageHeight;
    const scale = Math.min(widthRatio, heightRatio, 1);
    const width = pageWidth * scale;

    stableWidthRef.current = width;

    return width;
  }, [containerWidth, containerHeight, pageInfo, isMobile]);

  const pageArray = useMemo(() => {
    if (!numPages) return [];
    return Array.from(new Array(numPages), (_, index) => index + 1);
  }, [numPages]);

  return {
    pdfContainerRef,
    containerWidth,
    containerHeight,
    numPages,
    pageInfo,
    calculatedWidth,
    pageArray,
    setNumPages,
    setPageInfo,
  };
};
