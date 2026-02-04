import React from 'react';
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
  Folder as FolderIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  AccessTime as AccessTimeIcon,
} from '@mui/icons-material';
import { getFileIcon } from '../utils/fileIconUtils';

const RecentFilesSection = ({
  recentExpanded,
  handleRecentToggle,
  handleRecentClick,
  currentPath,
  recentFilesList,
  onPathClick,
  onFileClick,
}) => {
  return (
    <>
      {/* 최근 항목 섹션 - 항상 표시 */}
      <ListItem
        disablePadding
        sx={{
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <ListItemButton
          onClick={handleRecentClick}
          selected={currentPath === '/__recent__'}
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
              onClick={handleRecentToggle}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                width: 20,
                height: 20,
                justifyContent: 'center',
              }}
            >
              {recentExpanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </Box>
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <AccessTimeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: currentPath === '/__recent__' ? 700 : 400,
                }}
              >
                최근 항목
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      <Collapse in={recentExpanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {recentFilesList.length === 0 ? (
            <ListItem disablePadding>
              <Box sx={{ pl: 3, py: 1 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    fontSize: '0.875rem',
                  }}
                >
                  최근 항목이 없습니다
                </Typography>
              </Box>
            </ListItem>
          ) : (
            recentFilesList.slice(0, 10).map((recentFile) => (
              <ListItem key={recentFile.path} disablePadding>
                <ListItemButton
                  onClick={() => {
                    if (recentFile.type === 'directory') {
                      onPathClick(recentFile.path);
                    } else {
                      if (onFileClick) {
                        onFileClick({
                          ...recentFile,
                          basename: recentFile.name,
                          isRecentFile: true,
                        });
                      } else {
                        const parentPath = recentFile.path.substring(0, recentFile.path.lastIndexOf('/')) || '/';
                        onPathClick(parentPath);
                      }
                    }
                  }}
                  sx={{
                    pl: 3,
                    py: 0.5,
                    minHeight: 32,
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 24, mr: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {recentFile.type === 'directory' ? (
                      <FolderIcon fontSize="small" />
                    ) : (
                      <Box sx={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getFileIcon({ type: 'file', basename: recentFile.name })}
                      </Box>
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '0.875rem',
                        }}
                      >
                        {recentFile.name}
                      </Typography>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </Collapse>
    </>
  );
};

export default RecentFilesSection;
