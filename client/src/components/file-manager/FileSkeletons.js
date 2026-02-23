import React from 'react';
import { Box, Skeleton, TableRow, TableCell } from '@mui/material';
import { useResponsive } from '../../hooks/useResponsive';

/**
 * Returns opacity for skeleton at index (0–1). Undefined means 100%.
 * Gradual fade for last 1–3 items: count=2→50%; count=3→66%,33%; count≥4→75%,50%,25%.
 * When count≥5, first (count−3) stay at 100%.
 * @param {number} index - 0-based skeleton index
 * @param {number} count - total skeleton count
 * @returns {number|undefined}
 */
const getSkeletonOpacity = (index, count) => {
  if (count < 2) return undefined;
  const fadeSteps =
    count === 2 ? [0.5] : count === 3 ? [2 / 3, 1 / 3] : [0.75, 0.5, 0.25];
  const startIndex = count - fadeSteps.length;
  if (index < startIndex) return undefined;
  return fadeSteps[index - startIndex];
};

/**
 * List view skeleton loader
 * Matches the layout of FileList items: icon (40x40) + text area + metadata
 * Uses responsive grid layout: single column on mobile, grid on desktop
 */
export const FileListSkeleton = ({ count, selectionMode = false }) => {
  const { isMobile } = useResponsive();
  const skeletonCount = count || (isMobile ? 4 : 6);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 2,
      }}
    >
      {Array.from({ length: skeletonCount }).map((_, index) => {
        const opacity = getSkeletonOpacity(index, skeletonCount);
        return (
        <Box
          key={index}
          sx={{
            display: 'flex',
            alignItems: 'center',
            p: 1.5,
            borderRadius: 1,
            ...(opacity != null && { opacity }),
          }}
        >
          <Box sx={{ minWidth: 56, display: 'flex', justifyContent: 'center', mr: 2 }}>
            <Skeleton 
              variant="rectangular" 
              width={40} 
              height={40} 
              animation="wave"
              sx={{ borderRadius: 1 }} 
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton 
              variant="text" 
              width="60%" 
              height={20} 
              animation="wave"
              sx={{ mb: 0.5 }} 
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
              <Skeleton 
                variant="text" 
                width={60} 
                height={16} 
                animation="wave"
              />
              <Skeleton 
                variant="text" 
                width={80} 
                height={16} 
                animation="wave"
              />
            </Box>
          </Box>
        </Box>
        );
      })}
    </Box>
  );
};

/**
 * Grid view skeleton loader
 * Matches the layout of FileGrid cards: square image area + text
 * Uses same CSS Grid layout as FileGrid: 2 cols on mobile, 200px fixed on PC
 */
export const FileGridSkeleton = ({ count, selectionMode = false }) => {
  const { isMobile } = useResponsive();
  const skeletonCount = count || (isMobile ? 4 : 8);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          md: 'repeat(auto-fill, 200px)',
        },
        gap: { xs: 1.5, md: 2 },
      }}
    >
      {Array.from({ length: skeletonCount }).map((_, index) => {
        const opacity = getSkeletonOpacity(index, skeletonCount);
        return (
        <Box
          key={index}
          sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 1,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            position: 'relative',
            ...(opacity != null && { opacity }),
          }}
        >
          <Box
            sx={{
              width: '100%',
              aspectRatio: '1 / 1',
              backgroundColor: 'grey.100',
            }}
          >
            <Skeleton 
              variant="rectangular" 
              width="100%" 
              height="100%" 
              animation="wave"
            />
          </Box>
          <Box sx={{ p: 1, pt: 0.5, pb: 1 }}>
            <Skeleton 
              variant="text" 
              width="80%" 
              height={20} 
              animation="wave"
              sx={{ mx: 'auto' }} 
            />
          </Box>
        </Box>
        );
      })}
    </Box>
  );
};

/**
 * Detail view skeleton loader
 * Matches the layout of FileDetail table rows: icon + name + type + size + date
 */
export const FileDetailSkeleton = ({ count, selectionMode = false }) => {
  const skeletonCount = count || 6;

  return (
    <>
      {Array.from({ length: skeletonCount }).map((_, index) => {
        const opacity = getSkeletonOpacity(index, skeletonCount);
        return (
        <TableRow
          key={index}
          sx={{
            height: '40px',
            ...(opacity != null && { opacity }),
          }}
        >
          <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Skeleton 
                variant="rectangular" 
                width={20} 
                height={20} 
                animation="wave"
              />
              <Skeleton 
                variant="text" 
                width="40%" 
                height={16} 
                animation="wave"
              />
            </Box>
          </TableCell>
          <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Skeleton 
              variant="text" 
              width={60} 
              height={16} 
              animation="wave"
            />
          </TableCell>
          <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Skeleton 
              variant="text" 
              width={50} 
              height={16} 
              animation="wave"
              sx={{ ml: 'auto' }} 
            />
          </TableCell>
          <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Skeleton 
              variant="text" 
              width={80} 
              height={16} 
              animation="wave"
            />
          </TableCell>
          <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider', width: 48, px: 0.5 }} />
        </TableRow>
        );
      })}
    </>
  );
};

/**
 * File tree skeleton loader
 * Matches the layout of folder tree items: expand icon + folder icon + text
 * Supports level-based indentation for nested folders
 */
export const FileTreeSkeleton = ({ count = 3, level = 0 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => {
        const opacity = getSkeletonOpacity(index, count);
        return (
        <Box
          key={index}
          sx={{
            display: 'flex',
            alignItems: 'center',
            py: 0.5,
            pl: level * 2,
            minHeight: 32,
            ...(opacity != null && { opacity }),
          }}
        >
          {/* Expand icon placeholder */}
          <Box sx={{ minWidth: 24, mr: 0.5, display: 'flex', justifyContent: 'center' }}>
            <Skeleton 
              variant="circular" 
              width={20} 
              height={20} 
              animation="wave"
            />
          </Box>
          {/* Folder icon placeholder */}
          <Box sx={{ minWidth: 24, mr: 0.5 }}>
            <Skeleton 
              variant="rectangular" 
              width={20} 
              height={20} 
              animation="wave"
              sx={{ borderRadius: 0.5 }}
            />
          </Box>
          {/* Folder name placeholder */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton 
              variant="text" 
              width="60%" 
              height={20} 
              animation="wave"
            />
          </Box>
        </Box>
        );
      })}
    </>
  );
};
