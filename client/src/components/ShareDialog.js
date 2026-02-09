import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import axios from 'axios';
import { useResponsive } from '../hooks/useResponsive';
import { approvePermissionRequest } from '../services/permissionRequestService';
import { createShareLink, getShareLinkUrl } from '../services/shareLinkService';
import { normalizePath } from '../utils/pathUtils';
import { getUserBaseFolder } from '../utils/userUtils';

import { usePermissionManager } from '../hooks/usePermissionManager';
import ShareFolderTree from './ShareFolderTree';
import UserSelectionMenu from './UserSelectionMenu';
import ExternalShareSection from './ExternalShareSection';
import FolderShareSection from './FolderShareSection';

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
    ? (startFromUserHome && username ? getUserBaseFolder({ username }) : '/')
    : (folderPath && folderPath !== '/' && folderPath.endsWith('/') ? folderPath.slice(0, -1) : (folderPath || '/'));
  
  const [users, setUsers] = useState([]);
  const [folderTree, setFolderTree] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [loadingAllFolders, setLoadingAllFolders] = useState(false);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState(null);
  const [folderMenuPath, setFolderMenuPath] = useState(null);
  const [folderMenuView, setFolderMenuView] = useState('manage'); // 'manage' | 'selectUser'
  
  const {
    folderPermissions,
    setFolderPermissions,
    initialFolderPermissions,
    setInitialFolderPermissions,
    userInfoMap,
    setUserInfoMap,
    saving,
    setSaving,
    loadingPermissions,
    setLoadingPermissions,
    handleAddUserPermission,
    handleRemoveUserPermission,
    handleToggleUserPermission,
    hasPermissionChanged,
  } = usePermissionManager({
    mode,
    userId,
    username,
    permissionRequest,
    onMessage,
    onSave,
    onApprove,
    onClose,
  });

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
        const userBaseFolder = getUserBaseFolder({ username });
        await loadFolderChildren(rootPath);
        
        // 모든 하위 폴더를 재귀적으로 로드
        const { expandedPathsSet } = await loadAllSubfoldersRecursive(rootPath);
        setExpandedPaths(prev => new Set([...prev, ...expandedPathsSet]));
        
        // Load user permissions
        if (userId) {
          setLoadingPermissions(true);
          const permResponse = await axios.get(`/api/users/${userId}/permissions`);
          
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
      
      const subfolders = getAllSubfolderPaths(folderPath);
      handleAddUserPermission(folderPath, userId, defaultPermission, subfolders);
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
    
    const subfolders = getAllSubfolderPaths(folderMenuPath);
    handleAddUserPermission(folderMenuPath, selectedUserId, defaultPermission, subfolders);
    
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
    const subfolders = getAllSubfolderPaths(folderPath);
    handleRemoveUserPermission(folderPath, targetUserId, subfolders);
  };

  const handleTogglePermission = (folderPath, targetUserId) => {
    const subfolders = getAllSubfolderPaths(folderPath);
    handleToggleUserPermission(folderPath, targetUserId, subfolders);
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

  const renderFolderTreeWrapper = (rootPath, level = 0) => {
    return (
      <ShareFolderTree
        rootPath={rootPath}
        folderTree={folderTree}
        expandedPaths={expandedPaths}
        loadingPaths={loadingPaths}
        toggleExpand={toggleExpand}
        folderPermissions={folderPermissions}
        isAdminMode={isAdminMode}
        userId={userId}
        user={user}
        userInfoMap={userInfoMap}
        users={users}
        getUserName={getUserName}
        hasPermissionChanged={hasPermissionChanged}
        setFolderMenuAnchor={setFolderMenuAnchor}
        setFolderMenuPath={setFolderMenuPath}
        loadingPermissions={loadingPermissions}
        isMobile={isMobile}
        level={level}
      />
    );
  };

  const handleSave = async () => {
    if (isAdminMode) {
      // 관리자 모드: 사용자 권한 일괄 업데이트
      try {
        const userBaseFolder = getUserBaseFolder({ username });
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
            <ExternalShareSection
              externalShareLink={externalShareLink}
              setExternalShareLink={setExternalShareLink}
              externalShareLoading={externalShareLoading}
              setExternalShareLoading={setExternalShareLoading}
              externalShareExpiresInDays={externalShareExpiresInDays}
              setExternalShareExpiresInDays={setExternalShareExpiresInDays}
              externalShareUnlimited={externalShareUnlimited}
              setExternalShareUnlimited={setExternalShareUnlimited}
              linkCopied={linkCopied}
              setLinkCopied={setLinkCopied}
              createShareLink={createShareLink}
              getShareLinkUrl={getShareLinkUrl}
              filePath={filePath}
              fileName={fileName}
              onMessage={onMessage}
            />
          )}
          
          {/* 폴더 공유 섹션 (외부 공유 링크가 활성화되어 있으면 표시하지 않음) */}
          {!enableExternalShare && (
            <FolderShareSection
              loadingAllFolders={loadingAllFolders}
              folderTree={folderTree}
              isAdminMode={isAdminMode}
              startFromUserHome={startFromUserHome}
              username={username}
              isShareMode={isShareMode}
              isReviewMode={isReviewMode}
              user={user}
              rootPath={rootPath}
              renderFolderTreeWrapper={renderFolderTreeWrapper}
            />
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
      <UserSelectionMenu
        folderMenuAnchor={folderMenuAnchor}
        onClose={() => {
          setFolderMenuAnchor(null);
          setFolderMenuPath(null);
          setFolderMenuView('manage');
        }}
        folderMenuPath={folderMenuPath}
        folderPermissions={folderPermissions}
        isAdminMode={isAdminMode}
        userId={userId}
        username={username}
        user={user}
        userInfoMap={userInfoMap}
        users={users}
        getUserName={getUserName}
        handleTogglePermission={handleTogglePermission}
        handleRemoveUser={handleRemoveUser}
        folderMenuView={folderMenuView}
        setFolderMenuView={setFolderMenuView}
        isShareMode={isShareMode}
        isReviewMode={isReviewMode}
        handleAddUser={handleAddUser}
        permissionRequest={permissionRequest}
        handleUserSelect={handleUserSelect}
      />
    </>
  );
};

export default ShareDialog;
