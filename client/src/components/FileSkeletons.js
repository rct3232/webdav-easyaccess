import React from 'react';
import { Box, Skeleton, Grid, TableRow, TableCell } from '@mui/material';
import { useResponsive } from '../hooks/useResponsive';

/**
 * List view skeleton loader
 * Matches the layout of FileList items: icon (40x40) + text area + metadata
 */
export const FileListSkeleton = ({ count, selectionMode = false }) => {
  const { isMobile } = useResponsive();
  const skeletonCount = count || (isMobile ? 4 : 6);

  return (
    <>
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <Box
          key={index}
          sx={{
            display: 'flex',
            alignItems: 'center',
            p: 1.5,
            borderRadius: 1,
          }}
        >
          {selectionMode && (
            <Box sx={{ minWidth: 40, display: 'flex', alignItems: 'center', mr: 1 }}>
              <Skeleton 
                variant="rectangular" 
                width={24} 
                height={24} 
                animation="wave"
              />
            </Box>
          )}
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
      ))}
    </>
  );
};

/**
 * Grid view skeleton loader
 * Matches the layout of FileGrid cards: square image area + text
 */
export const FileGridSkeleton = ({ count, selectionMode = false }) => {
  const { isMobile } = useResponsive();
  const skeletonCount = count || (isMobile ? 4 : 8);

  return (
    <>
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <Grid item xs={6} sm={4} md={3} lg={2} xl={2} key={index}>
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 1,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
              position: 'relative',
            }}
          >
            {selectionMode && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  zIndex: 1,
                }}
              >
                <Skeleton 
                  variant="rectangular" 
                  width={24} 
                  height={24} 
                  animation="wave"
                />
              </Box>
            )}
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
        </Grid>
      ))}
    </>
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
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <TableRow 
          key={index} 
          sx={{ 
            height: '40px',
          }}
        >
          {selectionMode && (
            <TableCell padding="checkbox" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton 
                variant="rectangular" 
                width={20} 
                height={20} 
                animation="wave"
              />
            </TableCell>
          )}
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
        </TableRow>
      ))}
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
      {Array.from({ length: count }).map((_, index) => (
        <Box
          key={index}
          sx={{
            display: 'flex',
            alignItems: 'center',
            py: 0.5,
            pl: level * 2,
            minHeight: 32,
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
      ))}
    </>
  );
};
