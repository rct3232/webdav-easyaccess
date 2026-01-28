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
import ConflictResolveDialog from './ConflictResolveDialog';
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
    conflictData,
    resolveConflict,
    setConflictData,
  } = useFileOperations({
    onProgress,
    onProcessingStart,
    onProcessingEnd,
    onActionComplete,
    onClose,
  });

  // 공유 버튼 표시 조건: 
  // 1. 디렉토리이고, 사용자 디렉토리 하위에 있는 경우 (폴더 공유)
  // 2. 파일인 경우 (외부 공유 링크)
  const canShare = (
    (file?.type === 'directory' && user && !user.is_admin && file.path.startsWith(`/${user.username}/`)) ||
    (file?.type !== 'directory')
  );
  
  // 공유받은 폴더인지 확인: 디렉토리이고, 사용자 디렉토리 하위가 아닌 경우
  const isSharedFolder = file?.type === 'directory' && user && !user.is_admin && !file.path.startsWith(`/${user.username}/`);
  
  // Direct read permission missing on directory (disabled in list UI)
  const isPermissionDisabled = file?.type === 'directory' && file?.hasReadPermission === false;

  // Prefer per-item permission if available
  const fileWritePermission = file?.hasWritePermission !== undefined ? file.hasWritePermission : hasWritePermission;

  if (!file) return null;

  const closeMenu = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleDownload = () => {
    // Close immediately on click (desktop UX aligned with mobile ActionSheet)
    closeMenu();
    handleFileDownload(file);
  };

  const handleDelete = () => {
    // Close immediately, then show confirmation dialog
    closeMenu();
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    setDeleteDialogOpen(false);
    try {
      await handleFileDelete(file, { startedPath: currentPath });
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
      await handleFileRename(file, newName, { startedPath: currentPath });
      setRenameDialogOpen(false);
      setNewName('');
    } catch (error) {
      // Error is already handled by useFileOperations
    } finally {
      setLoading(false);
    }
  };

  const handleMove = (selectedPath) => {
    handleFileOp(file, selectedPath, moveFile, '이동', '이동', { startedPath: currentPath }).then(() => {
      setMoveDialogOpen(false);
    });
  };

  const handleCopy = (selectedPath) => {
    handleFileOp(file, selectedPath, copyFile, '복사', '복사', { startedPath: currentPath }).then(() => {
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
        {isPermissionDisabled ? (
          // Permission-less folders: allow only "공유 관리" to request access
          isSharedFolder && (
            <MenuItem
              onClick={() => {
                closeMenu();
                setSharedFolderManageDialogOpen(true);
              }}
            >
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>공유 관리</ListItemText>
            </MenuItem>
          )
        ) : (
          <>
        <MenuItem onClick={handleDownload}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>다운로드</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            setNewName(file.basename);
            setRenameDialogOpen(true);
          }}
          disabled={!fileWritePermission}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>이름 변경</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            setMoveDialogOpen(true);
          }}
          disabled={!fileWritePermission}
        >
          <ListItemIcon>
            <MoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>이동</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            setCopyDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>복사</ListItemText>
        </MenuItem>
        {canShare && (
          <MenuItem
            onClick={() => {
              closeMenu();
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
              closeMenu();
              setSharedFolderManageDialogOpen(true);
            }}
          >
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>공유 관리</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete} disabled={!fileWritePermission}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>삭제</ListItemText>
        </MenuItem>
          </>
        )}
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
        folderPath={file?.type === 'directory' ? file?.path : null}
        folderName={file?.type === 'directory' ? (file?.basename || file?.name) : null}
        user={user}
        onMessage={onMessage}
        enableExternalShare={file?.type !== 'directory'}
        filePath={file?.type !== 'directory' ? file?.path : null}
        fileName={file?.type !== 'directory' ? (file?.basename || file?.name) : null}
      />

      <SharedFolderManageDialog
        open={sharedFolderManageDialogOpen}
        onClose={() => setSharedFolderManageDialogOpen(false)}
        folderPath={file?.path}
        folderName={file?.basename || file?.name}
        directHasReadPermission={typeof file?.hasReadPermission === 'boolean' ? file.hasReadPermission : undefined}
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

      <ConflictResolveDialog
        open={!!conflictData}
        onClose={() => setConflictData(null)}
        onResolve={resolveConflict}
        conflicts={conflictData?.conflicts || []}
        operationType={conflictData?.operationName || '이동'}
      />
    </>
  );
};

export default FileContextMenu;

