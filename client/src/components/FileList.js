import React from 'react';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';

const FileList = ({ files, onFileClick, onContextMenu }) => {
  const getFileIcon = (file) => {
    if (file.type === 'directory') {
      return <FolderIcon color="primary" />;
    }
    if (file.mime?.startsWith('image/')) {
      return <ImageIcon />;
    }
    if (file.mime?.startsWith('video/')) {
      return <VideoIcon />;
    }
    return <FileIcon />;
  };

  return (
    <List>
      {files.map((file, index) => (
        <ListItem
          key={index}
          button
          onClick={() => onFileClick(file)}
          onContextMenu={(e) => onContextMenu(e, file)}
          sx={{
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <ListItemIcon>{getFileIcon(file)}</ListItemIcon>
          <ListItemText
            primary={file.basename}
            secondary={
              <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {file.type === 'directory' ? '폴더' : formatFileSize(file.size)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(file.lastmod)}
                </Typography>
              </Box>
            }
          />
        </ListItem>
      ))}
      {files.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">파일이 없습니다</Typography>
        </Box>
      )}
    </List>
  );
};

export default FileList;

