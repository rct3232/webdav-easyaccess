import React from 'react';
import {
  SwipeableDrawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  Avatar,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Edit as EditIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Share as ShareIcon,
  Visibility as VisibilityIcon,
  Settings as SettingsIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { getFileIcon } from '../utils/fileIconUtils';

/**
 * Bottom sheet for file actions on mobile
 * Replaces context menu for touch-friendly interface
 */
const FileActionSheet = ({ 
  open, 
  onClose, 
  file, 
  onDownload,
  onRename,
  onMove,
  onCopy,
  onDelete,
  onShare,
  onPreview,
  onManageShared,
  onProperties,
  hasWritePermission = true,
  user,
}) => {
  if (!file) return null;

  const handleAction = (action) => {
    action();
    onClose();
  };

  const isDirectory = file.type === 'directory';
  const canPreview = file.canPreview;
  
  // 공유 버튼 표시 조건: 디렉토리이고, 사용자 디렉토리 하위에 있는 경우
  const canShare = isDirectory && user && !user.is_admin && file.path.startsWith(`/${user.username}/`);
  
  // 공유받은 폴더인지 확인: 디렉토리이고, 사용자 디렉토리 하위가 아닌 경우
  const isSharedFolder = isDirectory && user && !user.is_admin && !file.path.startsWith(`/${user.username}/`);

  // Direct read permission missing on directory (disabled in list UI)
  const isPermissionDisabled = isDirectory && file?.hasReadPermission === false;

  // 파일 객체에 hasWritePermission이 있으면 사용, 없으면 prop의 hasWritePermission 사용
  const fileWritePermission = file?.hasWritePermission !== undefined ? file.hasWritePermission : hasWritePermission;

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      sx={{
        '& .MuiDrawer-paper': {
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
      }}
    >
      <Box sx={{ py: 2, px: 3 }}>
        {/* File info header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar
            variant="rounded"
            sx={{
              width: 48,
              height: 48,
              mr: 2,
              bgcolor: 'primary.main',
              '& svg': {
                color: 'white',
                fontSize: 28,
              },
            }}
          >
            {getFileIcon(file)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {file.basename || file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isDirectory ? '폴더' : '파일'}
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 1 }} />

        {/* Actions */}
        <List sx={{ py: 0 }}>
          {isPermissionDisabled ? (
            // Permission-less folders: allow only "공유 관리" to request access
            isSharedFolder && onManageShared && (
              <ListItem 
                button 
                onClick={() => handleAction(onManageShared)}
                sx={{ minHeight: 56, borderRadius: 1 }}
              >
                <ListItemIcon>
                  <SettingsIcon />
                </ListItemIcon>
                <ListItemText primary="공유 관리" />
              </ListItem>
            )
          ) : (
            <>
          {canPreview && onPreview && (
            <ListItem 
              button 
              onClick={() => handleAction(onPreview)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <VisibilityIcon />
              </ListItemIcon>
              <ListItemText primary="미리보기" />
            </ListItem>
          )}

          {onProperties && (
            <ListItem 
              button 
              onClick={() => handleAction(onProperties)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <InfoIcon />
              </ListItemIcon>
              <ListItemText primary="속성" />
            </ListItem>
          )}

          {onDownload && (
            <ListItem 
              button 
              onClick={() => handleAction(onDownload)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <DownloadIcon />
              </ListItemIcon>
              <ListItemText primary="다운로드" />
            </ListItem>
          )}

          {fileWritePermission && onRename && (
            <ListItem 
              button 
              onClick={() => handleAction(onRename)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <EditIcon />
              </ListItemIcon>
              <ListItemText primary="이름 변경" />
            </ListItem>
          )}

          {fileWritePermission && onMove && (
            <ListItem 
              button 
              onClick={() => handleAction(onMove)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <MoveIcon />
              </ListItemIcon>
              <ListItemText primary="이동" />
            </ListItem>
          )}

          {onCopy && (
            <ListItem 
              button 
              onClick={() => handleAction(onCopy)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <CopyIcon />
              </ListItemIcon>
              <ListItemText primary="복사" />
            </ListItem>
          )}

          {canShare && onShare && (
            <ListItem 
              button 
              onClick={() => handleAction(onShare)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <ShareIcon />
              </ListItemIcon>
              <ListItemText primary="공유" />
            </ListItem>
          )}

          {isSharedFolder && onManageShared && (
            <ListItem 
              button 
              onClick={() => handleAction(onManageShared)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="공유 관리" />
            </ListItem>
          )}

          {fileWritePermission && onDelete && (
            <>
              <Divider sx={{ my: 1 }} />
              <ListItem 
                button 
                onClick={() => handleAction(onDelete)}
                sx={{ 
                  minHeight: 56, 
                  borderRadius: 1,
                  color: 'error.main',
                }}
              >
                <ListItemIcon sx={{ color: 'error.main' }}>
                  <DeleteIcon />
                </ListItemIcon>
                <ListItemText primary="삭제" />
              </ListItem>
            </>
          )}
            </>
          )}
        </List>
      </Box>
    </SwipeableDrawer>
  );
};

export default FileActionSheet;

