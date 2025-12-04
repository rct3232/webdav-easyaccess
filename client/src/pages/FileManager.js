import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Breadcrumbs,
  Link,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  ViewAgenda as ViewAgendaIcon,
  Upload as UploadIcon,
  Folder as FolderIcon,
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
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import FileList from '../components/FileList';
import FileGrid from '../components/FileGrid';
import FileDetail from '../components/FileDetail';
import UploadDialog from '../components/UploadDialog';
import CreateFolderDialog from '../components/CreateFolderDialog';
import FileContextMenu from '../components/FileContextMenu';
import FilePreviewDialog from '../components/FilePreviewDialog';
import DownloadProgress from '../components/DownloadProgress';
import { listFiles, moveFile, copyFile, deleteFile, downloadMultipleFiles, getWebDAVInfo } from '../services/fileService';
import FolderPickerDialog from '../components/FolderPickerDialog';

const VIEW_MODES = {
  LIST: 'list',
  GRID: 'grid',
  DETAIL: 'detail',
};

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPath, setCurrentPath] = useState(() => {
    // Set initial path based on user role
    return user?.is_admin ? '/' : `/${user?.username || ''}`;
  });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  const [webdavUrl, setWebdavUrl] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null); // 'move' or 'copy'
  const [progressItems, setProgressItems] = useState([]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles(currentPath);
      setFiles(data);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    // Update path when user changes
    if (user && !user.is_admin) {
      const userFolder = `/${user.username}`;
      if (currentPath === '/' || !currentPath.startsWith(userFolder)) {
        setCurrentPath(userFolder);
      }
    }
  }, [user, currentPath]);

  useEffect(() => {
    if (currentPath) {
      loadFiles();
    }
  }, [currentPath, loadFiles]);

  useEffect(() => {
    // Load WebDAV URL for display
    const loadWebDAVUrl = async () => {
      try {
        const info = await getWebDAVInfo();
        setWebdavUrl(info.url || '');
      } catch (error) {
        console.error('Failed to load WebDAV URL:', error);
      }
    };
    loadWebDAVUrl();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePathClick = (path) => {
    setCurrentPath(path);
  };

  const handleFileClick = (file) => {
    if (selectionMode) {
      // Toggle selection
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(file.path)) {
          newSet.delete(file.path);
        } else {
          newSet.add(file.path);
        }
        return newSet;
      });
    } else {
      // Normal click behavior
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

  const handleToggleSelectionMode = () => {
    setSelectionMode(prev => !prev);
    setSelectedFiles(new Set()); // Clear selection when toggling
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(files.map(file => file.path)));
  };

  const handleDeselectAll = () => {
    setSelectedFiles(new Set());
  };

  const handleFileCheck = (file, checked) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(file.path);
      } else {
        newSet.delete(file.path);
      }
      return newSet;
    });
  };

  const handleBulkMove = () => {
    setFolderPickerAction('move');
    setFolderPickerOpen(true);
  };

  const handleBulkCopy = () => {
    setFolderPickerAction('copy');
    setFolderPickerOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) return;
    
    const confirmMessage = `선택한 ${selectedFiles.size}개의 파일/폴더를 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    const filePaths = Array.from(selectedFiles);
    let successCount = 0;
    let failCount = 0;

    for (const filePath of filePaths) {
      try {
        await deleteFile(filePath);
        successCount++;
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      setDropMessage({
        show: true,
        text: `${successCount}개 파일/폴더가 삭제되었습니다${failCount > 0 ? ` (${failCount}개 실패)` : ''}`,
        type: failCount > 0 ? 'warning' : 'success',
      });
      setSelectedFiles(new Set());
      setSelectionMode(false); // 선택 모드 해제
      loadFiles();
    } else {
      setDropMessage({
        show: true,
        text: '삭제에 실패했습니다',
        type: 'error',
      });
    }
  };

  const handleBulkDownload = async () => {
    if (selectedFiles.size === 0) return;

    const filePaths = Array.from(selectedFiles);
    
    // Create progress item
    const progressId = `download_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'download',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      zipName: '',
    };
    
    setProgressItems(prev => [...prev, progressItem]);

    try {
      await downloadMultipleFiles(filePaths, (progress) => {
        setProgressItems(prev => 
          prev.map(item => item.id === progressId ? { ...progress, id: progressId } : item)
        );
      });
      
      setSelectedFiles(new Set());
      setSelectionMode(false); // 선택 모드 해제
      
      // Update to completed after a delay
      setTimeout(() => {
        setProgressItems(prev => prev.filter(item => item.id !== progressId));
      }, 3000);
    } catch (error) {
      console.error('Bulk download error:', error);
      setProgressItems(prev => 
        prev.map(item => 
          item.id === progressId 
            ? { ...item, status: 'error', error: error.message }
            : item
        )
      );
    }
  };

  const handleFolderPickerSelect = async (destinationPath) => {
    if (!folderPickerAction || selectedFiles.size === 0) return;

    const filePaths = Array.from(selectedFiles);
    
    // Create progress item
    const progressId = `${folderPickerAction}_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: folderPickerAction,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 ${folderPickerAction === 'move' ? '이동' : '복사'}`,
    };
    
    setProgressItems(prev => [...prev, progressItem]);

    let successCount = 0;
    let failCount = 0;
    const skippedFiles = []; // 중복 파일 목록

    for (let i = 0; i < filePaths.length; i++) {
      const sourcePath = filePaths[i];
      try {
        const fileName = sourcePath.split('/').pop();
        const destinationFilePath = destinationPath === '/' 
          ? `/${fileName}` 
          : `${destinationPath}/${fileName}`;

        // Update progress before starting
        const actionText = folderPickerAction === 'move' ? '이동중' : '복사중';
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? currentItem.progress || 0 : 0;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) ${actionText}...`,
                }
              : item
          );
        });

        if (folderPickerAction === 'move') {
          await moveFile(sourcePath, destinationFilePath);
        } else if (folderPickerAction === 'copy') {
          await copyFile(sourcePath, destinationFilePath);
        }
        
        successCount++;
        
        // Update progress after completion
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? (currentItem.progress || 0) + 1 : 1;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) ${actionText}...`,
                }
              : item
          );
        });
      } catch (error) {
        console.error(`Failed to ${folderPickerAction} ${sourcePath}:`, error);
        const errorMsg = error.response?.data?.error || error.message;
        const fileName = sourcePath.split('/').pop();
        
        // 중복 파일 에러인 경우 건너뛰기
        if (error.response?.status === 409 || errorMsg.includes('already exists')) {
          skippedFiles.push(fileName);
        } else {
          failCount++;
        }
      }
    }

    // Update to completed
    const actionText = folderPickerAction === 'move' ? '이동중' : '복사중';
    setProgressItems(prev => 
      prev.map(item => 
        item.id === progressId 
          ? { 
              ...item, 
              status: failCount > 0 ? 'error' : 'completed',
              progress: successCount,
              total: filePaths.length,
              current: failCount > 0 ? `(${successCount}/${filePaths.length}) ${actionText}... (${failCount}개 실패)` : `(${successCount}/${filePaths.length}) ${actionText}...`,
              error: failCount > 0 ? `${failCount}개 실패` : undefined,
            }
          : item
      )
    );

    if (successCount > 0) {
      let message = `${successCount}개 파일/폴더가 ${folderPickerAction === 'move' ? '이동' : '복사'}되었습니다`;
      if (skippedFiles.length > 0) {
        message += `\n건너뛴 파일: ${skippedFiles.join(', ')}`;
      }
      if (failCount > 0) {
        message += `\n실패: ${failCount}개`;
      }
      
      setDropMessage({
        show: true,
        text: message,
        type: failCount > 0 || skippedFiles.length > 0 ? 'warning' : 'success',
      });
      setSelectedFiles(new Set());
      setSelectionMode(false); // 선택 모드 해제
      loadFiles();
    } else {
      let message = `${folderPickerAction === 'move' ? '이동' : '복사'}에 실패했습니다`;
      if (skippedFiles.length > 0) {
        message += `\n건너뛴 파일: ${skippedFiles.join(', ')}`;
      }
      
      setDropMessage({
        show: true,
        text: message,
        type: 'error',
      });
    }

    // Remove progress item after delay
    setTimeout(() => {
      setProgressItems(prev => prev.filter(item => item.id !== progressId));
    }, 3000);

    setFolderPickerOpen(false);
    setFolderPickerAction(null);
  };

  const canPreview = (filename) => {
    if (!filename || typeof filename !== 'string') {
      return false;
    }
    
    const parts = filename.split('.');
    if (parts.length < 2) {
      return false; // No extension
    }
    
    const ext = parts.pop().toLowerCase();
    const previewableExts = [
      // Images
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',
      // Videos
      'mp4', 'webm', 'ogg', 'mov',
      // Audio
      'mp3', 'wav', 'ogg', 'aac', 'm4a',
      // Documents
      'pdf',
      // Text
      'txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'java', 'c', 'cpp', 'h', 'sh'
    ];
    return previewableExts.includes(ext);
  };

  const handleRefresh = () => {
    loadFiles();
  };

  const handleUploadComplete = () => {
    loadFiles();
    setUploadDialogOpen(false);
  };

  const handleCreateFolderComplete = () => {
    loadFiles();
    setCreateFolderDialogOpen(false);
  };

  const handleFileDrop = async (draggedFile, targetFolder) => {
    try {
      // Check if user is trying to move a file into itself or its parent
      if (draggedFile.path === targetFolder.path) {
        return;
      }

      // Construct destination path
      const destPath = targetFolder.path.endsWith('/')
        ? targetFolder.path + draggedFile.basename
        : targetFolder.path + '/' + draggedFile.basename;

      // Perform the move
      await moveFile(draggedFile.path, destPath);
      
      // Show success message
      setDropMessage({
        show: true,
        text: `${draggedFile.basename}을(를) ${targetFolder.basename}(으)로 이동했습니다`,
        type: 'success'
      });

      // Reload files
      loadFiles();

      // Hide message after 3 seconds
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

      // Hide message after 5 seconds
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 5000);
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
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

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 2, alignItems: 'center' }}>
          <Breadcrumbs aria-label="breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <Link
                key={index}
                component="button"
                variant="body1"
                onClick={() => handlePathClick(crumb.path)}
                sx={{ cursor: 'pointer', textDecoration: 'none' }}
              >
                {crumb.name || '홈'}
              </Link>
            ))}
          </Breadcrumbs>
          <Box sx={{ flexGrow: 1 }} />
          
          {/* Selection mode toggle button */}
          <Button
            variant={selectionMode ? 'contained' : 'outlined'}
            startIcon={selectionMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
            onClick={handleToggleSelectionMode}
            color={selectionMode ? 'primary' : 'inherit'}
          >
            {selectionMode ? '선택 모드' : '선택'}
          </Button>

          {selectionMode ? (
            <>
              {/* Selection mode buttons */}
              {selectedFiles.size > 0 && (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<MoveIcon />}
                    onClick={handleBulkMove}
                    disabled={selectedFiles.size === 0}
                  >
                    이동 ({selectedFiles.size})
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={handleBulkCopy}
                    disabled={selectedFiles.size === 0}
                  >
                    복사 ({selectedFiles.size})
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={handleBulkDownload}
                    disabled={selectedFiles.size === 0}
                  >
                    다운로드 ({selectedFiles.size})
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={handleBulkDelete}
                    disabled={selectedFiles.size === 0}
                  >
                    삭제 ({selectedFiles.size})
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Normal mode buttons */}
              <Button
                variant="outlined"
                startIcon={<FolderIcon />}
                onClick={() => setCreateFolderDialogOpen(true)}
              >
                폴더 만들기
              </Button>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => setUploadDialogOpen(true)}
              >
                업로드
              </Button>
            </>
          )}
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton
              color={viewMode === VIEW_MODES.LIST ? 'primary' : 'default'}
              onClick={() => setViewMode(VIEW_MODES.LIST)}
            >
              <ViewListIcon />
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
              <ViewAgendaIcon />
            </IconButton>
          </Box>
        </Box>

        {/* File View */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography>로딩 중...</Typography>
            </Box>
          ) : viewMode === VIEW_MODES.LIST ? (
            <FileList
              files={files}
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
            <>
              {selectionMode && (
                <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
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
                  <Typography variant="body2" sx={{ ml: 2 }}>
                    {selectedFiles.size}개 선택됨
                  </Typography>
                </Box>
              )}
              <FileGrid
                files={files}
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
            </>
          ) : (
            <FileDetail
              files={files}
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

