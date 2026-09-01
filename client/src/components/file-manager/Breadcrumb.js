import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, IconButton } from '@mui/material';
import {
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  Share as ShareIcon,
  AccessTime as AccessTimeIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';
import { normalizePath } from '../../utils/pathUtils';

/**
 * NodeId breadcrumb: renders the current folder's ancestor chain
 * (ancestors: [{ nodeId, name }] from the GET /files/list ancestors response) as chips.
 * Share mode keeps its path-segment behavior (C2.5 migrates share mode separately).
 */
const Breadcrumb = ({
  ancestors = [],
  onNodeClick,
  user,
  onToggleFolderTree,
  isFolderTreeOpen,
  shareRootPath,
  shareRootName,
  showFolderTreeToggle,
  currentPath = '',
}) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef(null);

  const isShareMode = Boolean(shareRootPath);
  const isRecentView = !isShareMode && currentPath === '/__recent__';
  const isSharedView = !isShareMode && currentPath === '/__shared__';

  // Share mode: keep the existing path-segment rendering (do not regress; C2.5).
  const shareSegments = (() => {
    if (!isShareMode) return [];
    const normRoot = normalizePath(shareRootPath);
    const normCurrent = normalizePath(currentPath);
    if (normCurrent === normRoot || !normCurrent.startsWith(normRoot)) {
      return [];
    }
    const suffix = normCurrent.slice(
      normRoot.endsWith('/') ? normRoot.length : normRoot.length + 1
    );
    if (!suffix) return [];
    const parts = suffix.split('/').filter(Boolean);
    const segments = [];
    let builtPath = normRoot.endsWith('/') ? normRoot.slice(0, -1) : normRoot;
    parts.forEach((part) => {
      builtPath = builtPath === '/' ? `/${part}` : `${builtPath}/${part}`;
      segments.push({ name: part, path: builtPath });
    });
    return segments;
  })();

  // Non-share: ancestor chain from the server-provided ancestors response (self last).
  const chainSegments = isShareMode
    ? []
    : (ancestors || []).map((a) => ({ nodeId: a.nodeId, name: a.name }));

  const segments = isShareMode ? shareSegments : chainSegments;

  let homeIcon;
  let homeLabel;
  let homeClickTarget;
  if (isRecentView) {
    homeIcon = <AccessTimeIcon />;
    homeLabel = t('nav.recentShort');
    homeClickTarget = '/__recent__';
  } else if (isShareMode) {
    homeIcon = <ShareIcon />;
    homeLabel =
      shareRootName ||
      normalizePath(shareRootPath).split('/').filter(Boolean).pop() ||
      t('nav.sharedFolder');
    homeClickTarget = normalizePath(shareRootPath);
  } else if (isSharedView) {
    homeIcon = <ShareIcon />;
    homeLabel = t('nav.shared');
    homeClickTarget = '/__shared__';
  } else {
    homeIcon = <HomeIcon />;
    homeLabel = user?.is_admin ? t('nav.all') : t('nav.home');
    homeClickTarget = user?.rootNodeId ?? null;
  }

  // Auto-scroll to the right when the location changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
  }, [currentPath, ancestors]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1,
        px: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        ref={scrollContainerRef}
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          flex: 1,
          // Hide scrollbar but keep functionality
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          scrollbarWidth: 'none',
          // Smooth scrolling
          scrollBehavior: 'smooth',
        }}
      >
        <Chip
          icon={homeIcon}
          label={homeLabel}
          onClick={() => onNodeClick(homeClickTarget)}
          clickable
          color={segments.length === 0 ? 'primary' : 'default'}
          sx={{
            minHeight: 44,
            fontSize: '0.875rem',
            fontWeight: segments.length === 0 ? 600 : 400,
            flexShrink: 0,
          }}
        />

        {segments.map((segment, index) => (
          <React.Fragment key={segment.nodeId != null ? segment.nodeId : segment.path}>
            <ChevronRightIcon sx={{ mx: 0.5, color: 'text.secondary', flexShrink: 0 }} />
            <Chip
              label={segment.name}
              onClick={() => onNodeClick(segment.nodeId != null ? segment.nodeId : segment.path)}
              clickable
              color={index === segments.length - 1 ? 'primary' : 'default'}
              sx={{
                minHeight: 44,
                fontSize: '0.875rem',
                fontWeight: index === segments.length - 1 ? 600 : 400,
                flexShrink: 0,
              }}
            />
          </React.Fragment>
        ))}
      </Box>

      {(!shareRootPath || showFolderTreeToggle) && onToggleFolderTree && (
        <IconButton
          data-testid="breadcrumb-folder-tree-toggle"
          onClick={onToggleFolderTree}
          sx={{
            ml: 1,
            flexShrink: 0,
            color: 'primary.main',
            minWidth: 44,
            minHeight: 44,
            transition: 'transform 0.2s',
          }}
          title={isFolderTreeOpen ? t('nav.folderTreeClose') : t('nav.folderTreeOpen')}
        >
          {isFolderTreeOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
        </IconButton>
      )}
    </Box>
  );
};

export default Breadcrumb;
