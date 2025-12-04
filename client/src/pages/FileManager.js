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
import { listFiles, moveFile } from '../services/fileService';

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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePathClick = (path) => {
    setCurrentPath(path);
  };

  const handleFileClick = (file) => {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
    } else {
      const filename = file.basename || file.name;
      const canPreviewFile = canPreview(filename);
      setSelectedFile({ ...file, name: filename, canPreview: canPreviewFile });
      setPreviewDialogOpen(true);
    }
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
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            WebDAV EasyAccess
          </Typography>
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
            />
          ) : viewMode === VIEW_MODES.GRID ? (
            <FileGrid
              files={files}
              onFileClick={handleFileClick}
              onContextMenu={(e, file) => {
                e.preventDefault();
                setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                setSelectedFile(file);
              }}
              onFileDrop={handleFileDrop}
            />
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
    </Box>
  );
};

export default FileManager;

