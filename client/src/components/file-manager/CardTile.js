import React from 'react';
import { Card, CardContent, Box, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { renderProcessingIcon } from '../../utils/fileViewUtils';

/**
 * 정적 스타일 - 컴포넌트 외부에 정의하여 매 렌더링마다 재생성 방지
 */
const mobileStyles = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  MozUserSelect: 'none',
  msUserSelect: 'none',
  WebkitTouchCallout: 'none',
  touchAction: 'manipulation',
};

const thumbnailContainerBaseStyles = {
  width: '100%',
  aspectRatio: '1 / 1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  transition: 'all 0.2s',
  overflow: 'hidden',
};

const processingOverlayStyles = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  pointerEvents: 'none',
};

// 카드 컨텐츠 스타일 (파일명 중앙 정렬)
// '&:last-child': { pb: 1 } overrides MUI CardContent default paddingBottom so it matches FileGridSkeleton
const cardContentBaseStyles = {
  p: 1,
  pt: 0.5,
  pb: 1,
  '&:last-child': { pb: 1 },
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  minHeight: 0,
};

const cornerBadgesContainerStyles = {
  position: 'absolute',
  // 8px corner inset — same visual rhythm as the top-right processing overlay
  // (owner tweak 2026-10-01; was 4, which read as flush).
  top: 8,
  left: 8,
  zIndex: 1,
  display: 'flex',
  gap: 0.5,
};

/**
 * Shared card-tile shell (P-3 extraction from FileGridItem's JSX body).
 * Slots: media (square area), moreAction (absolute overlay inside the media box),
 * cornerBadges (absolute top-left overlay inside the media box — M-4 badge set,
 * `TileCornerBadge` atoms), optional content (between media and footer),
 * footer (CardContent).
 * Selection shows the light primary card background — no checkbox (files parity).
 * @see docs/spec/client/components/file-manager/CardTile.md
 */
const CardTile = ({
  media = null,
  moreAction = null,
  cornerBadges = null,
  content = null,
  footer = null,
  footerRef = null,
  isSelected = false,
  isDisabled = false,
  isProcessing = false,
  processingType = null,
  isDropTarget = false,
  isDragging = false,
  selectionMode = false,
  isMobile = false,
  isHidden = false,
  cursor = null,
}) => {
  const cardStyles = {
    minWidth: 0,
    cursor: cursor ?? (isDisabled ? 'not-allowed' : isMobile || selectionMode ? 'pointer' : 'move'),
    '&:hover': {
      boxShadow: isDisabled ? 2 : 4,
      ...(!isDropTarget &&
        isSelected && {
          backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.2),
        }),
    },
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    opacity: isDragging ? 0.5 : isDisabled ? 0.4 : isHidden ? 0.5 : 1,
    border: isDropTarget ? '2px solid' : 'none',
    borderColor: 'primary.main',
    backgroundColor: isDropTarget
      ? 'transparent'
      : isSelected
        ? (theme) => alpha(theme.palette.primary.main, 0.12)
        : 'transparent',
    transition: 'all 0.2s',
    position: 'relative',
    color: isDisabled ? 'text.disabled' : 'inherit',
    ...(isMobile && mobileStyles),
  };

  const thumbnailContainerStyles = {
    ...thumbnailContainerBaseStyles,
    backgroundColor: isDropTarget ? 'primary.main' : 'grey.100',
    ...(isDropTarget && {
      '& .MuiSvgIcon-root': {
        color: 'white',
      },
      '& img': {
        filter: 'brightness(0.7)',
      },
    }),
  };

  const cardContentStyles = {
    ...cardContentBaseStyles,
    ...(isDropTarget && {
      backgroundColor: 'primary.main',
    }),
  };

  return (
    <Card sx={cardStyles}>
      <Box sx={thumbnailContainerStyles}>
        {media}
        {moreAction}
        {cornerBadges != null && <Box sx={cornerBadgesContainerStyles}>{cornerBadges}</Box>}
      </Box>
      {content}
      <CardContent sx={cardContentStyles} ref={footerRef}>
        {footer}
      </CardContent>
      {isProcessing && (
        <Box sx={processingOverlayStyles}>
          <CircularProgress size={18} thickness={5} />
          {renderProcessingIcon(processingType)}
        </Box>
      )}
    </Card>
  );
};

export default CardTile;
