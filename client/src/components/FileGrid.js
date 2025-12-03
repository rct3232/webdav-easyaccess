import React from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { formatFileSize } from '../utils/format';

const FileGrid = ({ files, onFileClick, onContextMenu }) => {
  const getThumbnail = (file) => {
    if (file.thumbnailUrl) {
      return file.thumbnailUrl;
    }
    return null;
  };

  const getFileIcon = (file) => {
    if (file.type === 'directory') {
      return <FolderIcon sx={{ fontSize: 64, color: 'primary.main' }} />;
    }
    return <FileIcon sx={{ fontSize: 64, color: 'text.secondary' }} />;
  };

  return (
    <Grid container spacing={2}>
      {files.map((file, index) => {
        const thumbnail = getThumbnail(file);
        
        return (
          <Grid item xs={6} sm={4} md={3} lg={2} key={index}>
            <Card
              sx={{
                cursor: 'pointer',
                '&:hover': {
                  boxShadow: 4,
                },
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
              onClick={() => onFileClick(file)}
              onContextMenu={(e) => onContextMenu(e, file)}
            >
              <Box
                sx={{
                  height: 150,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'grey.100',
                  position: 'relative',
                }}
              >
                {thumbnail ? (
                  <CardMedia
                    component="img"
                    height="150"
                    image={thumbnail}
                    alt={file.basename}
                    sx={{ objectFit: 'contain' }}
                  />
                ) : (
                  getFileIcon(file)
                )}
              </Box>
              <CardContent sx={{ flexGrow: 1, p: 1.5 }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={file.basename}
                  sx={{ fontWeight: 'medium' }}
                >
                  {file.basename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {file.type === 'directory' ? '폴더' : formatFileSize(file.size)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
      {files.length === 0 && (
        <Grid item xs={12}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">파일이 없습니다</Typography>
          </Box>
        </Grid>
      )}
    </Grid>
  );
};

export default FileGrid;

