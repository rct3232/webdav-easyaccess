import React, { useState } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Snackbar,
  Alert,
  Menu,
  Radio,
  RadioGroup,
  FormControlLabel,
  Divider,
  Paper,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  ViewStream as ViewStreamIcon,
  Person as PersonIcon,
  AdminPanelSettings as AdminIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Sort as SortIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { VIEW_MODES, SORT_MODES } from '../constants/fileManager';
import { canPreview } from '../utils/fileUtils';
import { useFileManager } from '../hooks/useFileManager';
import { useSelection } from '../hooks/useSelection';
import { useBulkOperations } from '../hooks/useBulkOperations';
import FileList from '../components/FileList';
import FileGrid from '../components/FileGrid';
import FileDetail from '../components/FileDetail';
import UploadDialog from '../components/UploadDialog';
import CreateFolderDialog from '../components/CreateFolderDialog';
import FileContextMenu from '../components/FileContextMenu';
import FilePreviewDialog from '../components/FilePreviewDialog';
import DownloadProgress from '../components/DownloadProgress';
import FolderTree from '../components/FolderTree';
import FolderPickerDialog from '../components/FolderPickerDialog';
import { moveFile } from '../services/fileService';

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const {
    currentPath,
    setCurrentPath,
    sortedFiles,
    loading,
    sortMode,
    setSortMode,
    webdavUrl,
    loadFiles,
  } = useFileManager(user);

  const {
    selectionMode,
    selectedFiles,
    handleToggleSelectionMode,
    handleSelectAll,
    handleDeselectAll,
    handleFileCheck,
    toggleFileSelection,
    setSelectionMode,
    setSelectedFiles,
  } = useSelection(sortedFiles);

  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);

  const {
    folderPickerOpen,
    folderPickerAction,
    progressItems,
    setProgressItems,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDelete,
    handleBulkDownload,
    handleFolderPickerSelect,
    setFolderPickerOpen,
    setFolderPickerAction,
  } = useBulkOperations(
    selectedFiles,
    sortedFiles,
    loadFiles,
    setTreeUpdateTrigger,
    setDropMessage,
    setSelectedFiles,
    setSelectionMode
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePathClick = (path) => {
    setCurrentPath(path);
  };

  const handleFileClick = (file) => {
    if (selectionMode) {
      toggleFileSelection(file);
    } else {
      if (file.type === 'directory') {
        setCurrentPath(file.path);
      } else {
        const filename = file.basename || file.name;
        const canPreviewFile = canPreview(filename);
        setSelectedFile({ ...file, name: filename, canPreview: canPreviewFile });
        setPreviewDialogOpen(true);
      }
    }
  };

  const handleRefresh = (deletedFilePath) => {
    if (deletedFilePath) {
      setTreeUpdateTrigger({
        type: 'deleted',
        folderPath: deletedFilePath,
        timestamp: Date.now(),
      });
    }
    
    loadFiles();
    
    if (deletedFilePath) {
      setTimeout(() => {
        setTreeUpdateTrigger({
          type: 'refresh',
          timestamp: Date.now(),
        });
      }, 500);
    }
  };

  const handleUploadComplete = () => {
    loadFiles();
    setUploadDialogOpen(false);
  };

  const handleCreateFolderComplete = (folderPath, folderName) => {
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/')) || (user?.is_admin ? '/' : `/${user?.username || ''}`);
    setTreeUpdateTrigger({
      type: 'created',
      folderPath,
      folderName,
      parentPath,
      timestamp: Date.now(),
    });
    
    loadFiles();
    setCreateFolderDialogOpen(false);
    
    setTimeout(() => {
      setTreeUpdateTrigger({
        type: 'refresh',
        timestamp: Date.now(),
      });
    }, 500);
  };

  const handleFileDrop = async (draggedFile, targetFolder) => {
    try {
      if (draggedFile.path === targetFolder.path) {
        return;
      }

      const destPath = targetFolder.path.endsWith('/')
        ? targetFolder.path + draggedFile.basename
        : targetFolder.path + '/' + draggedFile.basename;

      await moveFile(draggedFile.path, destPath);
      
      setDropMessage({
        show: true,
        text: `${draggedFile.basename}을(를) ${targetFolder.basename}(으)로 이동했습니다`,
        type: 'success'
      });

      loadFiles();

      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 3000);
    } catch (error) {
      console.error('Move failed:', error);
      const errorMsg = error.response?.data?.error || '이동에 실패했습니다';
      setDropMessage({
        show: true,
        text: errorMsg,
        type: 'error'
      });

      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 5000);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" elevation={4}>
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" component="div">
              WebDAV EasyAccess
            </Typography>
            {webdavUrl && (
              <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.7rem' }}>
                {webdavUrl}
              </Typography>
            )}
          </Box>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {user?.username}
          </Typography>
          {user?.is_admin && (
            <IconButton color="inherit" onClick={() => navigate('/admin')} title="관리자 대시보드">
              <AdminIcon />
            </IconButton>
          )}
          <IconButton color="inherit" onClick={() => navigate('/mypage')} title="마이페이지">
            <PersonIcon />
          </IconButton>
          <IconButton color="inherit" onClick={handleLogout} title="로그아웃">
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <FolderTree
          currentPath={currentPath}
          onPathClick={handlePathClick}
          user={user}
          treeUpdateTrigger={treeUpdateTrigger}
          onCreateFolder={() => setCreateFolderDialogOpen(true)}
          onUploadFile={() => setUploadDialogOpen(true)}
          selectionMode={selectionMode}
        />

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <IconButton
              onClick={(e) => setSortMenuAnchor(e.currentTarget)}
              title="정렬"
            >
              <SortIcon />
            </IconButton>

            <IconButton
              color={selectionMode ? 'primary' : 'default'}
              onClick={handleToggleSelectionMode}
              title={selectionMode ? '선택 모드' : '선택'}
              sx={{
                backgroundColor: selectionMode ? 'primary.main' : 'transparent',
                color: selectionMode ? 'primary.contrastText' : 'inherit',
                '&:hover': {
                  backgroundColor: selectionMode ? 'primary.dark' : 'action.hover',
                },
              }}
            >
              {selectionMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
            </IconButton>

            {selectionMode && (
              <>
                <Button
                  size="small"
                  startIcon={<SelectAllIcon />}
                  onClick={handleSelectAll}
                >
                  모두 선택
                </Button>
                <Button
                  size="small"
                  startIcon={<DeselectIcon />}
                  onClick={handleDeselectAll}
                >
                  모두 해제
                </Button>
                <Typography variant="body2" sx={{ ml: 1 }}>
                  {selectedFiles.size}개 선택됨
                </Typography>
              </>
            )}

            <Box sx={{ flexGrow: 1 }} />
            <Menu
              anchorEl={sortMenuAnchor}
              open={Boolean(sortMenuAnchor)}
              onClose={() => setSortMenuAnchor(null)}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
              }}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  이름
                </Typography>
                <RadioGroup
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value);
                    setSortMenuAnchor(null);
                  }}
                >
                  <FormControlLabel
                    value={SORT_MODES.NAME_ASC}
                    control={<Radio size="small" />}
                    label="오름차순"
                  />
                  <FormControlLabel
                    value={SORT_MODES.NAME_DESC}
                    control={<Radio size="small" />}
                    label="내림차순"
                  />
                </RadioGroup>
              </Box>
              <Divider />
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  수정 날짜
                </Typography>
                <RadioGroup
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value);
                    setSortMenuAnchor(null);
                  }}
                >
                  <FormControlLabel
                    value={SORT_MODES.DATE_ASC}
                    control={<Radio size="small" />}
                    label="오름차순"
                  />
                  <FormControlLabel
                    value={SORT_MODES.DATE_DESC}
                    control={<Radio size="small" />}
                    label="내림차순"
                  />
                </RadioGroup>
              </Box>
            </Menu>
          
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                color={viewMode === VIEW_MODES.LIST ? 'primary' : 'default'}
                onClick={() => setViewMode(VIEW_MODES.LIST)}
              >
                <ViewStreamIcon />
              </IconButton>
              <IconButton
                color={viewMode === VIEW_MODES.GRID ? 'primary' : 'default'}
                onClick={() => setViewMode(VIEW_MODES.GRID)}
              >
                <ViewModuleIcon />
              </IconButton>
              <IconButton
                color={viewMode === VIEW_MODES.DETAIL ? 'primary' : 'default'}
                onClick={() => setViewMode(VIEW_MODES.DETAIL)}
              >
                <ViewListIcon />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography>로딩 중...</Typography>
              </Box>
            ) : viewMode === VIEW_MODES.LIST ? (
              <FileList
                files={sortedFiles}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  e.preventDefault();
                  setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                  setSelectedFile(file);
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={sortedFiles}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  e.preventDefault();
                  setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                  setSelectedFile(file);
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
              />
            ) : (
              <FileDetail
                files={sortedFiles}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  e.preventDefault();
                  setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                  setSelectedFile(file);
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
              />
            )}
          </Box>
        </Box>
      </Box>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onComplete={handleUploadComplete}
        currentPath={currentPath}
      />

      <CreateFolderDialog
        open={createFolderDialogOpen}
        onClose={() => setCreateFolderDialogOpen(false)}
        onComplete={handleCreateFolderComplete}
        currentPath={currentPath}
        onMessage={setDropMessage}
      />

      <FilePreviewDialog
        open={previewDialogOpen}
        onClose={() => {
          setPreviewDialogOpen(false);
          setSelectedFile(null);
        }}
        file={selectedFile}
      />

      <FileContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        file={selectedFile}
        onActionComplete={handleRefresh}
        user={user}
        currentPath={currentPath}
        onMessage={setDropMessage}
        onProgress={(progressItem) => {
          if (progressItem.remove) {
            setProgressItems(prev => prev.filter(item => item.id !== progressItem.id));
          } else {
            setProgressItems(prev => {
              const existing = prev.find(item => item.id === progressItem.id);
              if (existing) {
                return prev.map(item => item.id === progressItem.id ? progressItem : item);
              } else {
                return [...prev, progressItem];
              }
            });
          }
        }}
      />

      <FolderPickerDialog
        open={folderPickerOpen}
        onClose={() => {
          setFolderPickerOpen(false);
          setFolderPickerAction(null);
        }}
        onSelect={handleFolderPickerSelect}
        title={folderPickerAction === 'move' ? '이동할 폴더 선택' : '복사할 폴더 선택'}
        currentPath={currentPath}
        user={user}
      />

      <Snackbar
        open={dropMessage.show}
        autoHideDuration={dropMessage.type === 'error' ? 5000 : 3000}
        onClose={() => setDropMessage({ show: false, text: '', type: 'success' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setDropMessage({ show: false, text: '', type: 'success' })} 
          severity={dropMessage.type}
          sx={{ width: '100%' }}
        >
          {dropMessage.text}
        </Alert>
      </Snackbar>

      {selectionMode && selectedFiles.size > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            p: 1.5,
            borderRadius: 3,
            zIndex: 1000,
            backgroundColor: 'background.paper',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          <Typography variant="body2" sx={{ mr: 1, fontWeight: 500, minWidth: '60px' }}>
            {selectedFiles.size}개 선택됨
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={handleBulkMove}
            sx={{ minWidth: 'auto', px: 1.5 }}
            title="이동"
          >
            <MoveIcon />
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleBulkCopy}
            sx={{ minWidth: 'auto', px: 1.5 }}
            title="복사"
          >
            <CopyIcon />
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleBulkDownload}
            sx={{ minWidth: 'auto', px: 1.5 }}
            title="다운로드"
          >
            <DownloadIcon />
          </Button>
          <Button
            variant="contained"
            color="error"
            size="small"
            onClick={handleBulkDelete}
            sx={{ minWidth: 'auto', px: 1.5 }}
            title="삭제"
          >
            <DeleteIcon />
          </Button>
        </Paper>
      )}

      <DownloadProgress
        items={progressItems}
        onClose={(id) => {
          setProgressItems(prev => prev.filter(item => item.id !== id));
        }}
      />
    </Box>
  );
};

export default FileManager;
