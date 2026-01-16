import React, { useState } from 'react';
import {
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  DriveFileMove as MoveIcon,
  Share as ShareIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { moveFile, copyFile } from '../services/fileService';
import FolderPickerDialog from './FolderPickerDialog';
import ShareDialog from './ShareDialog';
import SharedFolderManageDialog from './SharedFolderManageDialog';
import ConfirmDialog from './ConfirmDialog';
import { useFileOperations } from '../hooks/useFileOperations';

const FileContextMenu = ({ contextMenu, onClose, file, onActionComplete, user, currentPath, onMessage, onProgress, hasWritePermission, onProcessingStart, onProcessingEnd }) => {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharedFolderManageDialogOpen, setSharedFolderManageDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Use file operations hook - must be called before conditional return
  const {
    handleFileDownload,
    handleFileOperation: handleFileOp,
    handleFileRename,
    handleFileDelete,
  } = useFileOperations({
    onProgress,
    onMessage,
    onProcessingStart,
    onProcessingEnd,
    onActionComplete,
    onClose,
  });

  // 공유 버튼 표시 조건: 디렉토리이고, 사용자 디렉토리 하위에 있는 경우
  const canShare = file?.type === 'directory' && user && !user.is_admin && file.path.startsWith(`/${user.username}/`);
  
  // 공유받은 폴더인지 확인: 디렉토리이고, 사용자 디렉토리 하위가 아닌 경우
  const isSharedFolder = file?.type === 'directory' && user && !user.is_admin && !file.path.startsWith(`/${user.username}/`);

  if (!file) return null;

  const handleDownload = () => {
    handleFileDownload(file);
  };

  const handleDelete = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    setDeleteDialogOpen(false);
    try {
      await handleFileDelete(file);
    } catch (error) {
      const errorMsg = error?.response?.data?.error || error?.message || '삭제에 실패했습니다';
      setErrorMessage(errorMsg);
      setErrorDialogOpen(true);
    }
  };

  const handleRename = async () => {
    if (!newName.trim()) {
      return;
    }
    setLoading(true);
    try {
      await handleFileRename(file, newName);
      setRenameDialogOpen(false);
      setNewName('');
    } catch (error) {
      // Error is already handled by useFileOperations
    } finally {
      setLoading(false);
    }
  };

  const handleMove = (selectedPath) => {
    handleFileOp(file, selectedPath, moveFile, '이동', '이동').then(() => {
      setMoveDialogOpen(false);
    });
  };

  const handleCopy = (selectedPath) => {
    handleFileOp(file, selectedPath, copyFile, '복사', '복사').then(() => {
      setCopyDialogOpen(false);
    });
  };

  return (
    <>
      <Menu
        open={contextMenu !== null}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleDownload}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>다운로드</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setNewName(file.basename);
            setRenameDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>이름 변경</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoveDialogOpen(true);
          }}
          disabled={!hasWritePermission}
        >
          <ListItemIcon>
            <MoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>이동</ListItemText>
        </MenuItem>
        {file.type !== 'directory' && (
          <MenuItem
            onClick={() => {
              setCopyDialogOpen(true);
            }}
          >
            <ListItemIcon>
              <CopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>복사</ListItemText>
          </MenuItem>
        )}
        {canShare && (
          <MenuItem
            onClick={() => {
              setShareDialogOpen(true);
            }}
          >
            <ListItemIcon>
              <ShareIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>공유</ListItemText>
          </MenuItem>
        )}
        {isSharedFolder && (
          <MenuItem
            onClick={() => {
              setSharedFolderManageDialogOpen(true);
            }}
          >
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>공유 관리</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete} disabled={!hasWritePermission}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>삭제</ListItemText>
        </MenuItem>
      </Menu>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)}>
        <DialogTitle>이름 변경</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="새 이름"
            fullWidth
            variant="outlined"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !loading) {
                handleRename();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button onClick={handleRename} variant="contained" disabled={loading}>
            변경
          </Button>
        </DialogActions>
      </Dialog>

      <FolderPickerDialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        onSelect={handleMove}
        title={`이동: ${file?.basename}`}
        currentPath={currentPath}
        user={user}
        action="move"
        sourceFilePath={file?.path}
      />

      <FolderPickerDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        onSelect={handleCopy}
        title={`복사: ${file?.basename}`}
        currentPath={currentPath}
        user={user}
        action="copy"
        sourceFilePath={file?.path}
      />

      <ShareDialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        folderPath={file?.path}
        folderName={file?.basename || file?.name}
        user={user}
        onMessage={onMessage}
      />

      <SharedFolderManageDialog
        open={sharedFolderManageDialogOpen}
        onClose={() => setSharedFolderManageDialogOpen(false)}
        folderPath={file?.path}
        folderName={file?.basename || file?.name}
        user={user}
        onMessage={onMessage}
        onActionComplete={onActionComplete}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="삭제 확인"
        message={`정말로 "${file.basename}"을(를) 삭제하시겠습니까?`}
        confirmText="삭제"
        cancelText="취소"
        confirmColor="error"
      />

      <Dialog open={errorDialogOpen} onClose={() => setErrorDialogOpen(false)}>
        <DialogTitle>삭제 실패</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: 'pre-line', mt: 2 }}>
            {errorMessage}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setErrorDialogOpen(false)} variant="contained" color="primary">
            확인
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FileContextMenu;

