import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { renderProcessingIcon } from '../../utils/fileViewUtils';
import { getFileIconForGrid, getThumbnail } from '../../utils/fileIconUtils';

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

const cardMediaStyles = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
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

const moreButtonOverlayStyles = {
  position: 'absolute',
  top: 4,
  right: 4,
  zIndex: 1,
};

/**
 * 파일 그리드 아이템 컴포넌트
 * React.memo로 감싸서 불필요한 리렌더링 방지
 */
const FileGridItem = React.memo(({
  file,
  isSelected,
  isDisabled,
  isProcessing,
  processingType,
  isDropTarget,
  isDragging,
  selectionMode,
  showMoreButton,
  onMoreClick,
  isMobile,
}) => {
  const thumbnail = getThumbnail(file);

  // 동적 카드 스타일
  const cardStyles = {
    minWidth: 0,
    cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
    '&:hover': {
      boxShadow: isDisabled ? 2 : 4,
      ...(!isDropTarget && isSelected && {
        backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.2),
      }),
    },
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (file.isHidden ? 0.5 : 1)),
    border: isDropTarget ? '2px solid' : 'none',
    borderColor: 'primary.main',
    backgroundColor: isDropTarget
      ? 'transparent'
      : (isSelected ? (theme) => alpha(theme.palette.primary.main, 0.12) : 'transparent'),
    transition: 'all 0.2s',
    position: 'relative',
    color: isDisabled ? 'text.disabled' : 'inherit',
    ...(isMobile && mobileStyles),
  };

  // 썸네일 컨테이너 스타일
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

  // 카드 컨텐츠 스타일 (파일명 중앙 정렬)
  // '&:last-child': { pb: 1 } overrides MUI CardContent default paddingBottom so it matches FileGridSkeleton
  const cardContentStyles = {
    p: 1,
    pt: 0.5,
    pb: 1,
    '&:last-child': { pb: 1 },
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 0,
    ...(isDropTarget && {
      backgroundColor: 'primary.main',
    }),
  };

  // 텍스트 스타일 (중앙 정렬, 말줄임 처리)
  const textStyles = {
    fontWeight: 'medium',
    fontSize: '0.875rem',
    textAlign: 'center',
    color: isDropTarget ? 'white' : 'inherit',
    width: '100%',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <Card sx={cardStyles}>
      <Box sx={thumbnailContainerStyles}>
        {thumbnail ? (
          <CardMedia
            component="img"
            image={thumbnail}
            alt={file.basename}
            sx={cardMediaStyles}
          />
        ) : (
          getFileIconForGrid(file)
        )}
        {showMoreButton && (
          <Box
            component="button"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoreClick?.(file, e);
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => {
              e.stopPropagation();
              if (e.cancelable) e.preventDefault();
              onMoreClick?.(file, e);
            }}
            sx={{
              ...moreButtonOverlayStyles,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0.5,
              minWidth: 44,
              minHeight: 44,
              border: 'none',
              borderRadius: '50%',
              background: 'transparent',
              cursor: 'pointer',
              color: isDropTarget ? 'white' : 'inherit',
              '&:hover': {
                backgroundColor: (theme) =>
                  alpha(theme.palette.background.paper, isDropTarget ? 0.3 : 0.5),
              },
            }}
            aria-label="More actions"
          >
            <MoreVertIcon fontSize="small" />
          </Box>
        )}
      </Box>
      <CardContent sx={cardContentStyles}>
        <Typography
          variant="body2"
          noWrap
          title={file.basename}
          sx={textStyles}
        >
          {file.basename}
        </Typography>
      </CardContent>
      {isProcessing && (
        <Box sx={processingOverlayStyles}>
          <CircularProgress size={18} thickness={5} />
          {renderProcessingIcon(processingType)}
        </Box>
      )}
    </Card>
  );
}, (prevProps, nextProps) => {
  // 커스텀 비교 함수 - 변경된 props만 비교
  return (
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isDisabled === nextProps.isDisabled &&
    prevProps.isProcessing === nextProps.isProcessing &&
    prevProps.processingType === nextProps.processingType &&
    prevProps.isDropTarget === nextProps.isDropTarget &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.showMoreButton === nextProps.showMoreButton &&
    prevProps.isMobile === nextProps.isMobile &&
    prevProps.file.path === nextProps.file.path &&
    prevProps.file.thumbnailUrl === nextProps.file.thumbnailUrl &&
    prevProps.file.basename === nextProps.file.basename &&
    prevProps.file.isHidden === nextProps.file.isHidden
  );
});

FileGridItem.displayName = 'FileGridItem';

export default FileGridItem;
