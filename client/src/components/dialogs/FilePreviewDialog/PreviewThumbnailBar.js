import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import { Image as ImageIcon, VideoFile as VideoIcon } from '@mui/icons-material';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import { useResponsive } from '../../../hooks/useResponsive';
import { useThumbnailLazyLoad } from '../../../hooks/useThumbnailLazyLoad';

const THUMB_SIZE = 64;
const GAP = 8;
const FADE_WIDTH = 24;

const PreviewThumbnailBar = ({ files, currentIndex, onSelect, onThumbnailsLoaded, shareToken }) => {
  const { isMobile } = useResponsive();
  const scrollRef = useRef(null);
  const thumbRefs = useRef([]);
  const prevIndexRef = useRef(null);

  useThumbnailLazyLoad(files, onThumbnailsLoaded || (() => {}), shareToken ? { shareToken } : {});

  useEffect(() => {
    const thumb = thumbRefs.current[currentIndex];
    if (thumb && scrollRef.current) {
      const container = scrollRef.current;
      const containerWidth = container.clientWidth;
      const thumbLeft = thumb.offsetLeft;
      const thumbWidth = thumb.offsetWidth;
      const targetLeft = thumbLeft - containerWidth / 2 + thumbWidth / 2;
      const isFirstRun = prevIndexRef.current === null;
      const isSameIndex = prevIndexRef.current === currentIndex;
      prevIndexRef.current = currentIndex;
      const useInstantScroll = isFirstRun || isSameIndex;
      if (useInstantScroll) {
        const prev = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        container.scrollTo({ left: targetLeft, behavior: 'auto' });
        container.style.scrollBehavior = prev;
      } else {
        container.scrollTo({ left: targetLeft, behavior: 'smooth' });
      }
    }
  }, [currentIndex]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const blockWheel = (e) => e.preventDefault();
    el.addEventListener('wheel', blockWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', blockWheel, { capture: true });
  }, []);

  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      sx={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: isMobile ? '100%' : '80%',
        maxWidth: '100%',
        zIndex: 10,
      }}
    >
      <Box
        ref={scrollRef}
        sx={{
          overflowX: 'hidden',
          touchAction: 'pan-y',
          display: 'flex',
          gap: `${GAP}px`,
          px: 1,
          py: 1,
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          '&::-webkit-scrollbar': { height: 6 },
          position: 'relative',
          maskImage: `linear-gradient(to right, transparent 0, black ${FADE_WIDTH}px, black calc(100% - ${FADE_WIDTH}px), transparent 100%)`,
          WebkitMaskImage: `linear-gradient(to right, transparent 0, black ${FADE_WIDTH}px, black calc(100% - ${FADE_WIDTH}px), transparent 100%)`,
          maskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat',
        }}
      >
        <Box sx={{ minWidth: `calc(50% - ${THUMB_SIZE / 2}px - ${GAP / 2}px)` }} />
        {files.map((f, i) => {
          const ft = getFileType(f.basename || f.name);
          const thumbUrl = f.thumbnailUrl;
          const isSelected = i === currentIndex;

          return (
            <Box
              key={f.path}
              data-file-path={f.path}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              onClick={() => onSelect(i)}
              sx={{
                flexShrink: 0,
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: 1,
                overflow: 'hidden',
                cursor: 'pointer',
                border: isSelected ? '2px solid white' : '2px solid transparent',
                boxSizing: 'border-box',
                scrollSnapAlign: 'center',
              }}
            >
              {thumbUrl ? (
                <Box
                  component="img"
                  src={thumbUrl}
                  alt=""
                  sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  {ft === 'video' ? (
                    <VideoIcon sx={{ fontSize: 28 }} />
                  ) : (
                    <ImageIcon sx={{ fontSize: 28 }} />
                  )}
                </Box>
              )}
            </Box>
          );
        })}
        <Box sx={{ minWidth: `calc(50% - ${THUMB_SIZE / 2}px - ${GAP / 2}px)` }} />
      </Box>
    </Box>
  );
};

export default PreviewThumbnailBar;
