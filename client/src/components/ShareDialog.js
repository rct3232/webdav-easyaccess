import React, { useState, useEffect, useRef } from 'react';
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
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import axios from 'axios';

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
  // Share mode props
  folderPath = null,
  folderName = null,
  user = null,
  // Common props
  onMessage = null
}) => {
  const isAdminMode = mode === 'admin';
  const isShareMode = mode === 'share';
  
  // Admin mode: root부터 시작, Share mode: 선택한 폴더부터 시작
  const rootPath = isAdminMode ? '/' : (folderPath && folderPath !== '/' && folderPath.endsWith('/') ? folderPath.slice(0, -1) : (folderPath || '/'));
  // 공유 모드에서 선택한 폴더 경로 (비교용)
  const selectedFolderPath = isShareMode ? rootPath : null;
  
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [folderTree, setFolderTree] = useState(new Map());
  // folderPermissions: Map<folderPath, Map<userId, permission>>
  const [folderPermissions, setFolderPermissions] = useState(new Map());
  // userInfoMap: Map<userId, {username, email}> - 권한 정보에서 가져온 사용자 정보
  const [userInfoMap, setUserInfoMap] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [userSelectMenuAnchor, setUserSelectMenuAnchor] = useState(null);
  const [userSelectMenuFolderPath, setUserSelectMenuFolderPath] = useState(null);

  useEffect(() => {
    if (open) {
      if (isShareMode) {
        loadUsers();
      }
      initializeDialog();
    }
  }, [open, rootPath, isAdminMode, isShareMode, userId, username]);

  const initializeDialog = async () => {
    setFolderPermissions(new Map());
    setUserInfoMap(new Map());
    setExpandedPaths(new Set([rootPath]));
    setFolderTree(new Map());
    setLoadingPaths(new Set());
    
    try {
      if (isAdminMode) {
        // 관리자 모드: 루트 폴더 로드 및 사용자 권한 로드
        await loadFolderChildren('/');
        
        // Load user permissions
        if (userId) {
          const permResponse = await axios.get(`/api/users/${userId}/permissions`);
          const userBaseFolder = `/${username}`;
          
          // 경로 정규화 헬퍼 함수
          const normalizePath = (p) => {
            if (!p || p === '/') return '/';
            return p.endsWith('/') ? p.slice(0, -1) : p;
          };
          
          // folderPermissions 초기화: Map<folderPath, Map<userId, permission>>
          const newFolderPermissions = new Map();
          
          // DB에 있는 모든 권한을 folderPermissions에 추가
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            if (!newFolderPermissions.has(normalizedPath)) {
              newFolderPermissions.set(normalizedPath, new Map());
            }
            const userPermMap = newFolderPermissions.get(normalizedPath);
            userPermMap.set(userId, perm.permission);
          });
          
          // 사용자 기본 폴더는 항상 쓰기 권한으로 설정
          if (!newFolderPermissions.has(userBaseFolder)) {
            newFolderPermissions.set(userBaseFolder, new Map());
          }
          const userBasePermMap = newFolderPermissions.get(userBaseFolder);
          userBasePermMap.set(userId, 'write');
          
          setFolderPermissions(newFolderPermissions);
          
          // 권한에 있는 경로들의 부모 경로들을 folderTree에 로드하려고 시도 (에러는 무시)
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
          const expandedPathsSet = new Set(['/']); // 루트는 항상 확장
          
          for (const pathToLoad of sortedPaths) {
            if (pathToLoad === '/') continue; // 루트는 이미 로드됨
            
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
          
          // 권한에 있는 경로들의 부모 경로들을 folderTree에 로드하려고 시도
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
      // 공유 모드: 사용자 선택 팝업 표시
      setUserSelectMenuFolderPath(folderPath);
    }
  };

  const handleUserSelect = (selectedUserId, selectedUsername) => {
    if (!userSelectMenuFolderPath) return;
    
    const newFolderPermissions = new Map(folderPermissions);
    if (!newFolderPermissions.has(userSelectMenuFolderPath)) {
      newFolderPermissions.set(userSelectMenuFolderPath, new Map());
    }
    const userPermMap = newFolderPermissions.get(userSelectMenuFolderPath);
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
    
    setUserSelectMenuAnchor(null);
    setUserSelectMenuFolderPath(null);
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
    
    // 관리자 모드에서 사용자 기본 폴더는 제거 불가
    const userBaseFolder = isAdminMode ? `/${username}` : null;
    const isUserBaseFolder = isAdminMode && node.path === userBaseFolder;
    
    // 이 폴더에 할당된 사용자들
    const folderUserPerms = folderPermissions.get(node.path) || new Map();
    const folderUsers = Array.from(folderUserPerms.entries());
    
    // 관리자 모드에서는 선택한 사용자만 표시
    // 공유 모드에서는 자기 자신과 관리자 사용자는 제외
    const displayUsers = isAdminMode 
      ? folderUsers.filter(([uid]) => uid === userId)
      : folderUsers.filter(([targetUserId]) => {
          // 자기 자신 제외
          if (user && targetUserId === user.id) {
            return false;
          }
          // 관리자 사용자 제외
          const userInfo = userInfoMap.get(targetUserId);
          if (userInfo && userInfo.is_admin) {
            return false;
          }
          // users 배열에서도 확인 (fallback)
          const fullUser = users.find(u => u.id === targetUserId);
          if (fullUser && fullUser.is_admin) {
            return false;
          }
          return true;
        });
    
    return (
      <Box key={node.path} sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, pl: level * 2, width: '100%' }}>
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
              onMouseEnter={(e) => {
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
              onMouseLeave={(e) => {
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
                }}
              >
                {node.name || node.path}
              </Typography>
            </Box>
          </Box>
          
          {/* 오른쪽: 사용자 칩들 */}
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              flexShrink: 2,
            }}
          >
            {/* 칩들 그룹 - 스크롤 가능 */}
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 0.5, 
                flexWrap: 'nowrap',
                overflowX: 'auto',
                overflowY: 'hidden',
                '&::-webkit-scrollbar': {
                  height: '4px',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  borderRadius: '2px',
                },
              }}
            >
              {displayUsers
                .filter(([targetUserId]) => {
                  // 사용자 이름이 있는 경우만 표시
                  const userName = getUserName(targetUserId);
                  return userName && userName.trim() !== '';
                })
                .map(([targetUserId, permission]) => {
                const userName = getUserName(targetUserId);
                const canEdit = !isUserBaseFolder || targetUserId !== userId;
                
                const isWrite = permission === 'write';
                
                return (
                  <Chip
                    key={targetUserId}
                    label={userName}
                    size="small"
                    avatar={
                      <Box
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canEdit) {
                            handleTogglePermission(node.path, targetUserId);
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
                        handleRemoveUser(node.path, targetUserId);
                      }
                    }}
                    deleteIcon={<CloseIcon />}
                    sx={{ 
                      backgroundColor: 'grey.200',
                      border: 'none',
                      '& .MuiChip-avatar': {
                        marginLeft: '4px',
                        marginRight: '-4px'
                      }
                    }}
                  />
                );
              })}
            </Box>
            
            {/* 사용자 추가 버튼 - 고정 위치 */}
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (isShareMode) {
                  setUserSelectMenuAnchor(e.currentTarget);
                  setUserSelectMenuFolderPath(node.path);
                } else {
                  handleAddUser(node.path);
                }
              }}
              sx={{ 
                width: 28,
                height: 28,
                bgcolor: 'success.main',
                color: 'white',
                flexShrink: 0,
                '&:hover': {
                  bgcolor: 'success.dark',
                }
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        {isExpanded && hasChildren && (
          <Box sx={{ pl: 2 }}>
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
    setUserSelectMenuAnchor(null);
    setUserSelectMenuFolderPath(null);
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
        PaperProps={{
          sx: { 
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

      {/* 사용자 선택 메뉴 (공유 모드용) */}
      <Menu
        anchorEl={userSelectMenuAnchor}
        open={Boolean(userSelectMenuAnchor)}
        onClose={() => {
          setUserSelectMenuAnchor(null);
          setUserSelectMenuFolderPath(null);
        }}
        PaperProps={{
          style: {
            maxHeight: '75vh',
          },
        }}
      >
        {users
          .filter(u => {
            // 이미 선택된 사용자는 제외
            if (!userSelectMenuFolderPath) return true;
            const folderUserPerms = folderPermissions.get(userSelectMenuFolderPath);
            if (!folderUserPerms) return true;
            return !folderUserPerms.has(u.id);
          })
          .map((user) => (
            <MenuItem
              key={user.id}
              onClick={() => handleUserSelect(user.id, user.username)}
            >
              <ListItemText primary={user.username} secondary={user.email} />
            </MenuItem>
          ))}
        {users.filter(u => {
          if (!userSelectMenuFolderPath) return false;
          const folderUserPerms = folderPermissions.get(userSelectMenuFolderPath);
          if (!folderUserPerms) return false;
          return !folderUserPerms.has(u.id);
        }).length === 0 && (
          <MenuItem disabled>
            <ListItemText primary="추가할 사용자가 없습니다." />
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

export default ShareDialog;
