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
  const requestedNodeIdsRef = useRef(new Set());
  const pendingRequestRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const pendingNodeIdsRef = useRef(new Set());
  const containerRef = useRef(null);

  /**
   * Batch thumbnail request (with debouncing)
   */
  const requestThumbnails = useCallback((nodeIds) => {
    if (nodeIds.length === 0) return;

    // Debounce: cancel existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Add nodeIds to pending set
    nodeIds.forEach(nodeId => pendingNodeIdsRef.current.add(nodeId));

    // Debounced request
    debounceTimerRef.current = setTimeout(async () => {
      const nodeIdsToRequest = Array.from(pendingNodeIdsRef.current);
      pendingNodeIdsRef.current.clear();

      if (nodeIdsToRequest.length === 0 || pendingRequestRef.current) {
        return;
      }

      // Add requested nodeIds to tracker
      nodeIdsToRequest.forEach(nodeId => requestedNodeIdsRef.current.add(nodeId));

      pendingRequestRef.current = (async () => {
        try {
          const response = await requestThumbnailsBatch(nodeIdsToRequest, options);
          if (response.thumbnails && onThumbnailsLoaded) {
            // Convert thumbnail URLs to a Map keyed by nodeId
            const thumbnailMap = new Map();
            response.thumbnails.forEach(({ nodeId, thumbnailUrl }) => {
              if (thumbnailUrl) {
                thumbnailMap.set(nodeId, thumbnailUrl);
              }
            });
            onThumbnailsLoaded(thumbnailMap);
          }
        } catch (error) {
          console.error('Failed to load thumbnails:', error);
          // On error, remove nodeIds from tracker so they can be retried
          nodeIdsToRequest.forEach(nodeId => requestedNodeIdsRef.current.delete(nodeId));
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
    const visibleNodeIds = [];

    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const fileNodeId = Number(entry.target.getAttribute('data-file-node-id'));
        if (Number.isFinite(fileNodeId)) {
          const file = files.find(f => f.nodeId === fileNodeId);
          // If image/video, no thumbnail yet, and not already requested
          if (file && isImageOrVideoFile(file) && !file.thumbnailUrl && !requestedNodeIdsRef.current.has(fileNodeId)) {
            visibleNodeIds.push(fileNodeId);
          }
        }
      }
    });

    if (visibleNodeIds.length > 0) {
      requestThumbnails(visibleNodeIds);
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
      const fileElements = document.querySelectorAll('[data-file-node-id]');
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
    requestedNodeIdsRef.current.clear();
    pendingNodeIdsRef.current.clear();
    pendingRequestRef.current = null;
  }, [files]);

  return {
    containerRef,
  };
};
