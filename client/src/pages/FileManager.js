import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  MenuItem,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  FormControlLabel,
  Divider,
  Paper,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  CircularProgress,
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
import { useResponsive } from '../hooks/useResponsive';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
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
import MobileBreadcrumb from '../components/MobileBreadcrumb';
import MobileFAB from '../components/MobileFAB';
import FileActionSheet from '../components/FileActionSheet';
import ShareDialog from '../components/ShareDialog';
import SharedFolderManageDialog from '../components/SharedFolderManageDialog';
import FilePropertiesDialog from '../components/FilePropertiesDialog';
import { moveFile, checkPermission, renameFile, deleteFile, copyFile, downloadFile, downloadMultipleFiles, uploadFile, listFiles } from '../services/fileService';

const FileManager = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileContentRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const { isMobile, isDesktop } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionSheetFile, setActionSheetFile] = useState(null);
  // 모바일용 FolderPickerDialog를 위한 별도 상태 (actionSheetFile이 초기화되어도 유지)
  const [mobilePickerFile, setMobilePickerFile] = useState(null);
  const [mobilePickerAction, setMobilePickerAction] = useState(null);
  
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

  // 모바일에서 Detail 모드로 전환 시도 시 List 모드로 자동 전환
  useEffect(() => {
    if (isMobile && viewMode === VIEW_MODES.DETAIL) {
      setViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, viewMode]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dropMessage, setDropMessage] = useState({ show: false, text: '', type: 'success' });
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
  const [viewModeMenuAnchor, setViewModeMenuAnchor] = useState(null);
  const [processingMap, setProcessingMap] = useState(new Map());
  
  // FileActionSheet 관련 다이얼로그 상태
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharedFolderManageDialogOpen, setSharedFolderManageDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameNewName, setRenameNewName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  // 모바일용 이름 변경/삭제/공유/공유 관리를 위한 별도 상태 (actionSheetFile이 초기화되어도 유지)
  const [mobileRenameFile, setMobileRenameFile] = useState(null);
  const [mobileDeleteFile, setMobileDeleteFile] = useState(null);
  const [mobileShareFile, setMobileShareFile] = useState(null);
  const [mobileSharedManageFile, setMobileSharedManageFile] = useState(null);
  const [mobilePropertiesFile, setMobilePropertiesFile] = useState(null);
  
  // 속성 다이얼로그 상태
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);

  // Explorer drag and drop hook for the entire file content area
  const {
    isDraggingOver: isFileAreaDraggingOver,
    handleDragEnter: handleFileAreaDragEnter,
    handleDragOver: handleFileAreaDragOver,
    handleDragLeave: handleFileAreaDragLeave,
    handleDrop: handleFileAreaDrop,
  } = useExplorerDragAndDrop();

  // Pull-to-refresh hook (모바일에서만 활성화)
  const {
    pullDistance,
    isPulling,
    isRefreshing,
    touchHandlers,
  } = usePullToRefresh(
    loadFiles,
    {
      scrollContainerRef: isMobile ? scrollContainerRef : null,
      threshold: 40,
      maxPullDistance: 80,
    }
  );

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
    handleRetry,
    dismissFailedItems,
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

  // 업로드 진행 상태를 추적하기 위한 ref
  const uploadAbortControllersRef = useRef(new Map());
  // 취소된 파일 목록을 추적하기 위한 ref (추가 안전장치)
  const cancelledFilesRef = useRef(new Map()); // Map<progressId, Set<fileName>>

  const handleUploadStart = useCallback(async (files, uploadPath) => {
    if (!files || files.length === 0) return;

    dismissFailedItems();
    setUploadDialogOpen(false);

    const progressId = `upload_${Date.now()}`;
    const abortControllers = new Map();
    uploadAbortControllersRef.current.set(progressId, abortControllers);
    cancelledFilesRef.current.set(progressId, new Set());

    // 현재 경로에 동일 이름이 있는지 사전 확인
    let existingNames = new Set();
    try {
      const existing = await listFiles(uploadPath || '/');
      existingNames = new Set(existing.map(item => item.basename || item.name));
    } catch (e) {
      console.error('Failed to fetch existing files before upload:', e);
    }

    // 파일 목록을 fileItems로 변환
    const fileItems = files.map(file => ({
      fileName: file.name,
      status: existingNames.has(file.name) ? 'error' : 'pending',
      error: existingNames.has(file.name) ? '같은 이름의 파일이 이미 존재합니다.' : undefined,
      file: file,
    }));

    // 초기 진행 상태 설정
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: 0,
      total: files.length,
      current: '업로드 준비 중...',
      name: `${files.length}개 파일 업로드`,
      fileItems: fileItems,
      retryData: {
        type: 'upload',
        fileItems: fileItems.filter(item => item.status !== 'error').map(item => ({
          fileName: item.fileName,
          file: item.file,
          status: 'pending',
        })),
        currentPath: uploadPath,
      },
      keepOnError: false,
    });

    // 업로드 시작
    let successCount = 0;
    let failCount = 0;
    const failedItems = [];
    let currentFileItems = [...fileItems]; // 현재 파일 상태를 추적하는 변수
    const cancelledSet = cancelledFilesRef.current.get(progressId); // 루프 밖에서 한 번만 가져오기

    for (let i = 0; i < fileItems.length; i++) {
      const fileItem = fileItems[i];
      
      const currentFileItemIndex = currentFileItems.findIndex(item => item.fileName === fileItem.fileName);
      let currentFileItem = currentFileItemIndex !== -1 
        ? currentFileItems[currentFileItemIndex] 
        : fileItem;
      
      // 취소된 파일 목록 확인 (추가 안전장치)
      if (cancelledSet && cancelledSet.has(fileItem.fileName)) {
        // 취소된 파일은 항상 cancelled 상태로 유지
        if (currentFileItemIndex !== -1 && currentFileItem.status !== 'cancelled') {
          currentFileItems[currentFileItemIndex] = {
            ...currentFileItems[currentFileItemIndex],
            status: 'cancelled',
          };
          updateProgress({
            id: progressId,
            fileItems: [...currentFileItems],
          });
        }
        continue;
      }
      
      // AbortController 확인 (이미 취소되었는지 체크) - 가장 먼저 확인
      const existingController = abortControllers.get(fileItem.fileName);
      if (existingController && existingController.signal.aborted) {
        // 취소 목록에 추가
        if (cancelledSet) {
          cancelledSet.add(fileItem.fileName);
        }
        // 이미 취소된 경우 상태를 cancelled로 업데이트하고 스킵
        if (currentFileItemIndex !== -1 && currentFileItem.status !== 'cancelled') {
          currentFileItems[currentFileItemIndex] = {
            ...currentFileItems[currentFileItemIndex],
            status: 'cancelled',
          };
          updateProgress({
            id: progressId,
            fileItems: [...currentFileItems],
          });
        }
        continue;
      }
      
      // 취소된 파일은 스킵 (progressItems에서 확인하는 대신, currentFileItems에서 확인)
      if (currentFileItem.status === 'cancelled') {
        continue;
      }
      
      // 이미 완료된 파일은 스킵
      if (currentFileItem.status === 'completed') {
        successCount++;
        continue;
      }
      
      // 이미 에러 상태인 파일은 스킵
      if (currentFileItem.status === 'error') {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: currentFileItem.error || fileItem.error || '업로드 실패',
        });
        continue;
      }
      
      // 취소된 파일은 스킵
      if (currentFileItem.status === 'cancelled') {
        continue;
      }

      // AbortController 생성
      if (!existingController) {
        const abortController = new AbortController();
        abortControllers.set(fileItem.fileName, abortController);
      }

      // 취소 상태 최종 확인 (업데이트 전에 다시 확인)
      const abortController = abortControllers.get(fileItem.fileName);
      if (!abortController || abortController.signal.aborted) {
        // 취소 목록에 추가
        if (cancelledSet) {
          cancelledSet.add(fileItem.fileName);
        }
        // 취소된 경우 상태를 cancelled로 업데이트하고 스킵
        if (currentFileItemIndex !== -1 && currentFileItem.status !== 'cancelled') {
          currentFileItems[currentFileItemIndex] = {
            ...currentFileItems[currentFileItemIndex],
            status: 'cancelled',
          };
          updateProgress({
            id: progressId,
            fileItems: [...currentFileItems],
          });
        }
        continue;
      }

      // 상태를 uploading으로 업데이트
      if (currentFileItemIndex !== -1) {
        currentFileItems[currentFileItemIndex] = {
          ...currentFileItems[currentFileItemIndex],
          status: 'uploading',
        };
      }

      // updateProgress가 자동으로 병합하므로 변경된 파일만 전달
      // updateProgress가 기존 progressItems의 cancelled 상태를 보존함
      updateProgress({
        id: progressId,
        type: 'upload',
        status: 'processing',
        progress: successCount,
        total: files.length,
        current: `(${successCount}/${files.length}) 업로드 중...`,
        name: `${files.length}개 파일 업로드`,
        fileItems: currentFileItems,
        retryData: {
          type: 'upload',
          fileItems: currentFileItems.filter(item => item.status !== 'error' && item.status !== 'completed' && item.status !== 'cancelled').map(item => ({
            fileName: item.fileName,
            file: item.file,
            status: item.status === 'uploading' ? 'pending' : item.status,
          })),
          currentPath: uploadPath,
        },
      });

      // 취소 상태 재확인 (업데이트 후에도 취소되었을 수 있음)
      if (abortController.signal.aborted) {
        // 취소 목록에 추가
        if (cancelledSet) {
          cancelledSet.add(fileItem.fileName);
        }
        // 취소된 경우 상태를 cancelled로 업데이트하고 스킵
        if (currentFileItemIndex !== -1) {
          currentFileItems[currentFileItemIndex] = {
            ...currentFileItems[currentFileItemIndex],
            status: 'cancelled',
          };
          updateProgress({
            id: progressId,
            fileItems: [...currentFileItems],
          });
        }
        continue;
      }

      try {
        // 업로드 시작 전 취소 상태 최종 확인
        if (abortController.signal.aborted || (cancelledSet && cancelledSet.has(fileItem.fileName))) {
          // 취소 목록에 추가
          if (cancelledSet) {
            cancelledSet.add(fileItem.fileName);
          }
          // 취소된 경우 상태를 cancelled로 업데이트하고 스킵
          if (currentFileItemIndex !== -1 && currentFileItems[currentFileItemIndex].status !== 'cancelled') {
            currentFileItems[currentFileItemIndex] = {
              ...currentFileItems[currentFileItemIndex],
              status: 'cancelled',
            };
            updateProgress({
              id: progressId,
              fileItems: [...currentFileItems],
            });
          }
          continue;
        }

        await uploadFile(fileItem.file, uploadPath, abortController.signal);
        
        // 업로드 완료 후 취소 상태 확인 (업로드 중 취소되었을 수 있음)
        if (abortController.signal.aborted || (cancelledSet && cancelledSet.has(fileItem.fileName))) {
          // 취소 목록에 추가
          if (cancelledSet) {
            cancelledSet.add(fileItem.fileName);
          }
          // 취소된 경우 상태를 cancelled로 업데이트하고 스킵
          if (currentFileItemIndex !== -1 && currentFileItems[currentFileItemIndex].status !== 'cancelled') {
            currentFileItems[currentFileItemIndex] = {
              ...currentFileItems[currentFileItemIndex],
              status: 'cancelled',
            };
            updateProgress({
              id: progressId,
              fileItems: [...currentFileItems],
            });
          }
          continue;
        }
        
        // 성공 상태로 업데이트 (취소되지 않은 경우에만)
        if (currentFileItemIndex !== -1 && currentFileItems[currentFileItemIndex].status !== 'cancelled') {
          successCount++;
          currentFileItems[currentFileItemIndex] = {
            ...currentFileItems[currentFileItemIndex],
            status: 'completed',
          };
        } else {
          // 취소된 경우 스킵
          continue;
        }

        // updateProgress가 자동으로 병합하므로 변경된 파일만 전달
        updateProgress({
          id: progressId,
          type: 'upload',
          status: successCount + failCount < files.length ? 'processing' : (failCount > 0 ? 'error' : 'completed'),
          progress: successCount,
          total: files.length,
          current: successCount + failCount < files.length 
            ? `(${successCount}/${files.length}) 업로드 중...`
            : failCount > 0 
              ? `(${successCount}/${files.length}) 완료 (${failCount}개 실패)`
              : `(${successCount}/${files.length}) 완료`,
          name: `${files.length}개 파일 업로드`,
          fileItems: currentFileItems, // updateProgress가 기존 항목과 병합하여 취소 상태 보존
          retryData: {
            type: 'upload',
            fileItems: currentFileItems.filter(item => item.status === 'error' || item.status === 'pending').map(item => ({
              fileName: item.fileName,
              file: item.file,
              status: item.status === 'uploading' ? 'pending' : item.status,
            })),
            currentPath: uploadPath,
          },
          keepOnError: failCount > 0,
          error: failCount > 0 ? `${failCount}개 실패` : undefined,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
        });

        existingNames.add(fileItem.fileName); // 이후 파일에서 중복 방지
      } catch (error) {
        // 취소 에러는 정상적인 취소로 처리
        if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
          // 취소 목록에 추가
          if (cancelledSet) {
            cancelledSet.add(fileItem.fileName);
          }
          if (currentFileItemIndex !== -1) {
            currentFileItems[currentFileItemIndex] = {
              ...currentFileItems[currentFileItemIndex],
              status: 'cancelled',
            };
          }
          // 취소된 경우 더 이상 진행하지 않음
          continue;
        } else {
          // 취소 상태 재확인
          if (currentFileItemIndex !== -1 && currentFileItems[currentFileItemIndex].status === 'cancelled') {
            continue;
          }
          
          failCount++;
          const errorMsg = error?.response?.data?.error || error?.message || '업로드 실패';
          if (currentFileItemIndex !== -1) {
            currentFileItems[currentFileItemIndex] = {
              ...currentFileItems[currentFileItemIndex],
              status: 'error',
              error: errorMsg,
            };
          }
          failedItems.push({
            fileName: fileItem.fileName,
            error: errorMsg,
          });
        }

        // updateProgress가 자동으로 병합하므로 변경된 파일만 전달
        updateProgress({
          id: progressId,
          type: 'upload',
          status: successCount + failCount < files.length ? 'processing' : (failCount > 0 ? 'error' : 'completed'),
          progress: successCount,
          total: files.length,
          current: successCount + failCount < files.length 
            ? `(${successCount}/${files.length}) 업로드 중...`
            : failCount > 0 
              ? `(${successCount}/${files.length}) 완료 (${failCount}개 실패)`
              : `(${successCount}/${files.length}) 완료`,
          name: `${files.length}개 파일 업로드`,
          fileItems: currentFileItems, // updateProgress가 기존 항목과 병합하여 취소 상태 보존
          retryData: {
            type: 'upload',
            fileItems: currentFileItems.filter(item => item.status === 'error' || item.status === 'pending').map(item => ({
              fileName: item.fileName,
              file: item.file,
              status: item.status === 'uploading' ? 'pending' : item.status,
            })),
            currentPath: uploadPath,
          },
          keepOnError: failCount > 0,
          error: failCount > 0 ? `${failCount}개 실패` : undefined,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
        });

        if (error.name !== 'AbortError' && error.code !== 'ERR_CANCELED') {
          console.error('Upload error:', error);
        }
      }

      // AbortController 정리 (취소된 파일의 AbortController는 유지)
      const isCancelled = (cancelledSet && cancelledSet.has(fileItem.fileName)) || 
                          currentFileItem.status === 'cancelled';
      if (!isCancelled) {
        abortControllers.delete(fileItem.fileName);
      }
    }

    // 성공한 파일이 있으면 파일 목록 새로고침
    if (successCount > 0) {
      loadFiles();
    }

    // 실패가 없을 때만 자동 제거
    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
      }, 3000);
    } else {
      // 실패가 있으면 keepOnError를 true로 설정하여 유지
      updateProgress({
        id: progressId,
        keepOnError: true,
      });
    }
  }, [dismissFailedItems, updateProgress, loadFiles]);

  const handleUploadComplete = () => {
    // 이 함수는 더 이상 사용되지 않지만 호환성을 위해 유지
    loadFiles();
    setUploadDialogOpen(false);
  };

  // 개별 파일 업로드 취소
  const handleCancelUploadFile = useCallback((progressId, fileName) => {
    const abortControllers = uploadAbortControllersRef.current.get(progressId);
    if (abortControllers) {
      const abortController = abortControllers.get(fileName);
      if (abortController) {
        abortController.abort();
        // AbortController는 삭제하지 않고 유지 (취소 상태 표시용)
      }
    }

    // 취소 목록에 추가
    const cancelledSet = cancelledFilesRef.current.get(progressId);
    if (cancelledSet) {
      cancelledSet.add(fileName);
    }

    // 진행 상태 업데이트
    const progressItem = progressItems.find(item => item.id === progressId);
    if (progressItem && progressItem.fileItems) {
      const updatedFileItems = progressItem.fileItems.map(item => {
        if (item.fileName === fileName) {
          return {
            ...item,
            status: 'cancelled',
          };
        }
        return item;
      });

      updateProgress({
        ...progressItem,
        fileItems: updatedFileItems,
      });
    }
  }, [progressItems, updateProgress]);

  // 전체 업로드 취소
  const handleCancelAllUpload = useCallback((progressId) => {
    const abortControllers = uploadAbortControllersRef.current.get(progressId);
    if (abortControllers) {
      // 모든 진행 중인 업로드 취소
      abortControllers.forEach((abortController, fileName) => {
        abortController.abort();
        // 취소 목록에 추가
        const cancelledSet = cancelledFilesRef.current.get(progressId);
        if (cancelledSet) {
          cancelledSet.add(fileName);
        }
      });
      // AbortController는 유지 (취소 상태 표시용)
    }

    // 진행 상태 업데이트
    const progressItem = progressItems.find(item => item.id === progressId);
    if (progressItem && progressItem.fileItems) {
      const updatedFileItems = progressItem.fileItems.map(item => {
        if (item.status === 'pending' || item.status === 'uploading') {
          // 취소 목록에 추가
          const cancelledSet = cancelledFilesRef.current.get(progressId);
          if (cancelledSet) {
            cancelledSet.add(item.fileName);
          }
          return {
            ...item,
            status: 'cancelled',
          };
        }
        return item;
      });

      updateProgress({
        ...progressItem,
        fileItems: updatedFileItems,
        status: 'error',
        error: '업로드가 취소되었습니다.',
      });

      // 일정 시간 후 제거
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
        cancelledFilesRef.current.delete(progressId);
      }, 3000);
    }
  }, [progressItems, updateProgress]);

  // 업로드 재시도 (실패한 파일만 재시도)
  const handleRetryUpload = useCallback(async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    if (!progressItem || !progressItem.retryData || progressItem.retryData.type !== 'upload') {
      // 업로드 타입이 아니면 기존 handleRetry 사용
      if (handleRetry) {
        return handleRetry(progressId);
      }
      return;
    }

    const { fileItems: retryFileItems, currentPath: uploadPath } = progressItem.retryData;
    
    // 실패한 파일만 필터링
    const failedFiles = retryFileItems.filter(item => item.status === 'error' && item.file);
    
    if (failedFiles.length === 0) {
      // 재시도할 파일이 없으면 제거
      updateProgress({ id: progressId, remove: true });
      uploadAbortControllersRef.current.delete(progressId);
      return;
    }

    // 기존 진행 상태를 초기화하고 재시도 시작
    const abortControllers = new Map();
    uploadAbortControllersRef.current.set(progressId, abortControllers);

    // 현재 파일 목록 가져오기
    let existingNames = new Set();
    try {
      const existing = await listFiles(uploadPath || '/');
      existingNames = new Set(existing.map(item => item.basename || item.name));
    } catch (e) {
      console.error('Failed to fetch existing files before retry:', e);
    }

    // 재시도할 파일 목록 준비
    const fileItemsToRetry = failedFiles.map(fileItem => ({
      fileName: fileItem.fileName,
      status: existingNames.has(fileItem.fileName) ? 'error' : 'pending',
      error: existingNames.has(fileItem.fileName) ? '같은 이름의 파일이 이미 존재합니다.' : undefined,
      file: fileItem.file,
    }));

    // 기존 fileItems와 병합 (성공한 파일은 유지)
    const existingFileItems = progressItem.fileItems || [];
    const existingFileNames = new Set(existingFileItems.map(item => item.fileName));
    const mergedFileItems = [
      ...existingFileItems.filter(item => item.status === 'completed' || item.status === 'cancelled'),
      ...fileItemsToRetry,
    ];

    // 초기 진행 상태 설정
    const totalFiles = mergedFileItems.length;
    const completedCount = mergedFileItems.filter(item => item.status === 'completed').length;

    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: completedCount,
      total: totalFiles,
      current: '재시도 준비 중...',
      name: `${totalFiles}개 파일 업로드`,
      fileItems: mergedFileItems,
      retryData: {
        type: 'upload',
        fileItems: fileItemsToRetry.filter(item => item.status !== 'error').map(item => ({
          fileName: item.fileName,
          file: item.file,
          status: 'pending',
        })),
        currentPath: uploadPath,
      },
      keepOnError: false,
      error: undefined,
      failedItems: undefined,
    });

    // 재시도 업로드 시작
    let successCount = completedCount;
    let failCount = 0;
    const failedItems = [];

    for (let i = 0; i < fileItemsToRetry.length; i++) {
      const fileItem = fileItemsToRetry[i];
      
      // 이미 에러 상태인 파일은 스킵
      if (fileItem.status === 'error') {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: fileItem.error,
        });
        continue;
      }

      // AbortController 생성
      const abortController = new AbortController();
      abortControllers.set(fileItem.fileName, abortController);

      // 상태를 uploading으로 업데이트
      const itemIndex = mergedFileItems.findIndex(item => item.fileName === fileItem.fileName);
      if (itemIndex !== -1) {
        mergedFileItems[itemIndex] = {
          ...fileItem,
          status: 'uploading',
        };
      }

      updateProgress({
        id: progressId,
        type: 'upload',
        status: 'processing',
        progress: successCount,
        total: totalFiles,
        current: `(${successCount}/${totalFiles}) 업로드 중...`,
        name: `${totalFiles}개 파일 업로드`,
        fileItems: mergedFileItems,
        retryData: {
          type: 'upload',
          fileItems: mergedFileItems.filter(item => item.status !== 'error' && item.status !== 'completed').map(item => ({
            fileName: item.fileName,
            file: item.file,
            status: item.status === 'uploading' ? 'pending' : item.status,
          })),
          currentPath: uploadPath,
        },
      });

      try {
        await uploadFile(fileItem.file, uploadPath, abortController.signal);
        
        // 성공 상태로 업데이트
        successCount++;
        if (itemIndex !== -1) {
          mergedFileItems[itemIndex] = {
            ...fileItem,
            status: 'completed',
          };
        }

        updateProgress({
          id: progressId,
          type: 'upload',
          status: successCount + failCount < totalFiles ? 'processing' : (failCount > 0 ? 'error' : 'completed'),
          progress: successCount,
          total: totalFiles,
          current: successCount + failCount < totalFiles 
            ? `(${successCount}/${totalFiles}) 업로드 중...`
            : failCount > 0 
              ? `(${successCount}/${totalFiles}) 완료 (${failCount}개 실패)`
              : `(${successCount}/${totalFiles}) 완료`,
          name: `${totalFiles}개 파일 업로드`,
          fileItems: mergedFileItems,
          retryData: {
            type: 'upload',
            fileItems: mergedFileItems.filter(item => item.status === 'error' || item.status === 'pending').map(item => ({
              fileName: item.fileName,
              file: item.file,
              status: item.status === 'uploading' ? 'pending' : item.status,
            })),
            currentPath: uploadPath,
          },
          keepOnError: failCount > 0,
          error: failCount > 0 ? `${failCount}개 실패` : undefined,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
        });

        existingNames.add(fileItem.fileName);
      } catch (error) {
        // 취소 에러는 정상적인 취소로 처리
        if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
          if (itemIndex !== -1) {
            mergedFileItems[itemIndex] = {
              ...fileItem,
              status: 'cancelled',
            };
          }
        } else {
          failCount++;
          const errorMsg = error?.response?.data?.error || error?.message || '업로드 실패';
          if (itemIndex !== -1) {
            mergedFileItems[itemIndex] = {
              ...fileItem,
              status: 'error',
              error: errorMsg,
            };
          }
          failedItems.push({
            fileName: fileItem.fileName,
            error: errorMsg,
          });
        }

        updateProgress({
          id: progressId,
          type: 'upload',
          status: successCount + failCount < totalFiles ? 'processing' : (failCount > 0 ? 'error' : 'completed'),
          progress: successCount,
          total: totalFiles,
          current: successCount + failCount < totalFiles 
            ? `(${successCount}/${totalFiles}) 업로드 중...`
            : failCount > 0 
              ? `(${successCount}/${totalFiles}) 완료 (${failCount}개 실패)`
              : `(${successCount}/${totalFiles}) 완료`,
          name: `${totalFiles}개 파일 업로드`,
          fileItems: mergedFileItems,
          retryData: {
            type: 'upload',
            fileItems: mergedFileItems.filter(item => item.status === 'error' || item.status === 'pending').map(item => ({
              fileName: item.fileName,
              file: item.file,
              status: item.status === 'uploading' ? 'pending' : item.status,
            })),
            currentPath: uploadPath,
          },
          keepOnError: failCount > 0,
          error: failCount > 0 ? `${failCount}개 실패` : undefined,
          failedItems: failedItems.length > 0 ? failedItems : undefined,
        });

        if (error.name !== 'AbortError' && error.code !== 'ERR_CANCELED') {
          console.error('Retry upload error:', error);
        }
      }

      // AbortController 정리 (취소된 파일의 AbortController는 유지)
      const cancelledSet = cancelledFilesRef.current.get(progressId);
      const isCancelled = cancelledSet && cancelledSet.has(fileItem.fileName);
      if (!isCancelled) {
        abortControllers.delete(fileItem.fileName);
      }
    }

    // 성공한 파일이 있으면 파일 목록 새로고침
    if (successCount > completedCount) {
      loadFiles();
    }

    // 실패가 없을 때만 자동 제거
    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
        cancelledFilesRef.current.delete(progressId);
      }, 3000);
    } else {
      // 실패가 있으면 keepOnError를 true로 설정하여 유지
      updateProgress({
        id: progressId,
        keepOnError: true,
      });
    }
  }, [progressItems, updateProgress, loadFiles, handleRetry]);

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

  // FileActionSheet 핸들러 함수들
  const handleRename = async () => {
    // mobileRenameFile이 있으면 사용, 없으면 actionSheetFile 사용
    const targetFile = mobileRenameFile || actionSheetFile;
    
    if (!targetFile || !renameNewName.trim()) {
      setDropMessage({
        show: true,
        text: '이름을 입력하세요',
        type: 'error',
      });
      return;
    }

    setRenameLoading(true);
    const filePath = targetFile.path;
    
    setProcessingMap(prev => {
      const next = new Map(prev);
      next.set(filePath, 'rename');
      return next;
    });

    try {
      await renameFile(filePath, renameNewName);
      setRenameDialogOpen(false);
      setRenameNewName('');
      setMobileRenameFile(null);
      setActionSheetOpen(false);
      setActionSheetFile(null);
      handleRefresh();
      
      setDropMessage({
        show: true,
        text: `"${targetFile.basename}"을(를) "${renameNewName}"(으)로 이름 변경했습니다`,
        type: 'success',
      });
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 3000);
    } catch (error) {
      const errorMsg = error.response?.data?.error || '이름 변경에 실패했습니다';
      setDropMessage({
        show: true,
        text: errorMsg,
        type: 'error',
      });
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 5000);
    } finally {
      setRenameLoading(false);
      setProcessingMap(prev => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const handleDelete = async () => {
    // mobileDeleteFile이 있으면 사용, 없으면 actionSheetFile 사용
    const targetFile = mobileDeleteFile || actionSheetFile;
    
    if (!targetFile) return;

    const filePath = targetFile.path;
    const isDirectory = targetFile.type === 'directory';
    
    setProcessingMap(prev => {
      const next = new Map(prev);
      next.set(filePath, 'delete');
      return next;
    });

    try {
      await deleteFile(filePath);
      setDeleteDialogOpen(false);
      setMobileDeleteFile(null);
      setActionSheetOpen(false);
      setActionSheetFile(null);
      handleRefresh(isDirectory ? filePath : null);
      
      setDropMessage({
        show: true,
        text: `"${targetFile.basename}"을(를) 삭제했습니다`,
        type: 'success',
      });
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 3000);
    } catch (error) {
      const errorMsg = error.response?.data?.error || '삭제에 실패했습니다';
      setDropMessage({
        show: true,
        text: errorMsg,
        type: 'error',
      });
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 5000);
    } finally {
      setProcessingMap(prev => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  // FileContextMenu.handleFileOperation과 동일한 패턴의 공통 핸들러
  const handleActionSheetFileOperation = async (selectedPath, operation, operationName, actionVerb, file = null) => {
    // file 파라미터가 제공되면 사용, 없으면 actionSheetFile 사용
    const targetFile = file || actionSheetFile;
    
    if (!targetFile || !selectedPath || !selectedPath.trim()) {
      setDropMessage({
        show: true,
        text: '대상 경로를 선택하세요',
        type: 'error',
      });
      return;
    }

    const destPath = selectedPath.endsWith('/')
      ? selectedPath + targetFile.basename
      : selectedPath + '/' + targetFile.basename;
    
    const filePath = targetFile.path;
    const progressId = `${operationName}_${Date.now()}`;
    const operationType = operation === moveFile ? 'move' : 'copy';

    // onProcessingStart와 동일한 효과
    setProcessingMap(prev => {
      const next = new Map(prev);
      next.set(filePath, operationType);
      return next;
    });

    const progressItem = {
      id: progressId,
      type: operationType,
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `${targetFile.basename} ${operationName}`,
    };
    
    // onProgress와 동일한 효과
    updateProgress(progressItem);

    try {
      updateProgress({
        ...progressItem,
        status: 'processing',
        progress: 0,
        total: 1,
        current: `(0/1) ${actionVerb}중...`,
      });
      
      await operation(filePath, destPath, (progress) => {
        updateProgress({
          ...progressItem,
          status: progress.stage === 'completed' ? 'completed' : 'processing',
          progress: progress.stage === 'completed' ? 1 : 0,
          total: 1,
          current: progress.stage === 'completed' ? `(1/1) ${actionVerb}중...` : `(0/1) ${actionVerb}중...`,
        });
      });
      
      setFolderPickerOpen(false);
      setActionSheetOpen(false);
      setActionSheetFile(null);
      // onActionComplete와 동일한 효과
      handleRefresh();
      
      updateProgress({
        ...progressItem,
        status: 'completed',
        progress: 0,
        total: 0,
        current: '완료',
      });
      
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    } catch (error) {
      const errorMsg = error.response?.data?.error || `${operationName}에 실패했습니다`;
      const isDuplicate = error.response?.status === 409 || errorMsg.includes('already exists');
      
      // onProgress가 있으면 progress에 에러 표시 (FileContextMenu와 동일)
      updateProgress({
        ...progressItem,
        status: 'error',
        error: errorMsg,
      });
      
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 5000);
      
      // FileContextMenu와 동일한 패턴: onProgress가 있으면 progress에만 표시
      // 모바일에서는 항상 updateProgress가 있으므로 여기서는 progress에만 표시
    } finally {
      // onProcessingEnd와 동일한 효과
      setProcessingMap(prev => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const handleActionSheetMove = (selectedPath) => {
    handleActionSheetFileOperation(selectedPath, moveFile, '이동', '이동');
  };

  const handleActionSheetCopy = (selectedPath) => {
    handleActionSheetFileOperation(selectedPath, copyFile, '복사', '복사');
  };

  const handleActionSheetDownload = async () => {
    if (!actionSheetFile) return;

    try {
      if (actionSheetFile.type === 'directory') {
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
        
        updateProgress(progressItem);
        
        await downloadMultipleFiles([actionSheetFile.path], (progress) => {
          updateProgress({ ...progress, id: progressId });
        });
        
        setTimeout(() => {
          updateProgress({ id: progressId, remove: true });
        }, 3000);
      } else {
        await downloadFile(actionSheetFile.path);
      }
      setActionSheetOpen(false);
      setActionSheetFile(null);
    } catch (error) {
      const errorMsg = error.response?.data?.error || '다운로드에 실패했습니다';
      setDropMessage({
        show: true,
        text: errorMsg,
        type: 'error',
      });
      setTimeout(() => {
        setDropMessage({ show: false, text: '', type: 'success' });
      }, 5000);
    }
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

    dismissFailedItems();

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
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragOver(e);
    }
  };

  const handleContentAreaDragEnter = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragEnter(e);
    }
  };

  const handleContentAreaDragLeave = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDragLeave(e);
    }
  };

  const handleContentAreaDrop = (e) => {
    if (isMobile || selectionMode || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleFileAreaDrop(e, currentPath, handleExplorerDrop);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-height)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <AppBar position="sticky" sx={{ top: 0, zIndex: (theme) => theme.zIndex.appBar }} elevation={4}>
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" component="div" sx={{ fontSize: isMobile ? '1rem' : '1.25rem' }}>
              WebDAV EasyAccess
            </Typography>
            {webdavUrl && !isMobile && (
              <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.7rem' }}>
                {webdavUrl}
              </Typography>
            )}
          </Box>
          {!isMobile && (
            <Typography variant="body2" sx={{ mr: 2 }}>
              {user?.username}
            </Typography>
          )}
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

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {!isMobile && (
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
            isMobile={isMobile}
          />
        )}

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

          {isMobile && (
            <>
              <MobileBreadcrumb
                currentPath={currentPath}
                onPathClick={handlePathClick}
                user={user}
                onToggleFolderTree={() => setDrawerOpen(!drawerOpen)}
                isFolderTreeOpen={drawerOpen}
              />
              <Collapse in={drawerOpen} timeout="auto">
                <Box
                  sx={{
                    maxHeight: '50vh',
                    overflow: 'auto',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    backgroundColor: 'background.paper',
                  }}
                >
                  <FolderTree
                    currentPath={currentPath}
                    onPathClick={(path) => {
                      handlePathClick(path);
                      setDrawerOpen(false);
                    }}
                    user={user}
                    treeUpdateTrigger={treeUpdateTrigger}
                    onCreateFolder={() => {
                      setCreateFolderDialogOpen(true);
                      setDrawerOpen(false);
                    }}
                    onUploadFile={() => {
                      setUploadDialogOpen(true);
                      setDrawerOpen(false);
                    }}
                    selectionMode={selectionMode}
                    hasWritePermission={hasWritePermission}
                    onExplorerDrop={handleExplorerDrop}
                    isMobile={isMobile}
                  />
                </Box>
              </Collapse>
            </>
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
                {isMobile ? (
                  <>
                    <IconButton size="small" onClick={handleSelectAll} title="모두 선택">
                      <SelectAllIcon />
                    </IconButton>
                    <IconButton size="small" onClick={handleDeselectAll} title="모두 해제">
                      <DeselectIcon />
                    </IconButton>
                    <Typography variant="caption" sx={{ ml: 1, fontSize: '0.75rem' }}>
                      {selectedFiles.size}개
                    </Typography>
                  </>
                ) : (
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
          
            {selectionMode ? (
              <>
                <IconButton
                  onClick={(e) => setViewModeMenuAnchor(e.currentTarget)}
                  title="보기 모드"
                >
                  {viewMode === VIEW_MODES.LIST && <ViewStreamIcon />}
                  {viewMode === VIEW_MODES.GRID && <ViewModuleIcon />}
                  {viewMode === VIEW_MODES.DETAIL && <ViewListIcon />}
                </IconButton>
                <Menu
                  anchorEl={viewModeMenuAnchor}
                  open={Boolean(viewModeMenuAnchor)}
                  onClose={() => setViewModeMenuAnchor(null)}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                  }}
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      setViewMode(VIEW_MODES.LIST);
                      setViewModeMenuAnchor(null);
                    }}
                    selected={viewMode === VIEW_MODES.LIST}
                  >
                    <ListItemIcon>
                      <ViewStreamIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>리스트 보기</ListItemText>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setViewMode(VIEW_MODES.GRID);
                      setViewModeMenuAnchor(null);
                    }}
                    selected={viewMode === VIEW_MODES.GRID}
                  >
                    <ListItemIcon>
                      <ViewModuleIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>그리드 보기</ListItemText>
                  </MenuItem>
                  {!isMobile && (
                    <MenuItem
                      onClick={() => {
                        setViewMode(VIEW_MODES.DETAIL);
                        setViewModeMenuAnchor(null);
                      }}
                      selected={viewMode === VIEW_MODES.DETAIL}
                    >
                      <ListItemIcon>
                        <ViewListIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText>상세 보기</ListItemText>
                    </MenuItem>
                  )}
                </Menu>
              </>
            ) : (
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
                {!isMobile && (
                  <IconButton
                    color={viewMode === VIEW_MODES.DETAIL ? 'primary' : 'default'}
                    onClick={() => setViewMode(VIEW_MODES.DETAIL)}
                  >
                    <ViewListIcon />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

          <Box
            ref={scrollContainerRef}
            {...(isMobile ? touchHandlers : {})}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 2,
              minHeight: 0,
              position: 'relative',
              // Avoid being hidden behind the fixed bottom selection action bar on mobile
              pb: selectionMode && isMobile ? 'calc(88px + env(safe-area-inset-bottom))' : 2,
              // Enable smooth scrolling and bounce effect on iOS
              WebkitOverflowScrolling: 'touch',
              // Optional: contain bounce within this scroll area
              overscrollBehaviorY: 'contain',
            }}
          >
            {/* Pull-to-refresh 시각적 피드백 - 실제 콘텐츠 영역에 포함 */}
            {isMobile && (
              <Collapse in={isPulling || isRefreshing || loading} timeout={400}>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingTop: '16px',
                    paddingBottom: '16px',
                    marginTop: (isRefreshing || loading) ? '0px' : `${Math.max(-pullDistance * 0.5, -40)}px`,
                    transition: (isRefreshing || loading) 
                      ? 'margin-top 0.3s ease-out' 
                      : 'margin-top 0.15s ease-out',
                    opacity: (isRefreshing || loading) ? 1 : Math.min(pullDistance / 40, 1),
                    minHeight: '60px',
                  }}
                >
                  <CircularProgress
                    size={24}
                    thickness={4}
                    sx={{
                      mb: 1,
                      color: 'primary.main',
                    }}
                  />
                  {(isRefreshing || loading) && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.75rem',
                      }}
                    >
                      로딩 중...
                    </Typography>
                  )}
                </Box>
              </Collapse>
            )}
            {!isMobile && loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography>로딩 중...</Typography>
              </Box>
            ) : viewMode === VIEW_MODES.LIST ? (
              <FileList
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
              />
            ) : viewMode === VIEW_MODES.GRID ? (
              <FileGrid
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
              />
            ) : (
              <FileDetail
                files={sortedFiles}
                processingMap={processingMap}
                onFileClick={handleFileClick}
                onContextMenu={(e, file) => {
                  if (e.cancelable) {
                    e.preventDefault();
                  }
                  if (isMobile) {
                    setActionSheetFile(file);
                    setActionSheetOpen(true);
                  } else {
                    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
                    setSelectedFile(file);
                  }
                }}
                onFileDrop={handleFileDrop}
                selectionMode={selectionMode}
                selectedFiles={selectedFiles}
                onFileCheck={handleFileCheck}
                hasWritePermission={hasWritePermission}
                currentPath={currentPath}
                onPathClick={handlePathClick}
                loading={loading}
              />
            )}
          </Box>
        </Box>
      </Box>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        currentPath={currentPath}
        onUploadStart={handleUploadStart}
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
          // 모바일용 상태도 초기화
          if (mobilePickerFile) {
            setMobilePickerFile(null);
            setMobilePickerAction(null);
          }
        }}
        onSelect={(selectedPath) => {
          // mobilePickerFile이 있으면 모바일에서 호출된 것
          if (mobilePickerFile) {
            const currentAction = mobilePickerAction;
            const currentFile = mobilePickerFile;
            
            // 다이얼로그 닫기
            setFolderPickerOpen(false);
            setFolderPickerAction(null);
            setMobilePickerFile(null);
            setMobilePickerAction(null);
            
            // 작업 수행 (currentFile을 사용)
            if (currentAction === 'move') {
              handleActionSheetFileOperation(selectedPath, moveFile, '이동', '이동', currentFile);
            } else if (currentAction === 'copy') {
              handleActionSheetFileOperation(selectedPath, copyFile, '복사', '복사', currentFile);
            }
            
            // ActionSheet도 닫기
            setActionSheetOpen(false);
            setActionSheetFile(null);
          } else {
            // 기존 bulk operation 로직 (데스크톱)
            handleFolderPickerSelect(selectedPath);
            setFolderPickerOpen(false);
            setFolderPickerAction(null);
          }
        }}
        title={
          mobilePickerFile
            ? `${mobilePickerAction === 'move' ? '이동' : '복사'}: ${mobilePickerFile.basename}`
            : folderPickerAction === 'move' ? '이동할 폴더 선택' : '복사할 폴더 선택'
        }
        currentPath={currentPath}
        user={user}
        action={folderPickerAction}
        sourceFilePath={mobilePickerFile ? mobilePickerFile.path : (actionSheetFile ? actionSheetFile.path : undefined)}
        sourceFilePaths={
          !mobilePickerFile && !actionSheetFile && folderPickerAction === 'copy' ? Array.from(selectedFiles) : undefined
        }
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
            bottom: isMobile ? 0 : 24,
            left: isMobile ? 0 : '50%',
            right: isMobile ? 0 : 'auto',
            transform: isMobile ? 'none' : 'translateX(-50%)',
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            gap: isMobile ? 0.5 : 1,
            alignItems: 'center',
            justifyContent: 'center',
            p: isMobile ? 1 : 1.5,
            borderRadius: isMobile ? 0 : 3,
            zIndex: 1000,
            backgroundColor: 'background.paper',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            paddingBottom: isMobile ? 'calc(8px + env(safe-area-inset-bottom))' : 1.5,
          }}
        >
          <Typography 
            variant="body2" 
            sx={{ 
              mr: isMobile ? 0.5 : 1, 
              fontWeight: 500, 
              minWidth: isMobile ? 'auto' : '60px',
              fontSize: isMobile ? '0.875rem' : '0.875rem',
            }}
          >
            {selectedFiles.size}개
          </Typography>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkMove}
            disabled={!hasWritePermission}
            title="이동"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
              '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
            }}
          >
            <MoveIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkCopy}
            title="복사"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
            }}
          >
            <CopyIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="primary"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkDownload}
            title="다운로드"
            sx={{ 
              backgroundColor: 'primary.main',
              color: 'white',
              '&:hover': { backgroundColor: 'primary.dark' },
            }}
          >
            <DownloadIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
          <IconButton
            color="error"
            size={isMobile ? "medium" : "small"}
            onClick={handleBulkDelete}
            disabled={!hasWritePermission}
            title="삭제"
            sx={{ 
              backgroundColor: 'error.main',
              color: 'white',
              '&:hover': { backgroundColor: 'error.dark' },
              '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
            }}
          >
            <DeleteIcon fontSize={isMobile ? "medium" : "small"} />
          </IconButton>
        </Paper>
      )}

      <DownloadProgress
        items={progressItems}
        onClose={(id) => {
          updateProgress({ id, remove: true });
          uploadAbortControllersRef.current.delete(id);
          cancelledFilesRef.current.delete(id);
        }}
        onRetry={handleRetryUpload}
        onCancelFile={handleCancelUploadFile}
        onCancelAll={handleCancelAllUpload}
      />

      {/* Mobile FAB */}
      {isMobile && !selectionMode && (
        <MobileFAB
          onUpload={() => setUploadDialogOpen(true)}
          onCreateFolder={() => setCreateFolderDialogOpen(true)}
          hasWritePermission={hasWritePermission}
        />
      )}

      {/* Mobile Action Sheet */}
      {isMobile && (
        <FileActionSheet
          open={actionSheetOpen}
          onClose={() => {
            setActionSheetOpen(false);
            setActionSheetFile(null);
          }}
          file={actionSheetFile}
          hasWritePermission={hasWritePermission}
          user={user}
          onDownload={handleActionSheetDownload}
          onRename={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileRenameFile(actionSheetFile);
              setRenameNewName(actionSheetFile.basename);
              setRenameDialogOpen(true);
            }
          }}
          onMove={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (FolderPickerDialog가 닫혀도 유지)
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('move');
              setFolderPickerAction('move');
              setFolderPickerOpen(true);
            }
          }}
          onCopy={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (FolderPickerDialog가 닫혀도 유지)
              setMobilePickerFile(actionSheetFile);
              setMobilePickerAction('copy');
              setFolderPickerAction('copy');
              setFolderPickerOpen(true);
            }
          }}
          onDelete={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileDeleteFile(actionSheetFile);
              setDeleteDialogOpen(true);
            }
          }}
          onShare={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileShareFile(actionSheetFile);
              setShareDialogOpen(true);
            }
          }}
          onManageShared={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobileSharedManageFile(actionSheetFile);
              setSharedFolderManageDialogOpen(true);
            }
          }}
          onPreview={() => {
            if (actionSheetFile) {
              const filename = actionSheetFile.basename || actionSheetFile.name;
              const canPreviewFile = canPreview(filename);
              setSelectedFile({ ...actionSheetFile, name: filename, canPreview: canPreviewFile });
              setPreviewDialogOpen(true);
            }
          }}
          onProperties={() => {
            if (actionSheetFile) {
              // actionSheetFile 정보를 별도 상태에 저장 (다이얼로그가 닫혀도 유지)
              setMobilePropertiesFile(actionSheetFile);
              setPropertiesDialogOpen(true);
            }
          }}
        />
      )}

      {/* Rename Dialog */}
      <Dialog 
        open={renameDialogOpen} 
        onClose={() => {
          setRenameDialogOpen(false);
          setRenameNewName('');
          setMobileRenameFile(null);
        }}
        fullScreen={isMobile}
      >
        <DialogTitle>이름 변경</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="새 이름"
            fullWidth
            variant="outlined"
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !renameLoading) {
                handleRename();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setRenameDialogOpen(false);
              setRenameNewName('');
              setMobileRenameFile(null);
            }} 
            disabled={renameLoading}
          >
            취소
          </Button>
          <Button 
            onClick={handleRename} 
            variant="contained" 
            disabled={renameLoading || !renameNewName.trim()}
          >
            변경
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialogOpen} 
        onClose={() => {
          setDeleteDialogOpen(false);
          setMobileDeleteFile(null);
        }}
        fullScreen={isMobile}
      >
        <DialogTitle>삭제 확인</DialogTitle>
        <DialogContent>
          <DialogContentText>
            정말로 "{(mobileDeleteFile || actionSheetFile)?.basename}"을(를) 삭제하시겠습니까?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setDeleteDialogOpen(false);
              setMobileDeleteFile(null);
            }}
          >
            취소
          </Button>
          <Button 
            onClick={handleDelete} 
            variant="contained" 
            color="error"
            disabled={processingMap.has((mobileDeleteFile || actionSheetFile)?.path)}
          >
            삭제
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share Dialog */}
      {(mobileShareFile || actionSheetFile) && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => {
            setShareDialogOpen(false);
            setMobileShareFile(null);
          }}
          folderPath={(mobileShareFile || actionSheetFile)?.path}
          folderName={(mobileShareFile || actionSheetFile)?.basename || (mobileShareFile || actionSheetFile)?.name}
          user={user}
          onMessage={setDropMessage}
        />
      )}

      {/* Shared Folder Manage Dialog */}
      {(mobileSharedManageFile || actionSheetFile) && (
        <SharedFolderManageDialog
          open={sharedFolderManageDialogOpen}
          onClose={() => {
            setSharedFolderManageDialogOpen(false);
            setMobileSharedManageFile(null);
          }}
          folderPath={(mobileSharedManageFile || actionSheetFile)?.path}
          folderName={(mobileSharedManageFile || actionSheetFile)?.basename || (mobileSharedManageFile || actionSheetFile)?.name}
          user={user}
          onMessage={setDropMessage}
          onActionComplete={() => {
            handleRefresh();
          }}
        />
      )}

      {/* File Properties Dialog */}
      {(mobilePropertiesFile || actionSheetFile) && (
        <FilePropertiesDialog
          open={propertiesDialogOpen}
          onClose={() => {
            setPropertiesDialogOpen(false);
            setMobilePropertiesFile(null);
          }}
          file={mobilePropertiesFile || actionSheetFile}
        />
      )}
    </Box>
  );
};

export default FileManager;
