import React from 'react';
import { CardMedia, Typography, Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { getFileIconForGrid, getThumbnail } from '../../utils/fileIconUtils';
import { pixelMiddleTruncate } from '../../utils/stringUtils';
import CardTile from './CardTile';

/**
 * 더 버튼 오버레이 스타일
 */
const moreButtonOverlayStyles = {
  position: 'absolute',
  top: 4,
  right: 4,
  zIndex: 1,
};

const cardMediaStyles = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

/**
 * 텍스트 스타일 (중앙 정렬, 말줄임 처리)
 */
const buildTextStyles = (isDropTarget) => ({
  fontWeight: 'medium',
  fontSize: '0.875rem',
  textAlign: 'center',
  color: isDropTarget ? 'white' : 'inherit',
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

/**
 * 파일 그리드 아이템 컴포넌트
 * React.memo로 감싸서 불필요한 리렌더링 방지
 * P-3: 카드 셸(Card/미디어/더 버튼/processing 오버레이)은 공용 `CardTile`로 위임 —
 * props·DOM·memo 비교 함수는 외부에서 볼 때 추출 전과 동일하다
 * (regression anchor: FileGridItem.test.js 무변경 통과).
 * @see docs/spec/client/components/file-manager/CardTile.md
 */
const FileGridItem = React.memo(
  ({
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
    const [containerWidth, setContainerWidth] = React.useState(150);
    const containerRef = React.useRef(null);

    React.useEffect(() => {
      if (!containerRef.current) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect) {
            setContainerWidth(entry.contentRect.width);
          }
        }
      });

      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, []);

    // Card padding: p:1(8px) * 2 = 16px.
    const maxPixelWidth = Math.max(40, containerWidth - 16);
    const font = '500 14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

    const media = thumbnail ? (
      <CardMedia component="img" image={thumbnail} alt={file.basename} sx={cardMediaStyles} />
    ) : (
      getFileIconForGrid(file)
    );

    const moreAction = showMoreButton ? (
      <Box
        component="button"
        type="button"
        data-testid={file.moreButtonTestId}
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
    ) : null;

    const footer = (() => {
      const originalName = file.basename;
      const truncatedName = pixelMiddleTruncate(originalName, maxPixelWidth, font);
      const isTruncated = truncatedName !== originalName;

      const typography = (
        <Typography variant="body2" sx={buildTextStyles(isDropTarget)}>
          {truncatedName}
        </Typography>
      );

      return isTruncated ? (
        <Tooltip title={originalName} disableInteractive>
          {typography}
        </Tooltip>
      ) : (
        typography
      );
    })();

    return (
      <CardTile
        media={media}
        moreAction={moreAction}
        footer={footer}
        footerRef={containerRef}
        isSelected={isSelected}
        isDisabled={isDisabled}
        isProcessing={isProcessing}
        processingType={processingType}
        isDropTarget={isDropTarget}
        isDragging={isDragging}
        selectionMode={selectionMode}
        isMobile={isMobile}
        isHidden={file.isHidden}
      />
    );
  },
  (prevProps, nextProps) => {
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
      prevProps.file.isHidden === nextProps.file.isHidden &&
      // P-4 member state flips re-render tiles whose name/path never change;
      // file rows carry all three as undefined (undefined-safe comparison).
      prevProps.file.published === nextProps.file.published &&
      prevProps.file.shared_excluded === nextProps.file.shared_excluded &&
      prevProps.file.state === nextProps.file.state &&
      prevProps.file.liked === nextProps.file.liked
    );
  }
);

FileGridItem.displayName = 'FileGridItem';

export default FileGridItem;
