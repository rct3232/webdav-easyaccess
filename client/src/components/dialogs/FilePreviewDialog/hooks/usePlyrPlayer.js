import { useState, useEffect, useRef } from 'react';
import PlyrLib from 'plyr';
import 'plyr/dist/plyr.css';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

export const usePlyrPlayer = ({
  open,
  previewUrl,
  displayFile,
  file,
  headerVisible,
  controlsVisible,
  isMobile,
  currentPreviewFileType,
  loading,
  isGalleryMode,
  touchStartX,
  touchStartedOnPlyrControls,
}) => {
  const [videoNotPlayable, setVideoNotPlayable] = useState(false);
  const audioContainerRef = useRef(null);
  const audioPlyrRef = useRef(null);
  const videoContainerRef = useRef(null);
  const videoPlyrRef = useRef(null);
  const mediaTouchRef = useRef(null);

  // Plyr for audio: create audio element imperatively so Plyr's DOM mutations don't conflict with React
  useEffect(() => {
    const target = displayFile || file;
    const filename = target?.name || target?.basename;
    const isAudio = open && previewUrl && getFileType(filename) === 'audio';
    const container = audioContainerRef.current;
    if (!isAudio || !container) {
      if (audioPlyrRef.current) {
        audioPlyrRef.current.destroy();
        audioPlyrRef.current = null;
      }
      return;
    }
    const audioEl = document.createElement('audio');
    audioEl.className = 'plyr-react plyr';
    audioEl.controls = true;
    audioEl.src = previewUrl;
    audioEl.style.width = '100%';
    audioEl.style.maxWidth = '500px';
    container.appendChild(audioEl);
    audioPlyrRef.current = new PlyrLib(audioEl, { ratio: null });
    return () => {
      audioPlyrRef.current?.destroy();
      audioPlyrRef.current = null;
      if (audioEl.parentNode === container) {
        container.removeChild(audioEl);
      }
    };
  }, [open, previewUrl, displayFile, file]);

  // Plyr for video: create video element imperatively so Plyr's DOM mutations don't conflict with React
  useEffect(() => {
    const target = displayFile || file;
    const filename = target?.name || target?.basename;
    const isVideo = open && previewUrl && getFileType(filename) === 'video';
    const container = videoContainerRef.current;
    if (!isVideo || !container) {
      if (videoPlyrRef.current) {
        videoPlyrRef.current.destroy();
        videoPlyrRef.current = null;
      }
      return;
    }
    setVideoNotPlayable(false);
    // Clear any leftover nodes from previous run (Plyr wrap moves video so removeChild often skips)
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    const videoEl = document.createElement('video');
    videoEl.controls = false; // Plyr provides controls; native controls would show both UIs
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';

    const onError = () => {
      setVideoNotPlayable(true);
    };
    const onCanPlay = () => {
      setVideoNotPlayable(false);
    };
    const onWaiting = () => {
      if (videoEl?.networkState === 3 /* NETWORK_NO_SOURCE */) {
        setVideoNotPlayable(true);
      }
    };
    const onStalled = () => {
      if (videoEl?.networkState === 3 /* NETWORK_NO_SOURCE */) {
        setVideoNotPlayable(true);
      }
    };

    videoEl.addEventListener('error', onError);
    videoEl.addEventListener('canplay', onCanPlay);
    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('stalled', onStalled);

    const source = document.createElement('source');
    source.src = previewUrl;
    videoEl.appendChild(source);
    container.appendChild(videoEl);
    videoEl.load();
    videoPlyrRef.current = new PlyrLib(videoEl, {
      ratio: null,
      hideControls: false, // We sync with headerVisible on mobile; no separate Plyr timer
    });
    return () => {
      videoPlyrRef.current?.destroy();
      videoPlyrRef.current = null;
      videoEl.removeEventListener('error', onError);
      videoEl.removeEventListener('canplay', onCanPlay);
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('stalled', onStalled);
      // Clear all children; Plyr wrap moves video so videoEl.parentNode !== container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [open, previewUrl, displayFile, file]);

  // Sync Plyr controls with headerVisible (mobile) or controlsVisible (desktop) for video preview
  useEffect(() => {
    const plyr = videoPlyrRef.current;
    if (!plyr || currentPreviewFileType !== 'video') return;
    const visible = isMobile ? headerVisible : controlsVisible;
    plyr.toggleControls(visible);
  }, [headerVisible, controlsVisible, isMobile, currentPreviewFileType]);

  // Prevent click synthesis on tap-to-toggle (mobile video) so Plyr play/pause and DialogContent
  // onClick don't fire. Uses passive: false so preventDefault has effect.
  // loading in deps: effect must re-run when video Box mounts (loading finishes)
  // Skip preventDefault when tap is on .plyr__control (play button, etc.) so play/pause still works.
  useEffect(() => {
    const el = mediaTouchRef.current;
    if (!el) return;
    const handler = (e) => {
      if (touchStartedOnPlyrControls.current) return;
      if (touchStartX.current == null) return;
      const endX = e.changedTouches?.[0]?.clientX;
      if (endX == null) return;
      const diff = touchStartX.current - endX;
      if (isGalleryMode && Math.abs(diff) > 50) return; // swipe, not tap
      const onPlyrControl = e.target?.closest?.('.plyr__control');
      if (onPlyrControl) return; // play button, etc. - let click through
      if (isMobile && currentPreviewFileType === 'video' && Math.abs(diff) < 50) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchend', handler, { passive: false, capture: true });
    return () => el.removeEventListener('touchend', handler, { passive: false, capture: true });
  }, [
    loading,
    isGalleryMode,
    isMobile,
    currentPreviewFileType,
    touchStartX,
    touchStartedOnPlyrControls,
  ]);

  return { videoNotPlayable, audioContainerRef, videoContainerRef, mediaTouchRef };
};
