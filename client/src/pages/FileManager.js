import React, { useState, useRef } from 'react';
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
import { useExplorerDragAndDrop } from '../hooks/useExplorerDragAndDrop';
import { uploadMultipleFiles } from '../services/fileService';
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
import { moveFile, checkPermission } from '../services/fileService';

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  
  const {
    currentPath,
    setCurrentPath,
    sortedFiles,
    loading,
    sortMode,
    setSortMode,
    webdavUrl,
    loadFiles,
    hasWritePermission,
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

  const [viewMode, setViewMode] = useState(VIEW_MODES.LIST);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
  const [processingMap, setProcessingMap] = useState(new Map());

  // Explorer drag and drop hook for the entire file content area
  const {
    isDraggingOver: isFileAreaDraggingOver,
    handleDragEnter: handleFileAreaDragEnter,
    handleDragOver: handleFileAreaDragOver,
    handleDragLeave: handleFileAreaDragLeave,
    handleDrop: handleFileAreaDrop,
  } = useExplorerDragAndDrop();

  const {
    folderPickerOpen,
    folderPickerAction,
    progressItems,
    updateProgress,
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
    setSelectionMode,
    {
      markProcessing: (paths, type) => {
        setProcessingMap(prev => {
          const next = new Map(prev);
          paths.forEach(p => next.set(p, type));
          return next;
        });
      },
      clearProcessing: (paths) => {
        setProcessingMap(prev => {
          const next = new Map(prev);
          paths.forEach(p => next.delete(p));
          return next;
        });
      },
    }
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePathClick = async (path) => {
    // 공유됨 뷰는 바로 설정
    if (path === '/__shared__') {
      setCurrentPath(path);
      return;
    }
    
    // 권한 체크
    if (!user?.is_admin) {
      try {
        const permission = await checkPermission(path);
        if (!permission.hasRead) {
          setDropMessage({
            show: true,
            text: '이 폴더에 대한 접근 권한이 없습니다.',
            type: 'error',
          });
          return;
        }
      } catch (error) {
        // 403 에러 등 권한 관련 에러 처리
        if (error.response?.status === 403) {
          setDropMessage({
            show: true,
            text: '이 폴더에 대한 접근 권한이 없습니다.',
            type: 'error',
          });
          return;
        }
        console.error('Failed to check permission:', error);
      }
    }
    
    setCurrentPath(path);
  };

  const handleFileClick = async (file) => {
    if (selectionMode) {
      toggleFileSelection(file);
    } else {
      if (file.type === 'directory') {
        // 권한이 없는 폴더는 클릭 불가
        if (file.hasReadPermission === false) {
          setDropMessage({
            show: true,
            text: '이 폴더에 대한 접근 권한이 없습니다.',
            type: 'error',
          });
          return;
        }
        
        // 권한 체크 (서버 측에서도 확인)
        if (!user?.is_admin) {
          try {
            const permission = await checkPermission(file.path);
            if (!permission.hasRead) {
              setDropMessage({
                show: true,
                text: '이 폴더에 대한 접근 권한이 없습니다.',
                type: 'error',
              });
              return;
            }
          } catch (error) {
            // 403 에러 등 권한 관련 에러 처리
            if (error.response?.status === 403) {
              setDropMessage({
                show: true,
                text: '이 폴더에 대한 접근 권한이 없습니다.',
                type: 'error',
              });
              return;
            }
            console.error('Failed to check permission:', error);
            // 에러가 발생해도 접근은 허용하지 않음
            setDropMessage({
              show: true,
              text: '권한 확인 중 오류가 발생했습니다.',
              type: 'error',
            });
            return;
          }
        }
        
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
    const srcPath = draggedFile.path;
    setProcessingMap(prev => {
      const next = new Map(prev);
      next.set(srcPath, 'move');
      return next;
    });
    const progressId = `move_drag_${Date.now()}`;
    
    try {
      if (draggedFile.path === targetFolder.path) {
        setProcessingMap(prev => {
          const next = new Map(prev);
          next.delete(srcPath);
          return next;
        });
        return;
      }

      const destPath = targetFolder.path.endsWith('/')
        ? targetFolder.path + draggedFile.basename
        : targetFolder.path + '/' + draggedFile.basename;

      updateProgress({
        id: progressId,
        type: 'move',
        status: 'preparing',
        progress: 0,
        total: 1,
        current: '',
        name: `${draggedFile.basename} 이동`,
      });

      updateProgress({
        id: progressId,
        type: 'move',
        status: 'processing',
        progress: 0,
        total: 1,
        current: '(0/1) 이동중...',
        name: `${draggedFile.basename} 이동`,
      });

      await moveFile(draggedFile.path, destPath);
      
      updateProgress({
        id: progressId,
        type: 'move',
        status: 'completed',
        progress: 1,
        total: 1,
        current: '(1/1) 이동중...',
        name: `${draggedFile.basename} 이동`,
      });
      
      loadFiles();

      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
        updateProgress({ id: progressId, remove: true });
        setProcessingMap(prev => {
          const next = new Map(prev);
          next.delete(srcPath);
          return next;
        });
      }, 3000);
    } catch (error) {
      console.error('Move failed:', error);
      updateProgress({
        id: progressId,
        type: 'move',
        status: 'error',
        error: error.response?.data?.error || '이동에 실패했습니다',
        name: `${draggedFile.basename} 이동`,
      });

      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        setProcessingMap(prev => {
          const next = new Map(prev);
          next.delete(srcPath);
          return next;
        });
      }, 5000);
    }
  };

  const handleExplorerDrop = async (filesToUpload, targetPath) => {
    // Use currentPath if targetPath is null
    const uploadPath = targetPath || currentPath;
    
    // Check permissions
    if (!hasWritePermission && !user?.is_admin) {
      setDropMessage({
        show: true,
        text: '업로드 권한이 없습니다',
        type: 'error',
      });
      return;
    }

    const progressId = `upload_drop_${Date.now()}`;
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: 0,
      total: filesToUpload.length,
      current: '준비 중...',
      name: `${filesToUpload.length}개 파일 업로드`,
    });

    try {
      const { results, errors } = await uploadMultipleFiles(
        filesToUpload,
        uploadPath,
        (progress) => {
          updateProgress({
            id: progressId,
            type: 'upload',
            status: progress.status === 'error' ? 'error' : 'processing',
            progress: progress.current,
            total: progress.total,
            current: `(${progress.current}/${progress.total}) ${progress.currentFile}`,
            name: `${filesToUpload.length}개 파일 업로드`,
            error: progress.error,
          });
        }
      );

      // Show completion status
      if (errors.length > 0) {
        updateProgress({
          id: progressId,
          type: 'upload',
          status: 'error',
          error: `${errors.length}개 파일 업로드 실패`,
          name: `${filesToUpload.length}개 파일 업로드`,
        });

        // Show error toast for first error
        const firstError = errors[0];
        let errorMessage = firstError.error;
        if (firstError.error.includes('Access denied') || firstError.error.includes('403')) {
          errorMessage = '업로드 권한이 없습니다';
        } else if (firstError.error.includes('already exists') || firstError.error.includes('409')) {
          errorMessage = '같은 이름의 파일이 이미 존재합니다';
        }
        
        setDropMessage({
          show: true,
          text: errorMessage,
          type: 'error',
        });
      } else {
        updateProgress({
          id: progressId,
          type: 'upload',
          status: 'completed',
          progress: results.length,
          total: results.length,
          current: '완료',
          name: `${filesToUpload.length}개 파일 업로드`,
        });

        setDropMessage({
          show: true,
          text: `${results.length}개 파일이 업로드되었습니다`,
          type: 'success',
        });
      }

      // Refresh file list and tree
      loadFiles();
      setTreeUpdateTrigger({
        type: 'refresh',
        timestamp: Date.now(),
      });

      // Clear progress after delay
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMessage = error.response?.data?.error || error.message || '업로드에 실패했습니다';
      if (error.response?.status === 403) {
        errorMessage = '업로드 권한이 없습니다';
      } else if (error.response?.status === 500) {
        errorMessage = `서버 오류: ${errorMessage}`;
      }
      
      updateProgress({
        id: progressId,
        type: 'upload',
        status: 'error',
        error: errorMessage,
        name: `${filesToUpload.length}개 파일 업로드`,
      });

      setDropMessage({
        show: true,
        text: errorMessage,
        type: 'error',
      });

      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 5000);
    }
  };

  // Handle drops on the entire file content area
  const handleContentAreaDragOver = (e) => {
    if (selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragOver(e);
    }
  };

  const handleContentAreaDragEnter = (e) => {
    if (selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragEnter(e);
    }
  };

  const handleContentAreaDragLeave = (e) => {
    if (selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragLeave(e);
    }
  };

  const handleContentAreaDrop = (e) => {
    if (selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDrop(e, currentPath, handleExplorerDrop);
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
          hasWritePermission={hasWritePermission}
          onExplorerDrop={handleExplorerDrop}
        />

        <Box 
          ref={fileContentRef}
          sx={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            position: 'relative',
          }}
          onDragEnter={handleContentAreaDragEnter}
          onDragOver={handleContentAreaDragOver}
          onDragLeave={handleContentAreaDragLeave}
          onDrop={handleContentAreaDrop}
        >
          {isFileAreaDraggingOver && hasWritePermission && (
            <Box
              sx={{
                position: 'absolute',
                top: 10,
                left: 10,
                right: 10,
                bottom: 10,
                border: '3px dashed',
                borderColor: 'primary.main',
                borderRadius: '10px',
                pointerEvents: 'none',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="h5"
                sx={{
                  color: 'primary.main',
                  fontWeight: 600,
                  textAlign: 'center',
                  px: 3,
                }}
              >
                파일을 여기에 놓으세요
              </Typography>
            </Box>
          )}
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
                processingMap={processingMap}
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
                hasWritePermission={hasWritePermission}
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={sortedFiles}
                processingMap={processingMap}
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
                hasWritePermission={hasWritePermission}
              />
            ) : (
              <FileDetail
                files={sortedFiles}
                processingMap={processingMap}
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
                hasWritePermission={hasWritePermission}
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
        hasWritePermission={hasWritePermission}
        onProgress={updateProgress}
        onProcessingStart={(paths, type) => {
          setProcessingMap(prev => {
            const next = new Map(prev);
            paths.forEach(p => next.set(p, type));
            return next;
          });
        }}
        onProcessingEnd={(paths) => {
          setProcessingMap(prev => {
            const next = new Map(prev);
            paths.forEach(p => next.delete(p));
            return next;
          });
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
        action={folderPickerAction}
        sourceFilePaths={folderPickerAction === 'copy' ? Array.from(selectedFiles) : undefined}
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
            disabled={!hasWritePermission}
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
            disabled={!hasWritePermission}
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
          updateProgress({ id, remove: true });
        }}
      />
    </Box>
  );
};

export default FileManager;
