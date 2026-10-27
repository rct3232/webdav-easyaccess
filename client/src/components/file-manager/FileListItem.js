import React from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Box, Avatar, CircularProgress, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon, EditOff as EditOffIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../../utils/format';
import { renderProcessingIcon, getDropTargetStyles } from '../../utils/fileViewUtils';
import { getFileIcon, getThumbnail } from '../../utils/fileIconUtils';
import { pixelMiddleTruncate } from '../../utils/stringUtils';
import HighlightedName from './HighlightedName';
import MemberStateBadges from './MemberStateBadges';
import CollectionMembershipBadges, {
  hasCollectionMembershipBadges,
} from './CollectionMembershipBadges';

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
  position: 'relative',
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

/**
 * Read-only search-server-row badge (useSearchResults.md §2.3, FileListItem.md
 * §2.6): plain 16px `EditOff` overlaid on the leading icon column corner —
 * same overlay geometry family as the MemberStateBadges list variant.
 */
const searchReadOnlyBadgeStyles = {
  position: 'absolute',
  top: 2,
  left: 2,
  zIndex: 1,
  display: 'flex',
  gap: 0.5,
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
const FileListItem = React.memo(
  ({ file, isProcessing, processingType, showMoreButton, onMoreClick, memberships = null }) => {
    const { t } = useTranslation();
    const thumbnail = getThumbnail(file);
    // P-4 member-row slots (CollectionsListView §2.5): the member wire carries
    // no size, so the caption is suppressed; files never set the marker.
    const isSizelessMemberRow = file.isCollectionMember === true && file.size == null;
    // Search-server-row size suppression (useSearchResults.md §2.3,
    // FileListItem.md §2.6): un-enriched rows carry no size — same no-lie rule
    // as the member slot; directories keep the folder label.
    const isSizelessSearchRow =
      file.isSearchServerRow === true && file.size == null && file.type !== 'directory';
    const isReadOnlySearchRow =
      file.isSearchServerRow === true && file.hasWritePermission === false;
    const hasHighlights = Array.isArray(file.highlights) && file.highlights.length > 0;
    const [containerWidth, setContainerWidth] = React.useState(200);
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

    // Padding/Margins total: containerRef is on contentStyles which is flex:1.
    // It already excludes the thumbnail and more button.
    // We use 8px for a small safety margin.
    const maxPixelWidth = Math.max(40, containerWidth - 8);
    const font = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

    return (
      <>
        <Box sx={thumbnailContainerStyles}>
          {thumbnail ? (
            <Avatar src={thumbnail} alt={file.basename} variant="rounded" sx={avatarStyles} />
          ) : (
            <Box sx={iconContainerStyles}>{getFileIcon(file)}</Box>
          )}
          {/* P-4 member-state badges (§11 follow-up 3): overlay on the leading
              icon column; file rows (fields absent) render nothing here. */}
          <MemberStateBadges file={file} variant="list" />
          {isReadOnlySearchRow && (
            <Box
              sx={searchReadOnlyBadgeStyles}
              data-testid={`search-readonly-badge-${file.nodeId}`}
              aria-hidden="true"
            >
              <EditOffIcon style={{ fontSize: 16 }} />
            </Box>
          )}
          {/* Collection-membership badges (CollectionMembershipBadges.md):
              leading-column overlay; stacks below the read-only EditOff
              overlay (top 2 → 20) when both render. File rows without the
              prepared slice stay zero-DOM. */}
          {hasCollectionMembershipBadges(memberships) && (
            <CollectionMembershipBadges
              nodeId={file.nodeId}
              entries={memberships}
              variant="list"
              overlayTop={isReadOnlySearchRow ? 20 : 2}
            />
          )}
        </Box>
        <Box sx={contentStyles} ref={containerRef}>
          {(() => {
            const originalName = file.basename;
            const truncatedName = pixelMiddleTruncate(originalName, maxPixelWidth, font);
            const isTruncated = truncatedName !== originalName;

            const typography = (
              <Typography variant="body2" sx={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {hasHighlights ? (
                  <HighlightedName
                    name={originalName}
                    display={truncatedName}
                    highlights={file.highlights}
                  />
                ) : (
                  truncatedName
                )}
              </Typography>
            );

            return isTruncated ? (
              <Tooltip title={originalName} disableInteractive>
                {typography}
              </Tooltip>
            ) : (
              typography
            );
          })()}
          <Box sx={metaContainerStyles}>
            {!isSizelessMemberRow && !isSizelessSearchRow && (
              <Typography variant="caption" color="text.secondary">
                {file.type === 'directory' ? t('actions.folder') : formatFileSize(file.size)}
              </Typography>
            )}
            {/* Trash rows (DEF-16) carry no lastmod — the '-' placeholder would
                read like a deleted-date subtitle, so it is suppressed. */}
            {file.lastmod && (
              <Typography variant="caption" color="text.secondary">
                {formatDate(file.lastmod)}
              </Typography>
            )}
          </Box>
          {/* Member-state badges now render as a leading-column overlay (the
              §2.6 shared `MemberStateBadges`, variant="list") in all three
              member views — the former list-only Chip block is gone. */}
        </Box>
        {showMoreButton && (
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
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
              border: 'none',
              borderRadius: '50%',
              background: 'transparent',
              cursor: 'pointer',
              color: 'inherit',
            }}
            aria-label="More actions"
          >
            <MoreVertIcon fontSize="small" />
          </Box>
        )}
        {isProcessing && (
          <Box sx={processingOverlayStyles}>
            <CircularProgress size={18} thickness={5} />
            {renderProcessingIcon(processingType)}
          </Box>
        )}
      </>
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
      // P-4 member state flips (publish-all, exclusion) must re-render rows
      // whose name/path never change; file rows carry both as undefined.
      prevProps.file.published === nextProps.file.published &&
      prevProps.file.shared_excluded === nextProps.file.shared_excluded &&
      prevProps.file.state === nextProps.file.state &&
      prevProps.file.liked === nextProps.file.liked &&
      // Search-server-row slots (FileListItem.md §2.6): highlight/live-filter
      // changes, enrichment (size) and permission flips must re-render rows
      // whose name/path never change (known stale-row bug class, FileManager.js
      // memo comment). `highlights` rides identity — the adapters re-map rows
      // with fresh arrays on every change. Absent fields compare
      // `undefined === undefined` — plain file rows are unaffected.
      prevProps.file.highlights === nextProps.file.highlights &&
      prevProps.file.hasWritePermission === nextProps.file.hasWritePermission &&
      prevProps.file.hasReadPermission === nextProps.file.hasReadPermission &&
      prevProps.file.isSearchServerRow === nextProps.file.isSearchServerRow &&
      prevProps.file.size === nextProps.file.size &&
      // Membership chips ride the host-prepared slice — compared BY IDENTITY:
      // stable across renders while no membership re-read lands; a re-read
      // rebuilds the map wholesale (member-adapter remap class), so exactly
      // the notify cycles re-render the badged rows.
      prevProps.memberships === nextProps.memberships
    );
  }
);

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
      : selectionMode && isSelected
        ? (theme) => alpha(theme.palette.primary.main, 0.2)
        : 'action.hover',
  },
  backgroundColor: isDropTarget
    ? 'primary.main'
    : selectionMode && isSelected
      ? (theme) => alpha(theme.palette.primary.main, 0.12)
      : 'transparent',
  opacity: isDragging ? 0.5 : isDisabled ? 0.4 : isHidden ? 0.5 : 1,
  cursor: isDisabled ? 'not-allowed' : isMobile ? 'pointer' : selectionMode ? 'pointer' : 'move',
  color: isDisabled ? 'text.disabled' : isDropTarget ? 'white' : 'inherit',
  ...getDropTargetStyles(isDropTarget),
  ...(isMobile && mobileStyles),
});

export default FileListItem;
