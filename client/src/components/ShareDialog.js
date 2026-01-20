import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Chip,
  Menu,
  MenuItem,
  ListItemText,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  GroupAdd as GroupAddIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { useResponsive } from '../hooks/useResponsive';

// mode: 'admin' | 'share'
// admin mode: userId, username 필요, onSave 필요
// share mode: folderPath, folderName 필요, user 필요
const ShareDialog = ({ 
  open, 
  onClose, 
  mode = 'share',
  // Admin mode props
  userId = null,
  username = null,
  onSave = null,
  startFromUserHome = false, // admin 모드에서 사용자 홈 디렉토리부터 시작할지 여부 (기본값: false, root부터 시작)
  // Share mode props
  folderPath = null,
  folderName = null,
  user = null,
  // Common props
  onMessage = null
}) => {
  const { isMobile } = useResponsive();
  const isAdminMode = mode === 'admin';
  const isShareMode = mode === 'share';
  
  // Admin mode: startFromUserHome이 true이면 사용자 홈 디렉토리부터, 아니면 root부터 시작
  // Share mode: 선택한 폴더부터 시작
  const rootPath = isAdminMode 
    ? (startFromUserHome && username ? `/${username}` : '/')
    : (folderPath && folderPath !== '/' && folderPath.endsWith('/') ? folderPath.slice(0, -1) : (folderPath || '/'));
  
  const [users, setUsers] = useState([]);
  const [, setLoadingUsers] = useState(false);
  const [folderTree, setFolderTree] = useState(new Map());
  // folderPermissions: Map<folderPath, Map<userId, permission>>
  const [folderPermissions, setFolderPermissions] = useState(new Map());
  // userInfoMap: Map<userId, {username, email}> - 권한 정보에서 가져온 사용자 정보
  const [userInfoMap, setUserInfoMap] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState(null);
  const [folderMenuPath, setFolderMenuPath] = useState(null);
  const [folderMenuView, setFolderMenuView] = useState('manage'); // 'manage' | 'selectUser'

  useEffect(() => {
    if (open) {
      if (isShareMode) {
        loadUsers();
      }
      initializeDialog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rootPath, isAdminMode, isShareMode, userId, username]);

  const initializeDialog = async () => {
    setFolderPermissions(new Map());
    setUserInfoMap(new Map());
    setExpandedPaths(new Set([rootPath]));
    setFolderTree(new Map());
    setLoadingPaths(new Set());
    
    try {
      if (isAdminMode) {
        // 관리자 모드: root부터 시작 또는 사용자 홈 디렉토리부터 시작
        const userBaseFolder = `/${username}`;
        await loadFolderChildren(rootPath);
        
        // Load user permissions
        if (userId) {
          const permResponse = await axios.get(`/api/users/${userId}/permissions`);
          
          // 경로 정규화 헬퍼 함수
          const normalizePath = (p) => {
            if (!p || p === '/') return '/';
            return p.endsWith('/') ? p.slice(0, -1) : p;
          };
          
          // folderPermissions 초기화: Map<folderPath, Map<userId, permission>>
          const newFolderPermissions = new Map();
          
          // startFromUserHome이 true이면 사용자 홈 디렉토리 하위 경로만 필터링
          // false이면 모든 권한 표시
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            let shouldInclude = true;
            
            if (startFromUserHome) {
              // 사용자 홈 디렉토리 하위 경로만 포함
              shouldInclude = normalizedPath === userBaseFolder || normalizedPath.startsWith(userBaseFolder + '/');
            }
            // startFromUserHome이 false이면 모든 경로 포함
            
            if (shouldInclude) {
              if (!newFolderPermissions.has(normalizedPath)) {
                newFolderPermissions.set(normalizedPath, new Map());
              }
              const userPermMap = newFolderPermissions.get(normalizedPath);
              userPermMap.set(userId, perm.permission);
            }
          });
          
          // 사용자 기본 폴더는 항상 쓰기 권한으로 설정 (startFromUserHome인 경우만)
          if (startFromUserHome) {
            if (!newFolderPermissions.has(userBaseFolder)) {
              newFolderPermissions.set(userBaseFolder, new Map());
            }
            const userBasePermMap = newFolderPermissions.get(userBaseFolder);
            userBasePermMap.set(userId, 'write');
          }
          
          setFolderPermissions(newFolderPermissions);
          
          // 권한에 있는 경로들의 부모 경로들을 folderTree에 로드하려고 시도 (에러는 무시)
          const pathsToLoad = new Set();
          permResponse.data.forEach(perm => {
            const folderPath = perm.folder_path;
            const normalizedPath = normalizePath(folderPath);
            
            let shouldInclude = true;
            if (startFromUserHome) {
              // 사용자 홈 디렉토리 하위 경로만 포함
              shouldInclude = normalizedPath === userBaseFolder || normalizedPath.startsWith(userBaseFolder + '/');
            }
            
            if (shouldInclude) {
              const parts = normalizedPath.split('/').filter(Boolean);
              
              // 경로 수집: startFromUserHome이면 사용자 홈 디렉토리부터, 아니면 root부터
              const startIndex = startFromUserHome ? 1 : 0;
              for (let i = startIndex; i <= parts.length; i++) {
                const parentPath = '/' + parts.slice(0, i).join('/');
                const normalizedParentPath = normalizePath(parentPath);
                if (normalizedParentPath && normalizedParentPath !== '') {
                  pathsToLoad.add(normalizedParentPath || '/');
                }
              }
            }
          });
          
          // 각 경로의 부모를 순차적으로 로드 (에러는 무시)
          const sortedPaths = Array.from(pathsToLoad).sort((a, b) => {
            const aDepth = a === '/' ? 0 : a.split('/').filter(Boolean).length;
            const bDepth = b === '/' ? 0 : b.split('/').filter(Boolean).length;
            return aDepth - bDepth;
          });
          
          // 부모 경로부터 하위 경로 순서로 로드 시도 (실패해도 계속 진행)
          const expandedPathsSet = new Set([rootPath]); // rootPath는 항상 확장
          
          for (const pathToLoad of sortedPaths) {
            if (pathToLoad === rootPath) continue; // rootPath는 이미 로드됨
            
            try {
              const parentPath = pathToLoad.split('/').slice(0, -1).join('/') || '/';
              
              // 부모 폴더가 folderTree에 없으면 로드 시도
              if (!folderTree.has(parentPath)) {
                await loadFolderChildren(parentPath);
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              
              // 확장 상태 설정
              expandedPathsSet.add(parentPath);
            } catch (err) {
              // 경로 로드 실패해도 계속 진행 (폴더가 존재하지 않을 수 있음)
              continue;
            }
          }
          
          // 확장 상태 설정
          setExpandedPaths(expandedPathsSet);
        }
      } else {
        // 공유 모드: 선택한 폴더부터 시작
        const selectedFolder = {
          path: rootPath,
          name: folderName,
          children: []
        };
        setFolderTree(new Map([[rootPath, selectedFolder]]));
        
        // 선택한 폴더의 하위 폴더 로드
        await loadFolderChildren(rootPath);
        
        // 선택한 폴더와 모든 하위 폴더의 권한 정보 로드
        try {
          const normalizePath = (p) => {
            if (!p || p === '/') return '/';
            return p.endsWith('/') ? p.slice(0, -1) : p;
          };
          
          // 하위 폴더 포함하여 권한 정보 가져오기
          const permResponse = await axios.get('/api/permissions/folder', {
            params: {
              path: rootPath,
              includeSubfolders: 'true'
            }
          });
          
          // folderPermissions 초기화: Map<folderPath, Map<userId, permission>>
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();
          
          // DB에 있는 모든 권한을 folderPermissions에 추가
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            if (!newFolderPermissions.has(normalizedPath)) {
              newFolderPermissions.set(normalizedPath, new Map());
            }
            const userPermMap = newFolderPermissions.get(normalizedPath);
            userPermMap.set(perm.id, perm.permission);
            
            // 사용자 정보도 함께 저장 (is_admin 포함)
            if (perm.id && perm.username) {
              newUserInfoMap.set(perm.id, {
                username: perm.username,
                email: perm.email || '',
                is_admin: Boolean(perm.is_admin)
              });
            }
          });
          
          setFolderPermissions(newFolderPermissions);
          setUserInfoMap(newUserInfoMap);
          
          // 사용자 홈 디렉토리인 경우: 하위의 모든 폴더를 재귀적으로 로드
          const userBaseFolder = user && user.username ? `/${user.username}` : null;
          const isUserHomeFolder = userBaseFolder && rootPath === userBaseFolder;
          
          if (isUserHomeFolder) {
            // 사용자 홈 디렉토리 하위의 모든 폴더를 재귀적으로 로드
            const loadAllSubfolders = async (parentPath) => {
              try {
                const children = await loadFolderChildren(parentPath);
                const expandedPathsSet = new Set([rootPath]);
                
                for (const child of children) {
                  expandedPathsSet.add(parentPath);
                  await loadAllSubfolders(child.path);
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                return expandedPathsSet;
              } catch (err) {
                return new Set([rootPath]);
              }
            };
            
            const expandedPathsSet = await loadAllSubfolders(rootPath);
            setExpandedPaths(expandedPathsSet);
          } else {
            // 일반 공유 모드: 권한에 있는 경로들의 부모 경로들을 folderTree에 로드
            const pathsToLoad = new Set();
            permResponse.data.forEach(perm => {
              const folderPath = perm.folder_path;
              const normalizedPath = normalizePath(folderPath);
              const parts = normalizedPath.split('/').filter(Boolean);
              
              // 모든 부모 경로들을 수집
              for (let i = 0; i <= parts.length; i++) {
                const parentPath = '/' + parts.slice(0, i).join('/');
                const normalizedParentPath = normalizePath(parentPath);
                if (normalizedParentPath && normalizedParentPath !== '') {
                  pathsToLoad.add(normalizedParentPath || '/');
                }
              }
            });
            
            // 각 경로의 부모를 순차적으로 로드 (에러는 무시)
            const sortedPaths = Array.from(pathsToLoad).sort((a, b) => {
              const aDepth = a === '/' ? 0 : a.split('/').filter(Boolean).length;
              const bDepth = b === '/' ? 0 : b.split('/').filter(Boolean).length;
              return aDepth - bDepth;
            });
            
            // 부모 경로부터 하위 경로 순서로 로드 시도 (실패해도 계속 진행)
            const expandedPathsSet = new Set([rootPath]); // 선택한 폴더는 항상 확장
            
            for (const pathToLoad of sortedPaths) {
              if (pathToLoad === rootPath) continue; // 선택한 폴더는 이미 로드됨
              
              try {
                const parentPath = pathToLoad.split('/').slice(0, -1).join('/') || '/';
                
                // 부모 폴더가 folderTree에 없으면 로드 시도
                if (!folderTree.has(parentPath)) {
                  await loadFolderChildren(parentPath);
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                // 확장 상태 설정 (선택한 폴더의 하위 경로인 경우만)
                if (pathToLoad.startsWith(rootPath + '/') || pathToLoad === rootPath) {
                  expandedPathsSet.add(parentPath);
                }
              } catch (err) {
                // 경로 로드 실패해도 계속 진행 (폴더가 존재하지 않을 수 있음)
                continue;
              }
            }
            
            // 확장 상태 설정
            setExpandedPaths(expandedPathsSet);
          }
        } catch (error) {
          // 권한 정보 로드 실패는 조용히 처리 (권한이 없을 수도 있음)
          console.log('Failed to load folder permissions:', error);
        }
      }
    } catch (error) {
      console.error('Failed to initialize dialog:', error);
      if (onMessage) {
        onMessage({
          text: '다이얼로그 초기화에 실패했습니다.',
          type: 'error'
        });
      }
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await axios.get('/api/users/approved');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to load users:', error);
      if (onMessage) {
        onMessage({
          text: '사용자 목록을 불러오는데 실패했습니다.',
          type: 'error'
        });
      }
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadFolderChildren = async (path) => {
    if (loadingPaths.has(path)) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!loadingPaths.has(path)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
    }
    
    setLoadingPaths(prev => new Set(prev).add(path));
    try {
      const response = await axios.get('/api/files/list', {
        params: { path }
      });
      
      const folders = response.data
        .filter(item => item.type === 'directory')
        .map(folder => ({
          path: folder.path,
          name: folder.basename || folder.name,
          children: []
        }));
      
      setFolderTree(prev => {
        const newMap = new Map(prev);
        // Get or create current node
        let current = newMap.get(path);
        if (!current) {
          current = {
            path,
            name: path === '/' ? 'Root' : path.split('/').filter(Boolean).pop() || 'Root',
            children: []
          };
        }
        current.children = folders;
        newMap.set(path, current);
        // Add child nodes to map
        folders.forEach(folder => {
          if (!newMap.has(folder.path)) {
            newMap.set(folder.path, folder);
          }
        });
        return newMap;
      });
      
      return folders;
    } catch (error) {
      // 404 에러는 존재하지 않는 폴더이므로 조용히 처리
      if (error.response?.status === 404) {
        console.log(`Folder not found (404): ${path}, skipping...`);
        return [];
      }
      console.error(`Failed to load folder children for ${path}:`, error);
      // 404가 아닌 다른 에러는 조용히 처리 (존재하지 않는 경로는 정상적인 경우)
      return [];
    } finally {
      setLoadingPaths(prev => {
        const newSet = new Set(prev);
        newSet.delete(path);
        return newSet;
      });
    }
  };

  const toggleExpand = async (path) => {
    const wasExpanded = expandedPaths.has(path);
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
    
    // Load children if expanding
    if (!wasExpanded) {
      const node = folderTree.get(path);
      if (node && (!node.children || node.children.length === 0)) {
        await loadFolderChildren(path);
      }
    }
  };

  const handleAddUser = (folderPath, targetUserId = null, targetUsername = null) => {
    if (isAdminMode) {
      // 관리자 모드: 선택한 사용자를 바로 추가
      if (!userId) return;
      
      const newFolderPermissions = new Map(folderPermissions);
      if (!newFolderPermissions.has(folderPath)) {
        newFolderPermissions.set(folderPath, new Map());
      }
      const userPermMap = newFolderPermissions.get(folderPath);
      userPermMap.set(userId, 'read'); // 기본 권한은 읽기
      setFolderPermissions(newFolderPermissions);
    } else {
      // 공유 모드: (단일 메뉴 내) 사용자 선택 뷰로 전환
      setFolderMenuPath(folderPath);
      setFolderMenuView('selectUser');
    }
  };

  const handleUserSelect = (selectedUserId, selectedUsername) => {
    if (!folderMenuPath) return;
    
    const newFolderPermissions = new Map(folderPermissions);
    if (!newFolderPermissions.has(folderMenuPath)) {
      newFolderPermissions.set(folderMenuPath, new Map());
    }
    const userPermMap = newFolderPermissions.get(folderMenuPath);
    userPermMap.set(selectedUserId, 'read'); // 기본 권한은 읽기
    setFolderPermissions(newFolderPermissions);
    
    // 사용자 정보도 함께 저장 (is_admin 포함)
    const selectedUser = users.find(u => u.id === selectedUserId);
    if (selectedUser) {
      setUserInfoMap(prev => {
        const newMap = new Map(prev);
        newMap.set(selectedUserId, {
          username: selectedUser.username,
          email: selectedUser.email || '',
          is_admin: Boolean(selectedUser.is_admin)
        });
        return newMap;
      });
    }
    
    // 메뉴는 같은 위치에서 유지, 사용자 선택 뷰에서 관리 뷰로 복귀
    setFolderMenuView('manage');
  };

  const handleRemoveUser = (folderPath, targetUserId) => {
    const newFolderPermissions = new Map(folderPermissions);
    const userPermMap = newFolderPermissions.get(folderPath);
    if (userPermMap) {
      userPermMap.delete(targetUserId);
      if (userPermMap.size === 0) {
        newFolderPermissions.delete(folderPath);
      }
    }
    setFolderPermissions(newFolderPermissions);
  };

  const handleTogglePermission = (folderPath, targetUserId) => {
    const newFolderPermissions = new Map(folderPermissions);
    const userPermMap = newFolderPermissions.get(folderPath);
    if (userPermMap) {
      const currentPermission = userPermMap.get(targetUserId) || 'read';
      const newPermission = currentPermission === 'read' ? 'write' : 'read';
      userPermMap.set(targetUserId, newPermission);
    }
    setFolderPermissions(newFolderPermissions);
  };

  const getUserName = (targetUserId) => {
    if (isAdminMode) {
      return username;
    } else {
      // 먼저 userInfoMap에서 찾기 (권한 정보에서 가져온 사용자 정보)
      if (userInfoMap.has(targetUserId)) {
        return userInfoMap.get(targetUserId).username;
      }
      // 없으면 users 배열에서 찾기
      const user = users.find(u => u.id === targetUserId);
      return user ? user.username : '';
    }
  };

  const renderFolderTree = (rootPath, level = 0) => {
    const node = folderTree.get(rootPath);
    if (!node) return null;
    
    const isExpanded = expandedPaths.has(node.path);
    const isLoading = loadingPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <Box key={node.path} sx={{ width: '100%' }}>
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            py: 0.5, 
            pl: level * 1, 
            width: '100%',
          }}
        >
          {/* 왼쪽: 폴더 트리 */}
          <Box sx={{ display: 'flex', alignItems: 'center', flex: '1 0 0', minWidth: 0 }}>
            <IconButton
              size="small"
              onClick={() => toggleExpand(node.path)}
              disabled={isLoading}
              sx={{ mr: 0.5, flexShrink: 0 }}
            >
              {isLoading ? (
                <CircularProgress size={16} />
              ) : isExpanded ? (
                <ExpandMoreIcon />
              ) : (
                <ChevronRightIcon />
              )}
            </IconButton>
            {isExpanded ? <FolderOpenIcon sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} /> : <FolderIcon sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />}
            <Box
              sx={{
                flex: '1 0 0',
                minWidth: 0,
                mr: 1,
                overflow: 'hidden',
                position: 'relative',
              }}
              onMouseEnter={isMobile ? undefined : (e) => {
                const container = e.currentTarget;
                const text = container.querySelector('span');
                if (text) {
                  const isOverflowing = text.scrollWidth > container.clientWidth;
                  if (isOverflowing) {
                    const scrollDistance = text.scrollWidth - container.clientWidth;
                    container.style.setProperty('--scroll-distance', `${scrollDistance}px`);
                    
                    // 일정한 속도로 스크롤 (50px/초 기준)
                    const scrollSpeed = 50; // 픽셀/초
                    const scrollTime = scrollDistance / scrollSpeed; // 스크롤 시간
                    const animationDuration = scrollTime + 0.5; // 스크롤 시간 + 0.5초 멈춤
                    const scrollPercentage = (scrollTime / animationDuration) * 100; // 멈춤 전까지의 비율
                    
                    // 동적 keyframes 생성
                    const animationName = `scrollText-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    const keyframes = `
                      @keyframes ${animationName} {
                        0% { transform: translateX(0); }
                        ${scrollPercentage}% { transform: translateX(calc(-1 * ${scrollDistance}px)); }
                        100% { transform: translateX(calc(-1 * ${scrollDistance}px)); }
                      }
                    `;
                    
                    // 기존 스타일 제거 후 새 스타일 추가
                    const styleId = `style-${animationName}`;
                    let styleElement = document.getElementById(styleId);
                    if (!styleElement) {
                      styleElement = document.createElement('style');
                      styleElement.id = styleId;
                      document.head.appendChild(styleElement);
                    }
                    styleElement.textContent = keyframes;
                    
                    // 애니메이션을 재시작하기 위해 먼저 초기화
                    text.style.animation = 'none';
                    text.style.transform = 'translateX(0)';
                    // 다음 프레임에서 애니메이션 시작
                    setTimeout(() => {
                      text.style.animation = `${animationName} ${animationDuration}s linear infinite`;
                    }, 10);
                  }
                }
              }}
              onMouseLeave={isMobile ? undefined : (e) => {
                const text = e.currentTarget.querySelector('span');
                if (text) {
                  text.style.animation = 'none';
                  text.style.transform = 'translateX(0)';
                }
              }}
            >
              <Typography
                variant="body2"
                component="span"
                sx={{
                  display: 'inline-block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {node.name || node.path}
              </Typography>
            </Box>
          </Box>
          
          {/* 오른쪽: 드롭다운 메뉴 버튼 */}
          {(() => {
            // 현재 폴더의 사용자 개수 계산 (추가 아이템 제외)
            const currentFolderUserPerms = folderPermissions.get(node.path) || new Map();
            const currentFolderUsers = Array.from(currentFolderUserPerms.entries());
            
            const currentDisplayUsers = isAdminMode 
              ? currentFolderUsers.filter(([uid]) => uid === userId)
              : currentFolderUsers.filter(([targetUserId]) => {
                  if (user && targetUserId === user.id) return false;
                  const userInfo = userInfoMap.get(targetUserId);
                  if (userInfo && userInfo.is_admin) return false;
                  const fullUser = users.find(u => u.id === targetUserId);
                  if (fullUser && fullUser.is_admin) return false;
                  return true;
                });
            
            const userCount = currentDisplayUsers.filter(([targetUserId]) => {
              const userName = getUserName(targetUserId);
              return userName && userName.trim() !== '';
            }).length;
            
            return (
              <Box
                component="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderMenuAnchor(e.currentTarget);
                  setFolderMenuPath(node.path);
                }}
                sx={{ 
                  display: 'flex',
                  alignItems: 'center',
                  border: 'none',
                  borderRadius: '20px',
                  backgroundColor: 'grey.300',
                  color: 'text.primary',
                  cursor: 'pointer',
                  flexShrink: 0,
                  height: 28,
                  pl: 1,
                  pr: 0,
                  gap: 0.5,
                  '&:hover': {
                    backgroundColor: 'grey.400',
                  }
                }}
              >
                <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                  {userCount}
                </Typography>
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: 'success.main',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <GroupAddIcon sx={{ fontSize: 16 }} />
                </Box>
              </Box>
            );
          })()}
        </Box>
        
        {isExpanded && hasChildren && (
          <Box sx={{ pl: 1 }}>
            {node.children.map(child => renderFolderTree(child.path, level + 1))}
          </Box>
        )}
      </Box>
    );
  };

  const handleSave = async () => {
    if (isAdminMode) {
      // 관리자 모드: 사용자 권한 일괄 업데이트
      try {
        const userBaseFolder = `/${username}`;
        const permissions = [];
        
        folderPermissions.forEach((userPermMap, folderPath) => {
          userPermMap.forEach((permission, targetUserId) => {
            if (targetUserId === userId) {
              permissions.push({
                folderPath,
                permission: folderPath === userBaseFolder ? 'write' : permission // 사용자 기본 폴더는 항상 쓰기
              });
            }
          });
        });
        
        await axios.put(`/api/users/${userId}/permissions`, { permissions });
        
        if (onSave) {
          onSave();
        }
        
        if (onMessage) {
          onMessage({
            text: '권한이 저장되었습니다.',
            type: 'success'
          });
        }
        
        onClose();
      } catch (error) {
        console.error('Failed to save permissions:', error);
        if (onMessage) {
          onMessage({
            text: '권한 저장에 실패했습니다.',
            type: 'error'
          });
        }
      }
    } else {
      // 공유 모드: 각 폴더의 각 사용자에게 권한 부여
      if (folderPermissions.size === 0) {
        if (onMessage) {
          onMessage({
            text: '공유할 폴더를 선택해주세요.',
            type: 'error'
          });
        }
        return;
      }

      setSaving(true);
      try {
        // 경로 정규화 헬퍼 함수 (끝의 슬래시 제거)
        const normalizePath = (p) => {
          if (!p || p === '/') return '/';
          return p.endsWith('/') ? p.slice(0, -1) : p;
        };
        
        // 각 폴더의 각 사용자에 대해 권한 부여
        for (const [folderPath, userPermMap] of folderPermissions.entries()) {
          const normalizedPath = normalizePath(folderPath);
          
          for (const [targetUserId, permission] of userPermMap.entries()) {
            try {
              await axios.post('/api/permissions/grant', {
                userId: targetUserId,
                folderPath: normalizedPath,
                permission: permission
              });
            } catch (error) {
              console.error(`Failed to grant permission for ${normalizedPath}:`, error);
              throw error;
            }
          }
        }
        
        if (onMessage) {
          onMessage({
            text: '폴더 공유가 완료되었습니다.',
            type: 'success'
          });
        }
        
        onClose();
      } catch (error) {
        console.error('Failed to share folder:', error);
        const errorMsg = error.response?.data?.error || '폴더 공유에 실패했습니다.';
        if (onMessage) {
          onMessage({
            text: errorMsg,
            type: 'error'
          });
        }
      } finally {
        setSaving(false);
      }
    }
  };

  const handleClose = () => {
    setFolderPermissions(new Map());
    setFolderTree(new Map());
    setExpandedPaths(new Set());
    setFolderMenuAnchor(null);
    setFolderMenuPath(null);
    setFolderMenuView('manage');
    setUserInfoMap(new Map());
    onClose();
  };

  const dialogTitle = isAdminMode 
    ? `권한 설정 - ${username}` 
    : `폴더 공유 - ${folderName}`;

  return (
    <>
      <style>
        {`
          @keyframes scrollText {
            0% { transform: translateX(0); }
            87.5% { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
            100% { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
          }
        `}
      </style>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullScreen={isMobile}
        PaperProps={{
          sx: isMobile ? {} : { 
            width: '49%',
            maxWidth: '49%',
            height: '70vh',
            maxHeight: '70vh'
          }
        }}
      >
        <DialogTitle>
          {dialogTitle}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'hidden' }}>
          {/* 폴더 트리 영역 */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {folderTree.size === 0 ? (
              <Typography variant="body2" color="text.secondary">
                폴더를 불러오는 중...
              </Typography>
            ) : (isAdminMode && startFromUserHome && username) || (isShareMode && user && rootPath === `/${user.username}`) ? (
              // 관리자 모드에서 startFromUserHome이 true이거나 공유 모드에서 사용자 홈 디렉토리: 사용자 홈 디렉토리는 표시하지 않고 하위 폴더들만 표시
              (() => {
                const userBaseNode = folderTree.get(rootPath);
                if (!userBaseNode || !userBaseNode.children || userBaseNode.children.length === 0) {
                  return (
                    <Typography variant="body2" color="text.secondary">
                      하위 폴더가 없습니다.
                    </Typography>
                  );
                }
                return userBaseNode.children.map(child => renderFolderTree(child.path, 0));
              })()
            ) : (
              renderFolderTree(rootPath, 0)
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose} disabled={saving}>
            취소
          </Button>
          <Button 
            onClick={handleSave} 
            variant="contained" 
            color="primary" 
            disabled={saving} 
            sx={{ ml: 1 }}
          >
            {saving ? '저장 중...' : '확인'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 폴더별 사용자 관리 드롭다운 메뉴 */}
      <Menu
        anchorEl={folderMenuAnchor}
        open={Boolean(folderMenuAnchor)}
        onClose={() => {
          setFolderMenuAnchor(null);
          setFolderMenuPath(null);
          setFolderMenuView('manage');
        }}
        PaperProps={{
          style: {
            maxHeight: '75vh',
            minWidth: 200,
          },
        }}
      >
        {folderMenuPath && (() => {
          const currentFolderUserPerms = folderPermissions.get(folderMenuPath) || new Map();
          const currentFolderUsers = Array.from(currentFolderUserPerms.entries());
          
          // 현재 폴더의 사용자들 표시
          const currentDisplayUsers = isAdminMode 
            ? currentFolderUsers.filter(([uid]) => uid === userId)
            : currentFolderUsers.filter(([targetUserId]) => {
                if (user && targetUserId === user.id) return false;
                const userInfo = userInfoMap.get(targetUserId);
                if (userInfo && userInfo.is_admin) return false;
                const fullUser = users.find(u => u.id === targetUserId);
                if (fullUser && fullUser.is_admin) return false;
                return true;
              });
          
          const currentUserBaseFolder = isAdminMode ? `/${username}` : null;
          const currentIsUserBaseFolder = isAdminMode && folderMenuPath === currentUserBaseFolder;
          
          const renderManageView = () => (
            <>
              {currentDisplayUsers
                .filter(([targetUserId]) => {
                  const userName = getUserName(targetUserId);
                  return userName && userName.trim() !== '';
                })
                .map(([targetUserId, permission]) => {
                  const userName = getUserName(targetUserId);
                  const canEdit = !currentIsUserBaseFolder || targetUserId !== userId;
                  const isWrite = permission === 'write';
                  
                  return (
                    <MenuItem
                      key={targetUserId}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      sx={{ py: 0.5 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
                        <Chip
                          label={userName}
                          size="small"
                          avatar={
                            <Box
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canEdit) {
                                  handleTogglePermission(folderMenuPath, targetUserId);
                                }
                              }}
                              sx={{ 
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                backgroundColor: isWrite ? 'primary.main' : 'grey.400',
                                cursor: canEdit ? 'pointer' : 'default',
                                '&:hover': canEdit ? { opacity: 0.8 } : {},
                                marginLeft: '4px',
                                marginRight: '-4px'
                              }}
                            >
                              <EditIcon sx={{ fontSize: 12, color: 'white' }} />
                            </Box>
                          }
                          onDelete={(e) => {
                            e.stopPropagation();
                            if (canEdit) {
                              handleRemoveUser(folderMenuPath, targetUserId);
                            }
                          }}
                          deleteIcon={<CloseIcon />}
                          sx={{ 
                            backgroundColor: 'grey.200',
                            border: 'none',
                            flex: 1,
                            '& .MuiChip-avatar': {
                              marginLeft: '4px',
                              marginRight: '-4px'
                            }
                          }}
                        />
                      </Box>
                    </MenuItem>
                  );
                })}
              
              {/* 구분선 */}
              {currentDisplayUsers.filter(([targetUserId]) => {
                const userName = getUserName(targetUserId);
                return userName && userName.trim() !== '';
              }).length > 0 && (
                <MenuItem disabled sx={{ py: 0 }}>
                  <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
                </MenuItem>
              )}
              
              {/* 사용자 추가 메뉴 아이템 */}
              <MenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  if (isShareMode) {
                    setFolderMenuView('selectUser');
                  } else {
                    handleAddUser(folderMenuPath);
                  }
                }}
              >
                <ListItemText 
                  primary="사용자 추가" 
                  primaryTypographyProps={{ 
                    sx: { 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1 
                    } 
                  }}
                />
                <AddIcon fontSize="small" sx={{ ml: 1 }} />
              </MenuItem>
            </>
          );
          
          const renderSelectUserView = () => {
            const availableUsers = users.filter(u => {
              // 이미 선택된 사용자는 제외
              const folderUserPerms = folderPermissions.get(folderMenuPath);
              if (folderUserPerms && folderUserPerms.has(u.id)) return false;
              // 자기 자신 제외
              if (user && u.id === user.id) return false;
              // 관리자 제외
              if (u.is_admin) return false;
              return true;
            });
            
            return (
              <>
                <MenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderMenuView('manage');
                  }}
                >
                  <ListItemText primary="← 뒤로" />
                </MenuItem>
                
                <MenuItem disabled sx={{ py: 0 }}>
                  <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
                </MenuItem>
                
                {availableUsers.map((u) => (
                  <MenuItem
                    key={u.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUserSelect(u.id, u.username);
                    }}
                  >
                    <ListItemText primary={u.username} secondary={u.email} />
                  </MenuItem>
                ))}
                
                {availableUsers.length === 0 && (
                  <MenuItem disabled>
                    <ListItemText primary="추가할 사용자가 없습니다." />
                  </MenuItem>
                )}
              </>
            );
          };
          
          return folderMenuView === 'selectUser' ? renderSelectUserView() : renderManageView();
        })()}
      </Menu>
    </>
  );
};

export default ShareDialog;
