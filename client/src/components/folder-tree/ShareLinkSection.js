import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Typography,
} from '@mui/material';
import {
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { normalizePath } from '../../utils/pathUtils';
import { listFiles } from '../../services/fileService';
import { getShowHiddenFiles } from '../../utils/localStorage';
import BaseFolderTreeItem from './BaseFolderTreeItem';

/**
 * 공유 링크를 __shared__ / __recent__ 처럼 FolderTree 안의 한 섹션으로 표시
 */
const ShareLinkSection = ({
  shareRootPath,
  shareRootName,
  shareToken,
  currentPath,
  onShareLinkPathClick,
  isMobile = false,
}) => {
  const rootPath = normalizePath(shareRootPath || '/');
  const [shareLinkExpanded, setShareLinkExpanded] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [rootChildren, setRootChildren] = useState([]);
  const [loadingRoot, setLoadingRoot] = useState(false);

  const handleToggleExpand = useCallback((path) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // currentPath가 공유 루트 이하일 때 해당 부모들 확장
  useEffect(() => {
    if (!currentPath || !rootPath || !currentPath.startsWith(rootPath)) return;
    const normRoot = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
    const suffix = currentPath === normRoot ? '' : currentPath.slice(normRoot.length + 1);
    const pathParts = suffix ? suffix.split('/').filter(Boolean) : [];
    const pathsToExpand = new Set([rootPath]);
    let built = normRoot;
    pathParts.forEach((part) => {
      built = built === '/' ? `/${part}` : `${built}/${part}`;
      pathsToExpand.add(built);
    });
    setExpandedPaths(pathsToExpand);
    setShareLinkExpanded(true);
  }, [currentPath, rootPath]);

  useEffect(() => {
    if (!shareLinkExpanded || !rootPath || !shareToken) return;
    let cancelled = false;
    setLoadingRoot(true);
    listFiles(rootPath, { shareToken })
      .then((data) => {
        if (cancelled) return;
        const showHidden = getShowHiddenFiles();
        const dirs = (data || [])
          .filter((item) => item.type === 'directory')
          .filter((item) => showHidden || !item.isHidden)
          .map((item) => ({
            path: item.path,
            name: item.basename || item.name,
            hasReadPermission: item.hasReadPermission,
            hasWritePermission: item.hasWritePermission,
            isHidden: item.isHidden,
          }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setRootChildren(dirs);
      })
      .catch(() => {
        if (!cancelled) setRootChildren([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoot(false);
      });
    return () => { cancelled = true; };
  }, [shareLinkExpanded, rootPath, shareToken]);

  if (!shareRootPath && !shareToken) return null;

  const listFilesOptions = shareToken ? { shareToken } : {};
  const isSelected = currentPath === rootPath || (currentPath && currentPath.startsWith(rootPath + (rootPath.endsWith('/') ? '' : '/')));

  const handleHeaderClick = () => {
    setShareLinkExpanded((prev) => !prev);
    onShareLinkPathClick(rootPath);
  };

  const handleHeaderToggle = (e) => {
    e.stopPropagation();
    setShareLinkExpanded((prev) => !prev);
  };

  return (
    <>
      <ListItem
        disablePadding
        sx={{
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <ListItemButton
          onClick={handleHeaderClick}
          selected={isSelected}
          sx={{
            py: 0.5,
            minHeight: 32,
            pl: 0,
            transition: 'all 0.2s',
            '&.Mui-selected': {
              backgroundColor: 'transparent',
              color: 'primary.main',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'action.hover',
              },
              '& .MuiListItemIcon-root': {
                color: 'primary.main',
              },
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
            <Box
              component="span"
              onClick={handleHeaderToggle}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                width: 20,
                height: 20,
                justifyContent: 'center',
              }}
            >
              {shareLinkExpanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </Box>
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: isSelected ? 700 : 400,
                }}
              >
                {shareRootName || '공유 링크'}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      <Collapse in={shareLinkExpanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {loadingRoot ? null : rootChildren.map((child) => (
            <BaseFolderTreeItem
              key={child.path}
              path={child.path}
              name={child.name}
              level={1}
              currentPath={currentPath}
              onPathClick={onShareLinkPathClick}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              hasReadPermission={child.hasReadPermission !== false}
              hasWritePermission={false}
              onExplorerDrop={undefined}
              isMobile={isMobile}
              listFilesOptions={listFilesOptions}
              useHiddenFilesFilter={true}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
};

export default ShareLinkSection;
