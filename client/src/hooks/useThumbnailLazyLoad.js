import { useEffect, useRef, useCallback } from 'react';
import { requestThumbnailsBatch } from '../services/fileService';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

const DEBOUNCE_MS = 200;
const ROOT_MARGIN = '100px'; // preload 100px beyond viewport

/**
 * Check if a file is an image or video type
 */
const isImageOrVideoFile = (file) => {
  if (file.type === 'directory') return false;
  const basename = file.basename || file.name || '';
  const mime = file.mime || '';

  if (mime.startsWith('image/') || mime.startsWith('video/')) {
    return true;
  }

  const type = getFileType(basename);
  return type === 'image' || type === 'video';
};

/**
 * Thumbnail lazy-loading hook using IntersectionObserver
 *
 * @param {Array} files - List of files
 * @param {Function} onThumbnailsLoaded - Callback fired when thumbnails are loaded
 * @param {Object} options - Pass { shareToken } for shared link view
 * @returns {Object} { containerRef } - Container reference (use if needed)
 */
export const useThumbnailLazyLoad = (files, onThumbnailsLoaded, options = {}) => {
  const observerRef = useRef(null);
  const requestedPathsRef = useRef(new Set());
  const pendingRequestRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const pendingPathsRef = useRef(new Set());
  const containerRef = useRef(null);

  /**
   * Batch thumbnail request (with debouncing)
   */
  const requestThumbnails = useCallback((paths) => {
    if (paths.length === 0) return;

    // Debounce: cancel existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Add paths to pending set
    paths.forEach(path => pendingPathsRef.current.add(path));

    // Debounced request
    debounceTimerRef.current = setTimeout(async () => {
      const pathsToRequest = Array.from(pendingPathsRef.current);
      pendingPathsRef.current.clear();

      if (pathsToRequest.length === 0 || pendingRequestRef.current) {
        return;
      }

      // Add requested paths to tracker
      pathsToRequest.forEach(path => requestedPathsRef.current.add(path));

      pendingRequestRef.current = (async () => {
        try {
          const response = await requestThumbnailsBatch(pathsToRequest, options);
          if (response.thumbnails && onThumbnailsLoaded) {
            // Convert thumbnail URLs to a Map
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
          // On error, remove paths from tracker so they can be retried
          pathsToRequest.forEach(path => requestedPathsRef.current.delete(path));
        } finally {
          pendingRequestRef.current = null;
        }
      })();
    }, DEBOUNCE_MS);
  }, [onThumbnailsLoaded, options]);

  /**
   * IntersectionObserver callback
   */
  const handleIntersection = useCallback((entries) => {
    const visiblePaths = [];

    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const filePath = entry.target.getAttribute('data-file-path');
        if (filePath) {
          const file = files.find(f => f.path === filePath);
          // If image/video, no thumbnail yet, and not already requested
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
   * Set up IntersectionObserver
   */
  useEffect(() => {
    // Check IntersectionObserver support
    if (!window.IntersectionObserver) {
      console.warn('Intersection Observer not supported');
      return;
    }

    // Create observer
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: null, // use viewport as root
      rootMargin: ROOT_MARGIN,
      threshold: 0.01, // detect when at least 1% is visible
    });

    // Start observing all file elements
    const observeElements = () => {
      const fileElements = document.querySelectorAll('[data-file-path]');
      fileElements.forEach((element) => {
        observerRef.current.observe(element);
      });
    };

    // Initial observation (allow DOM time to render)
    const initialTimeout = setTimeout(observeElements, 100);

    // Watch for new DOM nodes instead of polling with setInterval
    const mutationObserver = new MutationObserver(() => {
      observeElements();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Cleanup
    return () => {
      clearTimeout(initialTimeout);
      mutationObserver.disconnect();
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [handleIntersection]);

  /**
   * Reset request state when file list changes
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
