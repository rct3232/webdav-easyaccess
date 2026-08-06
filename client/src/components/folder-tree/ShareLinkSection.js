import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
import folderTreeGateway from '../../services/folderTreeGateway';
import BaseFolderTreeItem from './BaseFolderTreeItem';

/**
 * 공유 링크를 __shared__ / __recent__ 처럼 FolderTree 안의 한 섹션으로 표시
 * (nodeId-first; share root is always addressed by nodeId in Phase 5)
 */
const ShareLinkSection = ({
  shareRootNodeId,
  shareRootName,
  shareToken,
  currentNodeId,
  onNodeClick,
  isMobile = false,
}) => {
  const { t } = useTranslation();
  const rootNodeId = shareRootNodeId ?? null;
  const [shareLinkExpanded, setShareLinkExpanded] = useState(true);
  const [expandedNodeIds, setExpandedNodeIds] = useState(new Set());
  const [rootChildren, setRootChildren] = useState([]);
  const [loadingRoot, setLoadingRoot] = useState(false);

  const handleToggleExpand = useCallback((nodeId) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // currentNodeId가 공유 루트 이하일 때 섹션 확장 유지 (부모 노드 자동 확장은 Phase 5).
  useEffect(() => {
    if (rootNodeId == null || currentNodeId == null) return undefined;
    setShareLinkExpanded(true);
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      next.add(rootNodeId);
      return next;
    });
    return undefined;
  }, [rootNodeId, currentNodeId]);

  useEffect(() => {
    if (!shareLinkExpanded || !shareToken) return undefined;
    let cancelled = false;
    setLoadingRoot(true);
    folderTreeGateway.listFolderChildren({
      nodeId: rootNodeId ?? undefined,
      listFilesOptions: { shareToken },
      useHiddenFilesFilter: true,
    })
      .then((data) => {
        if (cancelled) return;
        setRootChildren(data || []);
      })
      .catch(() => {
        if (!cancelled) setRootChildren([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareLinkExpanded, rootNodeId, shareToken]);

  if (shareRootNodeId == null && !shareToken) return null;

  const isSelected = currentNodeId != null && rootNodeId != null && currentNodeId === rootNodeId;

  const handleHeaderClick = () => {
    setShareLinkExpanded((prev) => !prev);
    if (rootNodeId != null) {
      onNodeClick(rootNodeId);
    }
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
                {shareRootName || t('nav.shareLink')}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      <Collapse in={shareLinkExpanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {loadingRoot ? null : rootChildren.map((child) => (
            <BaseFolderTreeItem
              key={child.nodeId != null ? child.nodeId : child.path}
              node={child}
              path={child.path}
              name={child.name}
              level={1}
              currentNodeId={currentNodeId}
              onNodeClick={onNodeClick}
              expandedNodeIds={expandedNodeIds}
              onToggleExpand={handleToggleExpand}
              hasReadPermission={child.hasReadPermission !== false}
              hasWritePermission={false}
              onExplorerDrop={undefined}
              isMobile={isMobile}
              listFilesOptions={{ shareToken }}
              useHiddenFilesFilter={true}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
};

export default ShareLinkSection;
