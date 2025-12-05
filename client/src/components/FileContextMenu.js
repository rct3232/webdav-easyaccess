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
import {
  downloadFile,
  downloadMultipleFiles,
  deleteFile,
  renameFile,
  moveFile,
  copyFile,
} from '../services/fileService';
import FolderPickerDialog from './FolderPickerDialog';
import ShareDialog from './ShareDialog';
import SharedFolderManageDialog from './SharedFolderManageDialog';

const FileContextMenu = ({ contextMenu, onClose, file, onActionComplete, user, currentPath, onMessage, onProgress, hasWritePermission }) => {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharedFolderManageDialogOpen, setSharedFolderManageDialogOpen] = useState(false);

  // 공유 버튼 표시 조건: 디렉토리이고, 사용자 디렉토리 하위에 있는 경우
  const canShare = file?.type === 'directory' && user && !user.is_admin && file.path.startsWith(`/${user.username}/`);
  
  // 공유받은 폴더인지 확인: 디렉토리이고, 사용자 디렉토리 하위가 아닌 경우
  const isSharedFolder = file?.type === 'directory' && user && !user.is_admin && !file.path.startsWith(`/${user.username}/`);

  if (!file) return null;

  const handleDownload = async () => {
    try {
      if (file.type === 'directory') {
        const progressId = `download_${Date.now()}`;
        const progressItem = {
          id: progressId,
          type: 'download',
          status: 'preparing',
          progress: 0,
          total: 1,
          current: '',
          zipName: '',
        };
        
        if (onProgress) {
          onProgress(progressItem);
        }
        
        await downloadMultipleFiles([file.path], (progress) => {
          if (onProgress) {
            onProgress({ ...progress, id: progressId });
          }
        });
        
        if (onProgress) {
          setTimeout(() => {
            onProgress({ id: progressId, remove: true });
          }, 3000);
        }
      } else {
        await downloadFile(file.path);
      }
      onClose();
    } catch (error) {
      const errorMsg = error.response?.data?.error || '다운로드에 실패했습니다';
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      } else {
        alert(errorMsg);
      }
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`정말로 "${file.basename}"을(를) 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await deleteFile(file.path);
      onActionComplete(file.type === 'directory' ? file.path : null);
      onClose();
    } catch (error) {
      const errorMsg = error.response?.data?.error || '삭제에 실패했습니다';
      setErrorMessage(errorMsg);
      setErrorDialogOpen(true);
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
      
      if (onMessage) {
        onMessage({
          show: true,
          text: `"${file.basename}"을(를) "${newName}"(으)로 이름 변경했습니다`,
          type: 'success'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || '이름 변경에 실패했습니다';
      
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      } else {
        alert(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileOperation = async (selectedPath, operation, operationName, actionVerb) => {
    if (!selectedPath || !selectedPath.trim()) {
      alert('대상 경로를 선택하세요');
      return;
    }

    const destPath = selectedPath.endsWith('/')
      ? selectedPath + file.basename
      : selectedPath + '/' + file.basename;
    
    const progressId = `${operation}_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: operation,
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `${file.basename} ${operationName}`,
    };
    
    if (onProgress) {
      onProgress(progressItem);
    }

    setLoading(true);
    try {
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'processing',
          progress: 0,
          total: 1,
          current: `(0/1) ${actionVerb}중...`,
        });
      }
      
      await operation(file.path, destPath, (progress) => {
        if (onProgress) {
          onProgress({
            ...progressItem,
            status: progress.stage === 'completed' ? 'completed' : 'processing',
            progress: progress.stage === 'completed' ? 1 : 0,
            total: 1,
            current: progress.stage === 'completed' ? `(1/1) ${actionVerb}중...` : `(0/1) ${actionVerb}중...`,
          });
        }
      });
      
      if (operation === moveFile) {
        setMoveDialogOpen(false);
      } else {
        setCopyDialogOpen(false);
      }
      onActionComplete();
      onClose();
      
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'completed',
          progress: 0,
          total: 0,
          current: '완료',
        });
        
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 3000);
      }
      
      if (onMessage) {
        onMessage({
          show: true,
          text: `${file.basename}을(를) ${operationName}했습니다`,
          type: 'success'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || `${operationName}에 실패했습니다`;
      const isDuplicate = error.response?.status === 409 || errorMsg.includes('already exists');
      
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
        });
        
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 5000);
      }
      
      if (onMessage) {
        const displayMsg = isDuplicate ? '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' : errorMsg;
        onMessage({
          show: true,
          text: displayMsg,
          type: 'error'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      } else {
        alert(isDuplicate ? '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' : errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMove = (selectedPath) => {
    handleFileOperation(selectedPath, moveFile, '이동', '이동');
  };

  const handleCopy = (selectedPath) => {
    handleFileOperation(selectedPath, copyFile, '복사', '복사');
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

