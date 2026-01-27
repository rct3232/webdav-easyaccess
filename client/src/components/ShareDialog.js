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
  TextField,
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
import { FileTreeSkeleton } from './FileSkeletons';
import { approvePermissionRequest } from '../services/permissionRequestService';
import { createShareLink, getShareLinkUrl } from '../services/shareLinkService';
import {
  Link as LinkIcon,
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
} from '@mui/icons-material';

// mode: 'admin' | 'share' | 'review'
// admin mode: userId, username 필요, onSave 필요
// share mode: folderPath, folderName 필요, user 필요
// review mode: permissionRequest 필요, folderPath, folderName 필요, user 필요, onApprove (선택사항)
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
  // Review mode props
  permissionRequest = null, // 검토할 권한 신청 객체
  onApprove = null, // 검토 완료 후 승인 콜백 (선택사항)
  // Common props
  onMessage = null,
  // External share link props
  enableExternalShare = false, // 파일 컨텍스트에서 호출 시 true
  filePath = null, // 외부 공유할 파일 경로 (enableExternalShare가 true일 때)
  fileName = null, // 외부 공유할 파일 이름
}) => {
  const { isMobile } = useResponsive();
  const isAdminMode = mode === 'admin';
  const isShareMode = mode === 'share';
  const isReviewMode = mode === 'review';
  
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
  // initialFolderPermissions: 초기 로드된 권한 (삭제된 권한 추적용)
  const [initialFolderPermissions, setInitialFolderPermissions] = useState(new Map());
  // userInfoMap: Map<userId, {username, email}> - 권한 정보에서 가져온 사용자 정보
  const [userInfoMap, setUserInfoMap] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [loadingAllFolders, setLoadingAllFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState(null);
  const [folderMenuPath, setFolderMenuPath] = useState(null);
  const [folderMenuView, setFolderMenuView] = useState('manage'); // 'manage' | 'selectUser'
  
  // 외부 공유 링크 관련 상태
  const [externalShareLoading, setExternalShareLoading] = useState(false);
  const [externalShareLink, setExternalShareLink] = useState(null);
  const [externalShareExpiresInDays, setExternalShareExpiresInDays] = useState(14);
  const [externalShareUnlimited, setExternalShareUnlimited] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (open) {
      if (isShareMode || isReviewMode) {
        loadUsers();
      }
      initializeDialog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rootPath, isAdminMode, isShareMode, isReviewMode, userId, username, permissionRequest]);

  const initializeDialog = async () => {
    // 외부 공유 링크 모드인 경우 폴더 권한 로드 불필요
    if (enableExternalShare) {
      setLoadingAllFolders(false);
      return;
    }
    
    setFolderPermissions(new Map());
    setInitialFolderPermissions(new Map());
    setUserInfoMap(new Map());
    setExpandedPaths(new Set([rootPath]));
    setFolderTree(new Map());
    setLoadingPaths(new Set());
    setLoadingPermissions(false);
    setLoadingAllFolders(true);
    
    try {
      if (isAdminMode) {
        // 관리자 모드: root부터 시작 또는 사용자 홈 디렉토리부터 시작
        const userBaseFolder = `/${username}`;
        await loadFolderChildren(rootPath);
        
        // 모든 하위 폴더를 재귀적으로 로드
        const { expandedPathsSet } = await loadAllSubfoldersRecursive(rootPath);
        setExpandedPaths(prev => new Set([...prev, ...expandedPathsSet]));
        
        // Load user permissions
        if (userId) {
          setLoadingPermissions(true);
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
          setLoadingPermissions(false);
        } else {
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      } else if (isReviewMode) {
        // 검토 모드: 신청받은 폴더부터 시작
        const selectedFolder = {
          path: rootPath,
          name: folderName,
          children: []
        };
        setFolderTree(new Map([[rootPath, selectedFolder]]));
        
        // 선택한 폴더의 하위 폴더 로드
        await loadFolderChildren(rootPath);
        
        // 모든 하위 폴더를 재귀적으로 로드
        const { expandedPathsSet, allSubfolderPaths } = await loadAllSubfoldersRecursive(rootPath);
        expandedPathsSet.add(rootPath);
        setExpandedPaths(expandedPathsSet);
        
        // 검토 모드: 신청받은 권한을 미리 반영 (하위 폴더의 기존 상위 권한 유지)
        setLoadingPermissions(true);
        try {
          const normalizePath = (p) => {
            if (!p || p === '/') return '/';
            return p.endsWith('/') ? p.slice(0, -1) : p;
          };
          
          // 권한 우선순위 함수 (높을수록 우선순위 높음)
          const getPermissionPriority = (perm) => {
            if (perm === 'admin') return 3;
            if (perm === 'write') return 2;
            if (perm === 'read') return 1;
            return 0;
          };
          
          // 더 높은 권한 선택
          const getHigherPermission = (perm1, perm2) => {
            return getPermissionPriority(perm1) >= getPermissionPriority(perm2) ? perm1 : perm2;
          };
          
          // folderPermissions 초기화: Map<folderPath, Map<userId, permission>>
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();
          
          // 먼저 기존 권한 정보 로드 (하위 폴더 포함)
          try {
            const permResponse = await axios.get('/api/permissions/folder', {
              params: {
                path: rootPath,
                includeSubfolders: 'true'
              }
            });
            
            // 기존 권한을 먼저 설정
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
          } catch (error) {
            // 권한 정보 로드 실패는 조용히 처리 (권한이 없을 수도 있음)
            console.log('Failed to load existing permissions:', error);
          }
          
          // 신청받은 폴더와 모든 하위 폴더에 신청받은 권한 설정 (기존 권한이 더 높으면 유지)
          if (permissionRequest) {
            const requesterId = permissionRequest.requester_id;
            const requestedPermission = permissionRequest.requested_permission || 'read';
            const normalizedRootPath = normalizePath(rootPath);
            
            // 신청받은 폴더에 권한 설정
            if (!newFolderPermissions.has(normalizedRootPath)) {
              newFolderPermissions.set(normalizedRootPath, new Map());
            }
            const rootUserPermMap = newFolderPermissions.get(normalizedRootPath);
            const existingRootPermission = rootUserPermMap.get(requesterId);
            if (existingRootPermission) {
              // 기존 권한이 있으면 더 높은 권한 유지
              rootUserPermMap.set(requesterId, getHigherPermission(existingRootPermission, requestedPermission));
            } else {
              // 기존 권한이 없으면 신청받은 권한 설정
              rootUserPermMap.set(requesterId, requestedPermission);
            }
            
            // 모든 하위 폴더에도 권한 설정 (기존 권한이 더 높으면 유지)
            allSubfolderPaths.forEach(subfolderPath => {
              const normalizedSubfolderPath = normalizePath(subfolderPath);
              if (!newFolderPermissions.has(normalizedSubfolderPath)) {
                newFolderPermissions.set(normalizedSubfolderPath, new Map());
              }
              const subfolderUserPermMap = newFolderPermissions.get(normalizedSubfolderPath);
              const existingSubfolderPermission = subfolderUserPermMap.get(requesterId);
              if (existingSubfolderPermission) {
                // 기존 권한이 있으면 더 높은 권한 유지
                subfolderUserPermMap.set(requesterId, getHigherPermission(existingSubfolderPermission, requestedPermission));
              } else {
                // 기존 권한이 없으면 신청받은 권한 설정
                subfolderUserPermMap.set(requesterId, requestedPermission);
              }
            });
            
            // 사용자 정보 저장 (아직 없으면)
            if (requesterId && permissionRequest.requester_username && !newUserInfoMap.has(requesterId)) {
              newUserInfoMap.set(requesterId, {
                username: permissionRequest.requester_username,
                email: '',
                is_admin: false
              });
            }
          }
          
          setFolderPermissions(newFolderPermissions);
          // 초기 권한도 저장 (삭제된 권한 추적용) - 깊은 복사
          const deepCopiedPermissions = new Map();
          newFolderPermissions.forEach((userPermMap, folderPath) => {
            deepCopiedPermissions.set(folderPath, new Map(userPermMap));
          });
          setInitialFolderPermissions(deepCopiedPermissions);
          setUserInfoMap(newUserInfoMap);
          
          setLoadingPermissions(false);
        } catch (error) {
          console.error('Failed to initialize review mode:', error);
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
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
        
        // 모든 하위 폴더를 재귀적으로 로드
        const { expandedPathsSet } = await loadAllSubfoldersRecursive(rootPath);
        expandedPathsSet.add(rootPath);
        setExpandedPaths(expandedPathsSet);
        
        // 선택한 폴더와 모든 하위 폴더의 권한 정보 로드
        setLoadingPermissions(true);
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
          // 초기 권한도 저장 (삭제된 권한 추적용) - 깊은 복사
          const deepCopiedPermissions = new Map();
          newFolderPermissions.forEach((userPermMap, folderPath) => {
            deepCopiedPermissions.set(folderPath, new Map(userPermMap));
          });
          setInitialFolderPermissions(deepCopiedPermissions);
          setUserInfoMap(newUserInfoMap);
          
          setLoadingPermissions(false);
        } catch (error) {
          // 권한 정보 로드 실패는 조용히 처리 (권한이 없을 수도 있음)
          console.log('Failed to load folder permissions:', error);
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      }
    } catch (error) {
      console.error('Failed to initialize dialog:', error);
      setLoadingAllFolders(false);
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

  // 재귀적으로 모든 하위 폴더를 로드하는 함수
  const loadAllSubfoldersRecursive = async (parentPath) => {
    const expandedPathsSet = new Set();
    const allSubfolderPaths = [];
    const loadRecursive = async (path) => {
      try {
        const children = await loadFolderChildren(path);
        expandedPathsSet.add(path);
        for (const child of children) {
          allSubfolderPaths.push(child.path);
          await loadRecursive(child.path);
          await new Promise(resolve => setTimeout(resolve, 50)); // API 부하 방지
        }
      } catch (err) {
        // 에러는 조용히 처리 (존재하지 않는 폴더일 수 있음)
      }
    };
    await loadRecursive(parentPath);
    return { expandedPathsSet, allSubfolderPaths };
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
      
      // 검토 모드일 때는 기본 권한을 신청받은 권한으로 설정
      const defaultPermission = isReviewMode && permissionRequest 
        ? (permissionRequest.requested_permission || 'read')
        : 'write';
      
      const newFolderPermissions = new Map(folderPermissions);
      if (!newFolderPermissions.has(folderPath)) {
        newFolderPermissions.set(folderPath, new Map());
      }
      const userPermMap = newFolderPermissions.get(folderPath);
      userPermMap.set(userId, defaultPermission);
      
      // 모든 하위 폴더에도 동일한 권한 적용
      const subfolders = getAllSubfolderPaths(folderPath);
      subfolders.forEach(subfolderPath => {
        if (!newFolderPermissions.has(subfolderPath)) {
          newFolderPermissions.set(subfolderPath, new Map());
        }
        const subfolderUserPermMap = newFolderPermissions.get(subfolderPath);
        subfolderUserPermMap.set(userId, defaultPermission);
      });
      
      setFolderPermissions(newFolderPermissions);
    } else {
      // 공유 모드 또는 검토 모드: (단일 메뉴 내) 사용자 선택 뷰로 전환
      setFolderMenuPath(folderPath);
      setFolderMenuView('selectUser');
    }
  };

  const handleUserSelect = (selectedUserId, selectedUsername) => {
    if (!folderMenuPath) return;
    
    // 검토 모드일 때는 기본 권한을 신청받은 권한으로 설정
    const defaultPermission = isReviewMode && permissionRequest 
      ? (permissionRequest.requested_permission || 'read')
      : 'write';
    
    const newFolderPermissions = new Map(folderPermissions);
    if (!newFolderPermissions.has(folderMenuPath)) {
      newFolderPermissions.set(folderMenuPath, new Map());
    }
    const userPermMap = newFolderPermissions.get(folderMenuPath);
    userPermMap.set(selectedUserId, defaultPermission);
    
    // 모든 하위 폴더에도 동일한 권한 적용
    const subfolders = getAllSubfolderPaths(folderMenuPath);
    subfolders.forEach(subfolderPath => {
      if (!newFolderPermissions.has(subfolderPath)) {
        newFolderPermissions.set(subfolderPath, new Map());
      }
      const subfolderUserPermMap = newFolderPermissions.get(subfolderPath);
      subfolderUserPermMap.set(selectedUserId, defaultPermission);
    });
    
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
    
    // 모든 하위 폴더에서도 동일한 사용자의 권한 제거
    const subfolders = getAllSubfolderPaths(folderPath);
    subfolders.forEach(subfolderPath => {
      const subfolderUserPermMap = newFolderPermissions.get(subfolderPath);
      if (subfolderUserPermMap) {
        subfolderUserPermMap.delete(targetUserId);
        if (subfolderUserPermMap.size === 0) {
          newFolderPermissions.delete(subfolderPath);
        }
      }
    });
    
    setFolderPermissions(newFolderPermissions);
  };

  const handleTogglePermission = (folderPath, targetUserId) => {
    const newFolderPermissions = new Map(folderPermissions);
    const userPermMap = newFolderPermissions.get(folderPath);
    if (userPermMap) {
      const currentPermission = userPermMap.get(targetUserId) || 'read';
      const newPermission = currentPermission === 'read' ? 'write' : 'read';
      userPermMap.set(targetUserId, newPermission);
      
      // 모든 하위 폴더에서도 동일한 사용자의 권한 변경
      const subfolders = getAllSubfolderPaths(folderPath);
      subfolders.forEach(subfolderPath => {
        const subfolderUserPermMap = newFolderPermissions.get(subfolderPath);
        if (subfolderUserPermMap && subfolderUserPermMap.has(targetUserId)) {
          const subfolderCurrentPermission = subfolderUserPermMap.get(targetUserId);
          const subfolderNewPermission = subfolderCurrentPermission === 'read' ? 'write' : 'read';
          subfolderUserPermMap.set(targetUserId, subfolderNewPermission);
        }
      });
    }
    setFolderPermissions(newFolderPermissions);
  };

  // 하위 폴더 경로 수집 함수
  const getAllSubfolderPaths = (folderPath) => {
    const subfolders = [];
    const node = folderTree.get(folderPath);
    if (!node || !node.children) return subfolders;
    
    const traverse = (path) => {
      const currentNode = folderTree.get(path);
      if (!currentNode) return;
      
      if (currentNode.children) {
        currentNode.children.forEach(child => {
          subfolders.push(child.path);
          traverse(child.path);
        });
      }
    };
    
    traverse(folderPath);
    return subfolders;
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

  // 권한이 변경되었는지 확인하는 함수
  const hasPermissionChanged = (folderPath) => {
    const currentPerms = folderPermissions.get(folderPath) || new Map();
    const initialPerms = initialFolderPermissions.get(folderPath) || new Map();
    
    // 사용자 수가 다르면 변경됨
    if (currentPerms.size !== initialPerms.size) {
      return true;
    }
    
    // 각 사용자의 권한이 변경되었는지 확인
    for (const [userId, permission] of currentPerms.entries()) {
      const initialPermission = initialPerms.get(userId);
      if (initialPermission !== permission) {
        return true;
      }
    }
    
    // 초기에는 있었는데 현재는 없는 사용자가 있는지 확인
    for (const [userId] of initialPerms.entries()) {
      if (!currentPerms.has(userId)) {
        return true;
      }
    }
    
    return false;
  };

  const renderFolderTree = (rootPath, level = 0) => {
    const node = folderTree.get(rootPath);
    if (!node) return null;
    
    const isExpanded = expandedPaths.has(node.path);
    const isLoading = loadingPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <Box key={node.path} sx={{ width: '100%', overflow: 'visible' }}>
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            py: 0.5, 
            pl: level * 1, 
            width: '100%',
            overflow: 'visible',
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
            
            const isChanged = hasPermissionChanged(node.path);
            
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
                  overflow: 'visible',
                  '&:hover': {
                    backgroundColor: 'grey.400',
                  }
                }}
              >
                {loadingPermissions ? (
                  <CircularProgress size={12} sx={{ mr: 0.5 }} />
                ) : (
                  <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                    {userCount}
                  </Typography>
                )}
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
                    position: 'relative',
                    overflow: 'visible',
                  }}
                >
                  <GroupAddIcon sx={{ fontSize: 16 }} />
                  {isChanged && (
                    <EditIcon
                      sx={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        fontSize: 8,
                        backgroundColor: 'primary.main',
                        color: 'white',
                        borderRadius: '50%',
                        padding: '1px',
                        border: '1px solid white',
                        width: 12,
                        height: 12,
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    />
                  )}
                </Box>
              </Box>
            );
          })()}
        </Box>
        
        {isExpanded && (hasChildren || isLoading) && (
          <Box sx={{ pl: 1 }}>
            {isLoading && !hasChildren ? (
              <FileTreeSkeleton level={level + 1} count={3} />
            ) : (
              node.children.map(child => renderFolderTree(child.path, level + 1))
            )}
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
    } else if (isReviewMode) {
      // 검토 모드: 각 폴더의 각 사용자에게 권한 부여 및 삭제된 권한 취소 후 승인 API 호출
      if (!permissionRequest || !permissionRequest.id) {
        if (onMessage) {
          onMessage({
            text: '권한 신청 정보가 없습니다.',
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
        
        // 삭제된 권한 찾기: 초기 권한에는 있지만 현재 권한에는 없는 것들
        const permissionsToRevoke = [];
        for (const [folderPath, initialUserPermMap] of initialFolderPermissions.entries()) {
          const currentUserPermMap = folderPermissions.get(folderPath);
          
          // 초기 권한의 각 사용자에 대해
          for (const [targetUserId] of initialUserPermMap.entries()) {
            // 현재 권한에 없거나 다른 폴더로 이동한 경우 삭제 대상
            if (!currentUserPermMap || !currentUserPermMap.has(targetUserId)) {
              permissionsToRevoke.push({
                userId: targetUserId,
                folderPath: normalizePath(folderPath)
              });
            }
          }
        }
        
        // 삭제된 권한 취소
        for (const { userId, folderPath } of permissionsToRevoke) {
          try {
            await axios.delete('/api/permissions/revoke', {
              params: {
                userId: userId,
                folderPath: folderPath,
                includeSubfolders: 'true'
              }
            });
          } catch (error) {
            console.error(`Failed to revoke permission for ${folderPath}:`, error);
            // 권한 취소 실패는 경고만 하고 계속 진행
          }
        }
        
        // 각 폴더의 각 사용자에 대해 권한 부여 (원래 로직대로 모든 권한 부여)
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
        
        // 권한 부여 완료 후 승인 API 호출
        await approvePermissionRequest(permissionRequest.id);
        
        if (onMessage) {
          onMessage({
            text: '권한 신청을 승인했습니다.',
            type: 'success'
          });
        }
        
        if (onApprove) {
          onApprove();
        }
        
        onClose();
      } catch (error) {
        console.error('Failed to approve permission request:', error);
        const errorMsg = error.response?.data?.error || '권한 신청 승인에 실패했습니다.';
        if (onMessage) {
          onMessage({
            text: errorMsg,
            type: 'error'
          });
        }
      } finally {
        setSaving(false);
      }
    } else {
      // 공유 모드: 각 폴더의 각 사용자에게 권한 부여 및 삭제된 권한 취소
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
        
        // 삭제된 권한 찾기: 초기 권한에는 있지만 현재 권한에는 없는 것들
        const permissionsToRevoke = [];
        for (const [folderPath, initialUserPermMap] of initialFolderPermissions.entries()) {
          const currentUserPermMap = folderPermissions.get(folderPath);
          
          // 초기 권한의 각 사용자에 대해
          for (const [targetUserId] of initialUserPermMap.entries()) {
            // 현재 권한에 없거나 다른 폴더로 이동한 경우 삭제 대상
            if (!currentUserPermMap || !currentUserPermMap.has(targetUserId)) {
              permissionsToRevoke.push({
                userId: targetUserId,
                folderPath: normalizePath(folderPath)
              });
            }
          }
        }
        
        // 삭제된 권한 취소
        for (const { userId, folderPath } of permissionsToRevoke) {
          try {
            await axios.delete('/api/permissions/revoke', {
              params: {
                userId: userId,
                folderPath: folderPath,
                includeSubfolders: 'true'
              }
            });
          } catch (error) {
            console.error(`Failed to revoke permission for ${folderPath}:`, error);
            // 권한 취소 실패는 경고만 하고 계속 진행
          }
        }
        
        // 각 폴더의 각 사용자에 대해 권한 부여 (원래 로직대로 모든 권한 부여)
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
    setInitialFolderPermissions(new Map());
    setFolderTree(new Map());
    setExpandedPaths(new Set());
    setFolderMenuAnchor(null);
    setFolderMenuPath(null);
    setFolderMenuView('manage');
    setUserInfoMap(new Map());
    // 외부 공유 링크 상태 초기화
    setExternalShareLink(null);
    setExternalShareExpiresInDays(14);
    setExternalShareUnlimited(false);
    setLinkCopied(false);
    onClose();
  };

  const dialogTitle = isAdminMode 
    ? `권한 설정 - ${username}` 
    : isReviewMode
    ? `권한 검토 - ${folderName}`
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
          {enableExternalShare ? '외부 공유 링크 생성' : dialogTitle}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'hidden' }}>
          {/* 외부 공유 링크 섹션 (파일 컨텍스트에서만 표시) */}
          {enableExternalShare && filePath && (
            <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                외부 공유 링크
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {fileName || filePath.split('/').pop()}에 대한 공유 링크를 생성합니다.
              </Typography>
              
              {!externalShareLink ? (
                <>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" gutterBottom>
                      유효기간
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Button
                        variant={externalShareUnlimited ? 'outlined' : 'contained'}
                        size="small"
                        onClick={() => {
                          setExternalShareUnlimited(true);
                          setExternalShareExpiresInDays(null);
                        }}
                      >
                        무제한
                      </Button>
                      <Button
                        variant={!externalShareUnlimited ? 'outlined' : 'contained'}
                        size="small"
                        onClick={() => {
                          setExternalShareUnlimited(false);
                          setExternalShareExpiresInDays(14);
                        }}
                      >
                        지정
                      </Button>
                      {!externalShareUnlimited && (
                        <TextField
                          type="number"
                          size="small"
                          value={externalShareExpiresInDays}
                          onChange={(e) => {
                            const days = parseInt(e.target.value, 10);
                            if (!isNaN(days) && days >= 0) {
                              setExternalShareExpiresInDays(days);
                            }
                          }}
                          inputProps={{ min: 0 }}
                          sx={{ width: 100 }}
                        />
                      )}
                      {!externalShareUnlimited && (
                        <Typography variant="body2" color="text.secondary">
                          일
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={async () => {
                      setExternalShareLoading(true);
                      try {
                        const link = await createShareLink(
                          filePath,
                          externalShareUnlimited ? null : externalShareExpiresInDays
                        );
                        setExternalShareLink(link);
                        if (onMessage) {
                          onMessage({
                            text: '공유 링크가 생성되었습니다.',
                            type: 'success',
                          });
                        }
                      } catch (error) {
                        console.error('Failed to create share link:', error);
                        if (onMessage) {
                          onMessage({
                            text: error.response?.data?.error || '공유 링크 생성에 실패했습니다.',
                            type: 'error',
                          });
                        }
                      } finally {
                        setExternalShareLoading(false);
                      }
                    }}
                    disabled={externalShareLoading}
                    startIcon={<LinkIcon />}
                  >
                    {externalShareLoading ? '생성 중...' : '링크 생성'}
                  </Button>
                </>
              ) : (
                <>
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.100', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      공유 링크
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography
                        component="span"
                        onClick={() => {
                          const url = getShareLinkUrl(externalShareLink.token);
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        sx={{
                          flex: 1,
                          fontFamily: 'monospace',
                          wordBreak: 'break-all',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          textDecorationColor: 'rgba(0,0,0,0.3)',
                          '&:hover': {
                            textDecorationColor: 'rgba(0,0,0,0.8)',
                          },
                        }}
                      >
                        {getShareLinkUrl(externalShareLink.token)}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(getShareLinkUrl(externalShareLink.token));
                            setLinkCopied(true);
                            setTimeout(() => setLinkCopied(false), 2000);
                            if (onMessage) {
                              onMessage({
                                text: '링크가 클립보드에 복사되었습니다.',
                                type: 'success',
                              });
                            }
                          } catch (error) {
                            console.error('Failed to copy link:', error);
                            if (onMessage) {
                              onMessage({
                                text: '링크 복사에 실패했습니다.',
                                type: 'error',
                              });
                            }
                          }
                        }}
                      >
                        {linkCopied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                      </IconButton>
                    </Box>
                  </Box>
                  
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      만료일: {externalShareLink.expiresAt 
                        ? new Date(externalShareLink.expiresAt).toLocaleDateString('ko-KR')
                        : '무제한'}
                    </Typography>
                  </Box>
                  
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={() => {
                      setExternalShareLink(null);
                      setExternalShareExpiresInDays(14);
                      setExternalShareUnlimited(false);
                    }}
                  >
                    새 링크 생성
                  </Button>
                </>
              )}
            </Box>
          )}
          
          {/* 폴더 공유 섹션 (외부 공유 링크가 활성화되어 있으면 표시하지 않음) */}
          {!enableExternalShare && (
            <>
              {/* 폴더 트리 영역 */}
              <Box sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
            {loadingAllFolders ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={40} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  폴더를 불러오는 중...
                </Typography>
              </Box>
            ) : folderTree.size === 0 ? (
              <Typography variant="body2" color="text.secondary">
                폴더를 불러오는 중...
              </Typography>
            ) : (isAdminMode && startFromUserHome && username) || ((isShareMode || isReviewMode) && user && rootPath === `/${user.username}`) ? (
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
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose} disabled={saving || externalShareLoading}>
            {enableExternalShare ? '닫기' : '취소'}
          </Button>
          {!enableExternalShare && (
            <Button 
              onClick={handleSave} 
              variant="contained" 
              color="primary" 
              disabled={saving || loadingAllFolders} 
              sx={{ ml: 1 }}
            >
              {saving ? '저장 중...' : '확인'}
            </Button>
          )}
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
                  if (isShareMode || isReviewMode) {
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
            // 검토 모드에서는 신청자만 표시
            if (isReviewMode && permissionRequest) {
              const requesterId = permissionRequest.requester_id;
              const folderUserPerms = folderPermissions.get(folderMenuPath);
              const isAlreadyAdded = folderUserPerms && folderUserPerms.has(requesterId);
              
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
                  
                  {!isAlreadyAdded ? (
                    <MenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUserSelect(
                          requesterId, 
                          permissionRequest.requester_username || `사용자 ${requesterId}`
                        );
                      }}
                    >
                      <ListItemText 
                        primary={permissionRequest.requester_username || `사용자 ${requesterId}`}
                        secondary="신청자"
                      />
                    </MenuItem>
                  ) : (
                    <MenuItem disabled>
                      <ListItemText primary="이미 추가된 사용자입니다." />
                    </MenuItem>
                  )}
                </>
              );
            }
            
            // 공유 모드: 일반 사용자 선택
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
