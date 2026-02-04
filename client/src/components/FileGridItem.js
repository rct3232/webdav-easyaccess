import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  Checkbox,
  CircularProgress,
} from '@mui/material';
import { renderProcessingIcon } from '../utils/fileViewUtils';
import { getFileIconForGrid, getThumbnail } from '../utils/fileIconUtils';

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

const checkboxStyles = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 1,
  backgroundColor: 'rgba(255, 255, 255, 0.9)',
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
  isMobile,
  onCheck,
}) => {
  const thumbnail = getThumbnail(file);

  // 동적 카드 스타일
  const cardStyles = {
    cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
    '&:hover': {
      boxShadow: isDisabled ? 2 : 4,
    },
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (file.isHidden ? 0.5 : 1)),
    border: isDropTarget ? '2px solid' : isSelected ? '2px solid' : 'none',
    borderColor: 'primary.main',
    backgroundColor: isSelected ? 'action.selected' : 'transparent',
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

  // 카드 컨텐츠 스타일
  const cardContentStyles = {
    p: 1,
    pt: 0.5,
    pb: 1,
    ...(isDropTarget && {
      backgroundColor: 'primary.main',
    }),
  };

  // 텍스트 스타일
  const textStyles = {
    fontWeight: 'medium',
    fontSize: '0.875rem',
    textAlign: 'center',
    color: isDropTarget ? 'white' : 'inherit',
  };

  return (
    <Card sx={cardStyles}>
      {selectionMode && (
        <Checkbox
          checked={isSelected}
          onChange={(e) => onCheck(file, e.target.checked, e)}
          onClick={(e) => e.stopPropagation()}
          sx={checkboxStyles}
        />
      )}
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
    prevProps.isMobile === nextProps.isMobile &&
    prevProps.file.path === nextProps.file.path &&
    prevProps.file.thumbnailUrl === nextProps.file.thumbnailUrl &&
    prevProps.file.basename === nextProps.file.basename &&
    prevProps.file.isHidden === nextProps.file.isHidden
  );
});

FileGridItem.displayName = 'FileGridItem';

export default FileGridItem;
