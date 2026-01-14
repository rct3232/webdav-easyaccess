import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  Avatar,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import { formatFileSize, formatDate } from '../utils/format';
import { getFileIcon } from '../utils/fileIconUtils';
import { useResponsive } from '../hooks/useResponsive';

const FilePropertiesDialog = ({ open, onClose, file }) => {
  const { isMobile } = useResponsive();

  if (!file) return null;

  const isDirectory = file.type === 'directory';

  const properties = [
    {
      label: '이름',
      value: file.basename || file.name,
    },
    {
      label: '타입',
      value: isDirectory ? '폴더' : '파일',
    },
    ...(isDirectory
      ? []
      : [
          {
            label: '크기',
            value: formatFileSize(file.size),
          },
          {
            label: 'MIME 타입',
            value: file.mime || '-',
          },
        ]),
    {
      label: '수정 날짜',
      value: formatDate(file.lastmod),
    },
    {
      label: '경로',
      value: file.path || '-',
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>속성</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3, mt: 2 }}>
          <Avatar
            variant="rounded"
            sx={{
              width: 64,
              height: 64,
              bgcolor: 'primary.main',
              mb: 2,
              '& svg': {
                color: 'white',
                fontSize: 36,
              },
            }}
          >
            {getFileIcon(file)}
          </Avatar>
          <Typography variant="h6" sx={{ textAlign: 'center', wordBreak: 'break-word' }}>
            {file.basename || file.name}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <List>
          {properties.map((prop, index) => (
            <React.Fragment key={prop.label}>
              <ListItem sx={{ px: 0 }}>
                <ListItemText
                  primary={prop.label}
                  secondary={
                    <Typography
                      variant="body2"
                      sx={{
                        wordBreak: 'break-word',
                        color: 'text.primary',
                      }}
                    >
                      {prop.value}
                    </Typography>
                  }
                />
              </ListItem>
              {index < properties.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilePropertiesDialog;

