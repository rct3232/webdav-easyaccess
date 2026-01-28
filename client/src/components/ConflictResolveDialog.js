import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
} from '@mui/material';
import {
  Description as FileIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';

const ConflictResolveDialog = ({
  open,
  onClose,
  onResolve,
  conflicts = [],
  operationType = '이동', // '이동', '복사', '업로드'
}) => {
  const handleOverwrite = () => {
    onResolve('overwrite');
  };

  const handleSkip = () => {
    onResolve('skip');
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>중복 항목 처리</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          대상 경로에 동일한 이름의 파일이나 폴더가 이미 존재합니다. 어떻게 처리할까요?
        </DialogContentText>
        
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, maxHeight: 200, overflow: 'auto', p: 1 }}>
          <List dense>
            {conflicts.map((conflict, index) => (
              <ListItem key={index}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {conflict.type === 'directory' ? <FolderIcon color="primary" /> : <FileIcon color="action" />}
                </ListItemIcon>
                <ListItemText 
                  primary={conflict.path.split('/').pop()} 
                  secondary={conflict.path}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
                  secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
        
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          * '병합/덮어쓰기'를 선택하면 기존 항목이 대체됩니다.
          <br />
          * '건너뛰기'를 선택하면 중복된 항목을 제외하고 나머지 작업만 진행합니다.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleCancel} color="inherit">
          취소
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button 
          onClick={handleSkip} 
          variant="outlined" 
          color="primary"
        >
          중복 건너뛰기
        </Button>
        <Button
          onClick={handleOverwrite}
          variant="contained"
          color="primary"
        >
          병합/덮어쓰기
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConflictResolveDialog;
