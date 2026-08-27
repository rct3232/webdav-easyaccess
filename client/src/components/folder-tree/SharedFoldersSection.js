import React from 'react';
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
  Share as ShareIcon,
} from '@mui/icons-material';
import BaseFolderTreeItem from './BaseFolderTreeItem';

const SharedFoldersSection = ({
  sharedFolders,
  sharedExpanded,
  handleSharedToggle,
  handleSharedClick,
  currentNodeId,
  buildSharedFolderTree,
  onNodeClick,
  expandedNodeIds,
  onToggleExpand,
  user,
  treeUpdateTrigger,
  onExplorerDrop,
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedNodeId,
  isMobile,
}) => {
  const { t } = useTranslation();
  if (user?.is_admin || sharedFolders.length === 0) return null;

  const sharedTree = buildSharedFolderTree();
  const sharedFoldersMap = new Map(sharedFolders.map(perm => [perm.nodeId, perm]));

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
          onClick={handleSharedClick}
          selected={currentNodeId == null}
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
              onClick={handleSharedToggle}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                width: 20,
                height: 20,
                justifyContent: 'center',
              }}
            >
              {sharedExpanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </Box>
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: currentNodeId == null ? 700 : 400,
                }}
              >
                {t('nav.shared')}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      <Collapse in={sharedExpanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {sharedTree.map((node) => (
            <BaseFolderTreeItem
              key={node.nodeId}
              node={node}
              level={1}
              currentNodeId={currentNodeId}
              onNodeClick={onNodeClick}
              expandedNodeIds={expandedNodeIds}
              onToggleExpand={onToggleExpand}
              user={user}
              treeUpdateTrigger={treeUpdateTrigger}
              sharedFoldersMap={sharedFoldersMap}
              onExplorerDrop={onExplorerDrop}
              onInternalFileDrop={onInternalFileDrop}
              onInternalDragStart={onInternalDragStart}
              onInternalDragEnd={onInternalDragEnd}
              internalDraggedNodeId={internalDraggedNodeId}
              isMobile={isMobile}
              useHiddenFilesFilter={false}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
};

export default SharedFoldersSection;
