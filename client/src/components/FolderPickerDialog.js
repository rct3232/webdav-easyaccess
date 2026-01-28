import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Breadcrumbs,
  Link,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { listFiles, checkPermission } from '../services/fileService';
import axios from 'axios';
import { useResponsive } from '../hooks/useResponsive';
import { normalizePath, getParentPath } from '../utils/pathUtils';

const FolderPickerDialog = ({ open, onClose, onSelect, title, currentPath, user, action, sourceFilePath, sourceFilePaths }) => {
  const { isMobile } = useResponsive();
  const [selectedPath, setSelectedPath] = useState(currentPath || '/');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasWritePermission, setHasWritePermission] = useState(true);
  const [sharedFolders, setSharedFolders] = useState([]);
  const [sharedPermissionPaths, setSharedPermissionPaths] = useState(new Set());
  
  // 모달이 열릴 때의 초기값들을 저장하기 위한 ref
  const prevOpenRef = useRef(false);
  const initialValuesRef = useRef({ currentPath: null, action: null, userId: null });

  useEffect(() => {
    // 모달이 닫혔다가 열릴 때만 초기화 (false -> true 전환)
    const wasClosed = !prevOpenRef.current;
    const isNowOpen = open;
    
    if (wasClosed && isNowOpen) {
      // 모달이 열릴 때의 초기값 저장
      const initialPath = currentPath || '/';
      initialValuesRef.current = {
        currentPath: initialPath,
        action: action,
        userId: user?.id,
      };
      
      // 모달 오픈 시 현재 위치를 기준으로 시작 (없으면 루트)
      setSelectedPath(initialPath);
      loadFolders(initialPath);
      // 복사 또는 이동 작업일 때 쓰기 권한 확인 (admin은 무조건 가능)
      if (action === 'copy' || action === 'move') {
        if (user?.is_admin) {
          setHasWritePermission(true);
        } else {
          checkWritePermission(initialPath);
        }
      } else {
        setHasWritePermission(true);
      }
      // 공유된 폴더 목록 로드 (일반 사용자만)
      if (user && !user.is_admin && (action === 'copy' || action === 'move')) {
        loadSharedFolders();
      }
    }
    
    // 이전 open 상태 업데이트
    prevOpenRef.current = open;
  }, [open]); // open만 의존성으로 사용

  const checkWritePermission = async (path) => {
    try {
      // 관리자는 항상 쓰기 가능하도록 처리
      if (user?.is_admin) {
        setHasWritePermission(true);
        return;
      }

      const permission = await checkPermission(path);
      setHasWritePermission(permission.hasWrite);
    } catch (error) {
      console.error('Failed to check permission:', error);
      // 에러 발생 시 기본값으로 관리자는 true, 일반 사용자는 자신의 폴더인지 확인
      if (user?.is_admin) {
        setHasWritePermission(true);
      } else {
        const userFolder = `/${user?.username || ''}`;
        setHasWritePermission(path.startsWith(userFolder));
      }
    }
  };

  const loadFolders = async (path) => {
    setLoading(true);
    try {
      // 공유됨 뷰인 경우 특별 처리
      if (path === '/__shared__') {
        // 공유된 폴더 목록을 가져옴
        const response = await axios.get(`/api/permissions/user/${user?.id}`);
        const userBaseFolder = `/${user?.username || ''}`;
        
        // 자기 자신의 폴더 및 그 하위 모든 디렉토리는 제외
        const sharedFolders = response.data.filter(perm => {
          const folderPath = normalizePath(perm.folder_path);
          const normalizedUserBaseFolder = normalizePath(userBaseFolder);
          
          // 사용자 기본 폴더로 시작하지 않는 경로만 포함
          return !folderPath.startsWith(normalizedUserBaseFolder + '/') && folderPath !== normalizedUserBaseFolder;
        });
        
        // 권한이 직접 부여된 경로를 정규화된 경로로 저장
        const permissionPaths = new Map();
        sharedFolders.forEach(perm => {
          const normalized = normalizePath(perm.folder_path);
          permissionPaths.set(normalized, perm);
        });
        
        // 최상위 디렉토리만 필터링 (부모 경로가 permissionPaths에 없으면 최상위)
        const topLevelFolders = Array.from(permissionPaths.entries()).filter(([normalizedPath, perm]) => {
          const pathParts = normalizedPath.split('/').filter(Boolean);
          // 부모 경로들을 확인
          for (let i = pathParts.length - 1; i > 0; i--) {
            const parentPath = '/' + pathParts.slice(0, i).join('/');
            if (permissionPaths.has(parentPath)) {
              return false; // 부모 경로가 있으면 최상위가 아님
            }
          }
          return true; // 부모 경로가 없으면 최상위
        });
        
        // 최상위 폴더들만 표시
        const sharedFolderList = topLevelFolders.map(([normalizedPath, perm]) => {
          const pathParts = normalizedPath.split('/').filter(Boolean);
          const name = pathParts[pathParts.length - 1] || normalizedPath;
          return {
            path: normalizedPath,
            basename: name,
            name: name,
            type: 'directory',
            size: 0,
            lastmodified: null,
            hasReadPermission: true,
            hasWritePermission: perm.permission === 'write' || perm.permission === 'admin'
          };
        });
        
        setFolders(sharedFolderList);
      } else {
        const data = await listFiles(path);
        // Only show directories
        const directories = data.filter(item => item.type === 'directory');
        setFolders(directories);
      }
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSharedFolders = async () => {
    if (!user || !user.id || user.is_admin) return;
    
    try {
      const response = await axios.get(`/api/permissions/user/${user.id}`);
      const userBaseFolder = `/${user?.username || ''}`;
      
      // 자기 자신의 폴더 및 그 하위 모든 디렉토리는 제외
      const filtered = response.data.filter(perm => {
        const folderPath = normalizePath(perm.folder_path);
        const normalizedUserBaseFolder = normalizePath(userBaseFolder);
        return !folderPath.startsWith(normalizedUserBaseFolder + '/') && folderPath !== normalizedUserBaseFolder;
      });
      
      // 권한이 직접 부여된 경로를 정규화된 경로로 저장
      const permissionPaths = new Map();
      filtered.forEach(perm => {
        const normalized = normalizePath(perm.folder_path);
        permissionPaths.set(normalized, perm);
      });
      
      // 전체 권한 경로 목록 저장 (breadcrumb 생성 시 사용)
      setSharedPermissionPaths(new Set(permissionPaths.keys()));
      
      // 최상위 디렉토리만 필터링 (부모 경로가 permissionPaths에 없으면 최상위)
      const topLevelFolders = Array.from(permissionPaths.keys()).filter(normalizedPath => {
        const pathParts = normalizedPath.split('/').filter(Boolean);
        // 부모 경로들을 확인
        for (let i = pathParts.length - 1; i > 0; i--) {
          const parentPath = '/' + pathParts.slice(0, i).join('/');
          if (permissionPaths.has(parentPath)) {
            return false; // 부모 경로가 있으면 최상위가 아님
          }
        }
        return true; // 부모 경로가 없으면 최상위
      });
      
      setSharedFolders(topLevelFolders);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolders([]);
      setSharedPermissionPaths(new Set());
    }
  };

  const handleFolderClick = (folder) => {
    // 권한이 없는 폴더는 클릭 불가
    const hasReadPermission = folder.hasReadPermission !== false;
    if (!hasReadPermission) {
      return;
    }
    
    const newPath = folder.path;
    setSelectedPath(newPath);
    loadFolders(newPath);
    // 복사 또는 이동 작업일 때 쓰기 권한 확인
    if (action === 'copy' || action === 'move') {
      // 공유됨 뷰에서 선택한 폴더의 경우 폴더의 권한 확인
      if (folder.hasWritePermission !== undefined) {
        setHasWritePermission(folder.hasWritePermission);
      } else {
        checkWritePermission(newPath);
      }
    }
  };

  const handlePathClick = (path) => {
    setSelectedPath(path);
    loadFolders(path);
    // 복사 또는 이동 작업일 때 쓰기 권한 확인
    if (action === 'copy' || action === 'move') {
      // 공유됨 뷰는 쓰기 권한 체크 불필요 (각 폴더별로 권한 확인)
      if (path === '/__shared__') {
        setHasWritePermission(true);
      } else {
        checkWritePermission(path);
      }
    }
  };

  const handleSelect = () => {
    // 공유됨 뷰에서는 선택 불가 (폴더를 선택해야 함)
    if (selectedPath === '/__shared__') {
      return;
    }
    // onSelect를 호출 (onSelect 내부에서 다이얼로그를 닫도록 처리)
    onSelect(selectedPath);
    // onSelect가 다이얼로그를 닫지 않는 경우를 대비해 onClose도 호출
    // (하지만 onSelect 내부에서 이미 닫았을 수 있으므로 중복 호출이 될 수 있음)
    // FileContextMenu와의 호환성을 위해 onClose도 호출
    onClose();
  };

  // 복사/이동 작업 시 유효하지 않은 대상인지 확인 (현위치, 자기 자신, 또는 하위 디렉토리)
  const isInvalidDestination = () => {
    if (action !== 'copy' && action !== 'move') return false;

    const normalizedSelectedPath = normalizePath(selectedPath);
    const sourcePaths = sourceFilePath ? [sourceFilePath] : (sourceFilePaths || []);

    return sourcePaths.some(path => {
      const normalizedSourcePath = normalizePath(path);
      
      // 1. 현위치 확인 (이동/복사하려는 파일의 부모 디렉토리가 현재 선택된 디렉토리인 경우)
      if (getParentPath(normalizedSourcePath) === normalizedSelectedPath) {
        return true;
      }

      // 2. 자기 자신 또는 하위 디렉토리 확인
      if (normalizedSelectedPath === normalizedSourcePath || 
          normalizedSelectedPath.startsWith(normalizedSourcePath + '/')) {
        return true;
      }

      return false;
    });
  };

  // 소스 파일 경로가 홈 디렉토리인지 공유됨 디렉토리인지 확인
  const isSourceInHome = () => {
    if (!action || (action !== 'copy' && action !== 'move')) return false;
    
    // admin의 경우 root('/') 또는 root 하위 경로는 모두 홈으로 간주
    if (user?.is_admin) {
      // 단일 파일
      if (sourceFilePath) {
        // root('/') 또는 root 하위 경로는 홈
        return sourceFilePath === '/' || sourceFilePath.startsWith('/');
      }
      
      // 다중 파일
      if (sourceFilePaths && sourceFilePaths.length > 0) {
        // 모든 파일이 root('/') 또는 root 하위 경로인지 확인
        return sourceFilePaths.every(filePath => filePath === '/' || filePath.startsWith('/'));
      }
      
      return false;
    }
    
    // 일반 사용자의 경우
    const userBaseFolder = `/${user?.username || ''}`;
    
    // 단일 파일
    if (sourceFilePath) {
      return sourceFilePath.startsWith(userBaseFolder);
    }
    
    // 다중 파일
    if (sourceFilePaths && sourceFilePaths.length > 0) {
      return sourceFilePaths.some(filePath => filePath.startsWith(userBaseFolder));
    }
    
    return false;
  };

  // 공유된 폴더의 최상위 경로 찾기
  const getSharedRootPath = () => {
    if (!action || (action !== 'copy' && action !== 'move')) return null;
    
    const userBaseFolder = `/${user?.username || ''}`;
    
    // 소스 파일 경로 가져오기
    let sourcePaths = [];
    if (sourceFilePath) {
      sourcePaths = [sourceFilePath];
    } else if (sourceFilePaths && sourceFilePaths.length > 0) {
      sourcePaths = sourceFilePaths;
    }
    
    if (sourcePaths.length === 0) return null;
    
    // 첫 번째 파일의 경로 사용
    const firstPath = normalizePath(sourcePaths[0]);
    
    // 홈 디렉토리에 속한 경우 null 반환
    if (firstPath.startsWith(userBaseFolder)) {
      return null;
    }
    
    // 공유된 폴더 목록에서 해당 경로의 최상위 경로 찾기
    // 가장 긴 매칭 경로를 찾아서 최상위 경로 반환
    let bestMatch = null;
    let bestMatchLength = 0;
    
    for (const sharedPath of sharedFolders) {
      const normalizedSharedPath = normalizePath(sharedPath);
      if (firstPath.startsWith(normalizedSharedPath + '/') || firstPath === normalizedSharedPath) {
        if (normalizedSharedPath.length > bestMatchLength) {
          bestMatch = normalizedSharedPath;
          bestMatchLength = normalizedSharedPath.length;
        }
      }
    }
    
    if (bestMatch) {
      return bestMatch;
    }
    
    // 공유된 폴더 목록에 없으면 파일 경로의 최상위 경로 반환
    const parts = firstPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      return `/${parts[0]}`;
    }
    
    return null;
  };

  // 홈/공유됨 토글 핸들러
  const handleTogglePath = (event, newValue) => {
    if (!newValue) return;
    
    const userBaseFolder = `/${user?.username || ''}`;
    const homePath = user?.is_admin ? '/' : userBaseFolder;
    const isSourceHome = isSourceInHome();
    
    if (newValue === 'home') {
      // 홈 버튼 클릭
      if (isSourceHome) {
        // 홈 디렉토리의 파일/폴더인 경우: 부모 디렉토리 표시
        let sourcePath = sourceFilePath;
        if (!sourcePath && sourceFilePaths && sourceFilePaths.length > 0) {
          sourcePath = sourceFilePaths[0];
        }
        if (sourcePath) {
          const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
          const normalizedParent = parentDir === '/' ? '/' : parentDir.replace(/\/$/, '');
          setSelectedPath(normalizedParent || homePath);
          loadFolders(normalizedParent || homePath);
          if (action === 'copy' || action === 'move') {
            checkWritePermission(normalizedParent || homePath);
          }
        } else {
          setSelectedPath(homePath);
          loadFolders(homePath);
          if (action === 'copy' || action === 'move') {
            checkWritePermission(homePath);
          }
        }
      } else {
        // 공유됨 디렉토리의 파일/폴더인 경우: 홈 루트 표시
        setSelectedPath(homePath);
        loadFolders(homePath);
        if (action === 'copy' || action === 'move') {
          checkWritePermission(homePath);
        }
      }
    } else if (newValue === 'shared') {
      // 공유됨 버튼 클릭
      if (isSourceHome) {
        // 홈 디렉토리의 파일/폴더인 경우: 공유받은 폴더 목록 표시
        setSelectedPath('/__shared__');
        loadFolders('/__shared__');
        // 공유됨 뷰는 쓰기 권한 체크 불필요 (각 폴더별로 권한 확인)
        setHasWritePermission(true);
      } else {
        // 공유됨 디렉토리의 파일/폴더인 경우: 부모 디렉토리 표시
        const sharedRoot = getSharedRootPath();
        if (sharedRoot) {
          let sourcePath = sourceFilePath;
          if (!sourcePath && sourceFilePaths && sourceFilePaths.length > 0) {
            sourcePath = sourceFilePaths[0];
          }
          if (sourcePath) {
            const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
            const normalizedParent = parentDir === '/' ? '/' : parentDir.replace(/\/$/, '');
            setSelectedPath(normalizedParent || sharedRoot);
            loadFolders(normalizedParent || sharedRoot);
            if (action === 'copy' || action === 'move') {
              checkWritePermission(normalizedParent || sharedRoot);
            }
          } else {
            setSelectedPath(sharedRoot);
            loadFolders(sharedRoot);
            if (action === 'copy' || action === 'move') {
              checkWritePermission(sharedRoot);
            }
          }
        }
      }
    }
  };

  // 현재 경로가 홈인지 공유됨인지 확인
  const getCurrentPathType = () => {
    const userBaseFolder = `/${user?.username || ''}`;
    const homePath = user?.is_admin ? '/' : userBaseFolder;
    
    if (selectedPath === '/__shared__') {
      return 'shared';
    }
    
    if (user?.is_admin) {
      return selectedPath?.startsWith('/') ? 'home' : 'shared';
    }
    
    if (selectedPath === homePath || selectedPath.startsWith(homePath + '/')) {
      return 'home';
    }
    return 'shared';
  };

  // Build breadcrumbs
  const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
  const homeLabel = user?.is_admin ? 'root' : '홈';
  let breadcrumbs = [];
  
  const isHomePath = user?.is_admin
    ? (selectedPath?.startsWith('/') && selectedPath !== '/__shared__')
    : (selectedPath === homePath || selectedPath.startsWith(homePath + '/'));
  
  if (selectedPath === '/__shared__') {
    // 공유됨 뷰인 경우
    breadcrumbs = [{ name: '공유됨', path: '/__shared__' }];
  } else if (isHomePath) {
    // 홈 디렉토리인 경우
    const pathParts = selectedPath.split('/').filter(Boolean);
    breadcrumbs = [
      { name: homeLabel, path: homePath },
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
  } else {
    // 공유받은 폴더 경로인 경우
    // 권한이 없는 부모 경로만 제외하고, 권한이 있는 경로는 계층 구조 유지
    const normalizedSelectedPath = normalizePath(selectedPath);
    const pathParts = normalizedSelectedPath.split('/').filter(Boolean);
    
    // 각 경로 부분이 권한이 있는 경로의 일부인지 확인
    // 권한이 있는 경로의 시작 인덱스 찾기
    let startIndex = -1;
    for (let i = 0; i < pathParts.length; i++) {
      const testPath = '/' + pathParts.slice(0, i + 1).join('/');
      // 이 경로가 권한이 있는 경로인지, 또는 권한이 있는 경로의 일부인지 확인
      if (sharedPermissionPaths.has(testPath)) {
        startIndex = i;
        break;
      }
    }
    
    if (startIndex >= 0) {
      // 권한이 있는 경로부터 breadcrumb 생성 (하위 폴더로 이동할 때도 계층 구조 유지)
      breadcrumbs = [
        { name: '공유됨', path: '/__shared__' },
        ...pathParts.slice(startIndex).map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, startIndex + index + 1).join('/'),
        })),
      ];
    } else {
      // 권한이 있는 경로를 찾지 못한 경우 (fallback)
      breadcrumbs = [
        { name: '공유됨', path: '/__shared__' },
        ...pathParts.map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, index + 1).join('/'),
        })),
      ];
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{title || '폴더 선택'}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            현재 선택된 경로:
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <Breadcrumbs
              separator={<ChevronRightIcon fontSize="small" />}
              aria-label="breadcrumb"
              sx={{ 
                p: 1.5, 
                backgroundColor: 'grey.100', 
                borderRadius: (action === 'copy' || action === 'move') && user && !user.is_admin ? '4px 0 0 4px' : '4px',
                flexWrap: 'wrap',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {breadcrumbs.map((crumb, index) => (
                <Link
                  key={index}
                  component="button"
                  variant="body2"
                  onClick={() => handlePathClick(crumb.path)}
                  sx={{ 
                    cursor: 'pointer', 
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  {index === 0 && crumb.path === '/__shared__' && <ShareIcon sx={{ mr: 0.5, fontSize: 18 }} />}
                  {index === 0 && crumb.path !== '/__shared__' && <HomeIcon sx={{ mr: 0.5, fontSize: 18 }} />}
                  {crumb.name || '홈'}
                </Link>
              ))}
            </Breadcrumbs>
            {(action === 'copy' || action === 'move') && user && !user.is_admin && (
              <Tooltip title={getCurrentPathType() === 'home' ? '공유됨으로 전환' : '홈으로 전환'}>
                <IconButton
                  onClick={() => handleTogglePath(null, getCurrentPathType() === 'home' ? 'shared' : 'home')}
                  size="small"
                  sx={{
                    border: 1,
                    borderColor: 'grey.100',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                    backgroundColor: 'background.paper',
                    height: '100%',
                    minHeight: '48px',
                    px: 1.5,
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  {getCurrentPathType() === 'home' ? (
                    <ShareIcon fontSize="small" />
                  ) : (
                    <HomeIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, minHeight: 300, maxHeight: 400, overflow: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <CircularProgress />
            </Box>
          ) : folders.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <Typography color="text.secondary">하위 폴더가 없습니다</Typography>
            </Box>
          ) : (
            <List>
              {folders.map((folder, index) => {
                const hasReadPermission = folder.hasReadPermission !== false; // undefined나 true면 권한 있음
                const isDisabled = !hasReadPermission;
                const isHidden = folder.isHidden || folder.basename.startsWith('.');
                
                return (
                  <ListItem key={index} disablePadding>
                    <ListItemButton 
                      onClick={() => handleFolderClick(folder)}
                      disabled={isDisabled}
                      sx={{
                        opacity: isDisabled ? 0.5 : (isHidden ? 0.5 : 1),
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        '&:hover': {
                          backgroundColor: isDisabled ? 'transparent' : undefined,
                        },
                      }}
                    >
                      <ListItemIcon>
                        <FolderIcon color={isDisabled ? "disabled" : "primary"} />
                      </ListItemIcon>
                      <ListItemText 
                        primary={folder.basename}
                        primaryTypographyProps={{
                          sx: {
                            color: isDisabled ? 'text.disabled' : 'text.primary',
                          },
                        }}
                      />
                      {!isDisabled && <ChevronRightIcon color="action" />}
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button 
          onClick={handleSelect} 
          variant="contained" 
          color="primary"
          disabled={
            (selectedPath === '/__shared__') ||
            ((action === 'copy' || action === 'move') && !hasWritePermission) ||
            isInvalidDestination()
          }
        >
          선택
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderPickerDialog;

