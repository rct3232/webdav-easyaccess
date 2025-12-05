import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Breadcrumbs,
  Link,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Folder as FolderIcon,
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { listFiles, checkPermission } from '../services/fileService';

const FolderPickerDialog = ({ open, onClose, onSelect, title, currentPath, user, action, sourceFilePath, sourceFilePaths }) => {
  const [selectedPath, setSelectedPath] = useState(currentPath || '/');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasWritePermission, setHasWritePermission] = useState(true);

  useEffect(() => {
    if (open) {
      setSelectedPath(currentPath || '/');
      loadFolders(currentPath || '/');
      // 복사 또는 이동 작업일 때 쓰기 권한 확인
      if (action === 'copy' || action === 'move') {
        checkWritePermission(currentPath || '/');
      } else {
        setHasWritePermission(true);
      }
    }
  }, [open, currentPath, action]);

  const checkWritePermission = async (path) => {
    try {
      const permission = await checkPermission(path);
      setHasWritePermission(permission.hasWrite);
    } catch (error) {
      console.error('Failed to check permission:', error);
      // 에러 발생 시 기본값으로 관리자는 true, 일반 사용자는 자신의 폴더인지 확인
      if (user?.is_admin) {
        setHasWritePermission(true);
      } else {
        const userFolder = `/${user?.username || ''}`;
        setHasWritePermission(path.startsWith(userFolder));
      }
    }
  };

  const loadFolders = async (path) => {
    setLoading(true);
    try {
      const data = await listFiles(path);
      // Only show directories
      const directories = data.filter(item => item.type === 'directory');
      setFolders(directories);
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFolderClick = (folder) => {
    const newPath = folder.path;
    setSelectedPath(newPath);
    loadFolders(newPath);
    // 복사 또는 이동 작업일 때 쓰기 권한 확인
    if (action === 'copy' || action === 'move') {
      checkWritePermission(newPath);
    }
  };

  const handlePathClick = (path) => {
    setSelectedPath(path);
    loadFolders(path);
    // 복사 또는 이동 작업일 때 쓰기 권한 확인
    if (action === 'copy' || action === 'move') {
      checkWritePermission(path);
    }
  };

  const handleSelect = () => {
    onSelect(selectedPath);
    onClose();
  };

  // 복사 파일의 부모 디렉토리와 선택된 경로가 같은지 확인
  const isSameDirectory = (filePath, targetPath) => {
    if (!filePath || !targetPath) return false;
    
    // 파일 경로의 부모 디렉토리 구하기
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    
    // 경로 정규화 (끝의 슬래시 제거)
    const normalizedParent = parentDir === '/' ? '/' : parentDir.replace(/\/$/, '');
    const normalizedTarget = targetPath === '/' ? '/' : targetPath.replace(/\/$/, '');
    
    return normalizedParent === normalizedTarget;
  };

  // 복사 작업 시 출발 디렉토리와 타겟 디렉토리가 같은지 확인
  const isCopyToSameDirectory = () => {
    if (action !== 'copy') return false;
    
    // 단일 파일 복사
    if (sourceFilePath) {
      return isSameDirectory(sourceFilePath, selectedPath);
    }
    
    // 다중 파일 복사
    if (sourceFilePaths && sourceFilePaths.length > 0) {
      return sourceFilePaths.some(filePath => isSameDirectory(filePath, selectedPath));
    }
    
    return false;
  };

  // Build breadcrumbs
  const pathParts = selectedPath.split('/').filter(Boolean);
  const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
  const breadcrumbs = [
    { name: '홈', path: homePath },
    ...pathParts.map((part, index) => ({
      name: part,
      path: '/' + pathParts.slice(0, index + 1).join('/'),
    })),
  ].filter((crumb, index) => {
    // For non-admin users, filter out the username from breadcrumbs
    if (!user?.is_admin && index === 1 && crumb.name === user?.username) {
      return false;
    }
    return true;
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{title || '폴더 선택'}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            현재 선택된 경로:
          </Typography>
          <Breadcrumbs
            separator={<ChevronRightIcon fontSize="small" />}
            aria-label="breadcrumb"
            sx={{ 
              p: 1.5, 
              backgroundColor: 'grey.100', 
              borderRadius: 1,
              flexWrap: 'wrap',
            }}
          >
            {breadcrumbs.map((crumb, index) => (
              <Link
                key={index}
                component="button"
                variant="body2"
                onClick={() => handlePathClick(crumb.path)}
                sx={{ 
                  cursor: 'pointer', 
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  '&:hover': {
                    textDecoration: 'underline',
                  },
                }}
              >
                {index === 0 && <HomeIcon sx={{ mr: 0.5, fontSize: 18 }} />}
                {crumb.name || '홈'}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, minHeight: 300, maxHeight: 400, overflow: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <CircularProgress />
            </Box>
          ) : folders.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <Typography color="text.secondary">하위 폴더가 없습니다</Typography>
            </Box>
          ) : (
            <List>
              {folders.map((folder, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemButton onClick={() => handleFolderClick(folder)}>
                    <ListItemIcon>
                      <FolderIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText primary={folder.basename} />
                    <ChevronRightIcon color="action" />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button 
          onClick={handleSelect} 
          variant="contained" 
          color="primary"
          disabled={
            ((action === 'copy' || action === 'move') && !hasWritePermission) ||
            isCopyToSameDirectory()
          }
        >
          선택
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderPickerDialog;

