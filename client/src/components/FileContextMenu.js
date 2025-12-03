import React, { useState } from 'react';
import {
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
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
} from '@mui/icons-material';
import {
  downloadFile,
  deleteFile,
  renameFile,
  moveFile,
  copyFile,
} from '../services/fileService';

const FileContextMenu = ({ contextMenu, onClose, file, onActionComplete }) => {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [loading, setLoading] = useState(false);

  if (!file) return null;

  const handleDownload = async () => {
    try {
      await downloadFile(file.path);
      onClose();
    } catch (error) {
      console.error('Download failed:', error);
      alert('다운로드에 실패했습니다');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`정말로 "${file.basename}"을(를) 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await deleteFile(file.path);
      onActionComplete();
      onClose();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('삭제에 실패했습니다');
    }
  };

  const handleRename = async () => {
    if (!newName.trim()) {
      alert('이름을 입력하세요');
      return;
    }

    setLoading(true);
    try {
      await renameFile(file.path, newName);
      setRenameDialogOpen(false);
      setNewName('');
      onActionComplete();
      onClose();
    } catch (error) {
      console.error('Rename failed:', error);
      alert('이름 변경에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleMove = async () => {
    if (!destinationPath.trim()) {
      alert('대상 경로를 입력하세요');
      return;
    }

    setLoading(true);
    try {
      const destPath = destinationPath.endsWith('/')
        ? destinationPath + file.basename
        : destinationPath + '/' + file.basename;
      
      await moveFile(file.path, destPath);
      setMoveDialogOpen(false);
      setDestinationPath('');
      onActionComplete();
      onClose();
    } catch (error) {
      console.error('Move failed:', error);
      alert('이동에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!destinationPath.trim()) {
      alert('대상 경로를 입력하세요');
      return;
    }

    setLoading(true);
    try {
      const destPath = destinationPath.endsWith('/')
        ? destinationPath + file.basename
        : destinationPath + '/' + file.basename;
      
      await copyFile(file.path, destPath);
      setCopyDialogOpen(false);
      setDestinationPath('');
      onActionComplete();
      onClose();
    } catch (error) {
      console.error('Copy failed:', error);
      alert('복사에 실패했습니다');
    } finally {
      setLoading(false);
    }
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
        {file.type !== 'directory' && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>다운로드</ListItemText>
          </MenuItem>
        )}
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
        <MenuItem onClick={handleDelete}>
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

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onClose={() => setMoveDialogOpen(false)}>
        <DialogTitle>이동</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="대상 경로"
            fullWidth
            variant="outlined"
            value={destinationPath}
            onChange={(e) => setDestinationPath(e.target.value)}
            placeholder="/ 또는 /folder/path"
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !loading) {
                handleMove();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button onClick={handleMove} variant="contained" disabled={loading}>
            이동
          </Button>
        </DialogActions>
      </Dialog>

      {/* Copy Dialog */}
      <Dialog open={copyDialogOpen} onClose={() => setCopyDialogOpen(false)}>
        <DialogTitle>복사</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="대상 경로"
            fullWidth
            variant="outlined"
            value={destinationPath}
            onChange={(e) => setDestinationPath(e.target.value)}
            placeholder="/ 또는 /folder/path"
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !loading) {
                handleCopy();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyDialogOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button onClick={handleCopy} variant="contained" disabled={loading}>
            복사
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FileContextMenu;

