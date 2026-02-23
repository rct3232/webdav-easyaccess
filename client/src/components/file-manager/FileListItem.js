import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  Avatar,
  CircularProgress,
  IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../../utils/format';
import { renderProcessingIcon, getDropTargetStyles } from '../../utils/fileViewUtils';
import { getFileIcon, getThumbnail } from '../../utils/fileIconUtils';

/**
 * 정적 스타일 - 컴포넌트 외부에 정의하여 매 렌더링마다 재생성 방지
 */
const baseStyles = {
  display: 'flex',
  alignItems: 'center',
  p: 1.5,
  borderRadius: 1,
  transition: 'all 0.2s',
  position: 'relative',
};

const mobileStyles = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  MozUserSelect: 'none',
  msUserSelect: 'none',
  WebkitTouchCallout: 'none',
  touchAction: 'manipulation',
};

const thumbnailContainerStyles = {
  minWidth: 56,
  display: 'flex',
  justifyContent: 'center',
  mr: 2,
};

const avatarStyles = {
  width: 40,
  height: 40,
  bgcolor: 'grey.200',
};

const iconContainerStyles = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
};

const contentStyles = {
  flex: 1,
  minWidth: 0,
};

const metaContainerStyles = {
  display: 'flex',
  gap: 2,
  mt: 0.5,
};

const processingOverlayStyles = {
  position: 'absolute',
  top: '50%',
  right: 16,
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  pointerEvents: 'none',
};

/**
 * 파일 리스트 아이템 컴포넌트
 * React.memo로 감싸서 불필요한 리렌더링 방지
 */
const FileListItem = React.memo(({
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
  const { t } = useTranslation();
  const thumbnail = getThumbnail(file);

  return (
    <>
      <Box sx={thumbnailContainerStyles}>
        {thumbnail ? (
          <Avatar
            src={thumbnail}
            alt={file.basename}
            variant="rounded"
            sx={avatarStyles}
          />
        ) : (
          <Box sx={iconContainerStyles}>
            {getFileIcon(file)}
          </Box>
        )}
      </Box>
      <Box sx={contentStyles}>
        <Typography variant="body2" noWrap>
          {file.basename}
        </Typography>
        <Box sx={metaContainerStyles}>
          <Typography variant="caption" color="text.secondary">
            {file.type === 'directory' ? t('actions.folder') : formatFileSize(file.size)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(file.lastmod)}
          </Typography>
        </Box>
      </Box>
      {showMoreButton && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onMoreClick?.(file, e);
          }}
          sx={{ ml: 0.5, flexShrink: 0 }}
          aria-label="More actions"
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      )}
      {isProcessing && (
        <Box sx={processingOverlayStyles}>
          <CircularProgress size={18} thickness={5} />
          {renderProcessingIcon(processingType)}
        </Box>
      )}
    </>
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

FileListItem.displayName = 'FileListItem';

/**
 * 파일 리스트 아이템 외부 컨테이너 스타일 생성 함수
 * 이벤트 위임을 위해 컨테이너에서 사용
 */
export const getFileListItemContainerStyles = ({
  isDisabled,
  isDropTarget,
  isDragging,
  isHidden,
  isMobile,
  selectionMode,
  isSelected,
}) => ({
  ...baseStyles,
  '&:hover': {
    backgroundColor: isDisabled
      ? 'transparent'
      : (selectionMode && isSelected ? (theme) => alpha(theme.palette.primary.main, 0.2) : 'action.hover'),
  },
  backgroundColor: isDropTarget
    ? 'primary.main'
    : (selectionMode && isSelected
      ? (theme) => alpha(theme.palette.primary.main, 0.12)
      : 'transparent'),
  opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (isHidden ? 0.5 : 1)),
  cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
  color: isDisabled ? 'text.disabled' : (isDropTarget ? 'white' : 'inherit'),
  ...getDropTargetStyles(isDropTarget),
  ...(isMobile && mobileStyles),
});

export default FileListItem;
