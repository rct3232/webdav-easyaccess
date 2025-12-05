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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  AddCircle as AddCircleIcon,
  RemoveCircle as RemoveCircleIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
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
  
  const [selectedUserId, setSelectedUserId] = useState(isAdminMode ? userId : null);
  const [selectedUsername, setSelectedUsername] = useState(isAdminMode ? username : null);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [folderTree, setFolderTree] = useState(new Map());
  const [selectedPermissions, setSelectedPermissions] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [selectedExpandedPaths, setSelectedExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (isShareMode) {
        loadUsers();
      }
      initializeDialog();
    }
  }, [open, rootPath, isAdminMode, isShareMode, userId, username]);

  const initializeDialog = async () => {
    setSelectedPermissions(new Map());
    setExpandedPaths(new Set([rootPath]));
    setSelectedExpandedPaths(new Set([rootPath]));
    setFolderTree(new Map());
    setLoadingPaths(new Set());
    
    try {
      if (isAdminMode) {
        // 관리자 모드: 루트 폴더 로드 및 사용자 권한 로드
        await loadFolderChildren('/');
        
        // Load user permissions
        if (userId) {
          const permResponse = await axios.get(`/api/users/${userId}/permissions`);
          const permMap = new Map();
          const userBaseFolder = `/${username}`;
          
          // 경로 정규화 헬퍼 함수
          const normalizePath = (p) => {
            if (!p || p === '/') return '/';
            return p.endsWith('/') ? p.slice(0, -1) : p;
          };
          
          // DB에 있는 모든 권한을 selectedPermissions에 추가 (존재 여부와 관계없이)
          // 경로를 정규화하여 folderTree 경로 형식과 일치시킴 (끝에 / 제거)
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            permMap.set(normalizedPath, perm.permission);
          });
          
          // 사용자 기본 폴더는 항상 쓰기 권한으로 설정
          permMap.set(userBaseFolder, 'write');
          setSelectedPermissions(permMap);
          
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
        
        // 선택한 폴더와 모든 하위 폴더를 기본으로 선택된 권한에 추가
        await new Promise(resolve => setTimeout(resolve, 200));
        const allSubPaths = await getAllSubPathsRecursive(rootPath);
        const initialPermissions = new Map();
        allSubPaths.forEach(path => {
          initialPermissions.set(path, 'read');
        });
        setSelectedPermissions(initialPermissions);
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

  const getAllSubPathsRecursive = async (path) => {
    const subPaths = new Set([path]);
    
    // 재귀적으로 모든 하위 폴더를 로드하고 수집
    const loadAndCollect = async (parentPath) => {
      // 현재 경로의 하위 폴더 로드
      let node = folderTree.get(parentPath);
      let children = [];
      
      if (!node || !node.children || node.children.length === 0) {
        children = await loadFolderChildren(parentPath) || [];
        // 상태가 업데이트될 때까지 기다림
        await new Promise(resolve => setTimeout(resolve, 100));
        node = folderTree.get(parentPath);
      } else {
        children = node.children;
      }
      
      // 로드된 하위 폴더들 처리
      if (children && children.length > 0) {
        for (const child of children) {
          // 하위 경로인지 확인
          const isChild = parentPath === '/' 
            ? child.path.startsWith('/') && child.path !== '/'
            : child.path.startsWith(parentPath + '/');
          
          if (isChild) {
            subPaths.add(child.path);
            // 재귀적으로 하위 폴더도 처리
            await loadAndCollect(child.path);
          }
        }
      }
    };
    
    await loadAndCollect(path);
    
    return Array.from(subPaths);
  };

  const getParentPaths = (path) => {
    const parentPaths = [];
    
    // 경로 정규화 (끝의 슬래시 제거)
    const normalizePath = (p) => {
      if (!p || p === '/') return '/';
      return p.endsWith('/') ? p.slice(0, -1) : p;
    };
    
    const normalizedPath = normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    
    if (isAdminMode) {
      // 관리자 모드: /부터 시작하는 모든 부모 경로 (상위부터 하위 순서)
      for (let i = 0; i < parts.length; i++) {
        const parentPath = '/' + parts.slice(0, i).join('/');
        const normalizedParentPath = normalizePath(parentPath);
        if (normalizedParentPath !== normalizedPath && normalizedParentPath !== '') {
          parentPaths.push(normalizedParentPath || '/');
        }
      }
    } else {
      // 공유 모드: 선택한 폴더부터 시작하는 부모 경로만 (상위부터 하위 순서)
      const normalizedSelectedPath = normalizePath(selectedFolderPath || '');
      if (normalizedSelectedPath && normalizedPath.startsWith(normalizedSelectedPath + '/')) {
        const relativePath = normalizedPath.substring(normalizedSelectedPath.length + 1);
        const relativeParts = relativePath.split('/').filter(Boolean);
        
        // 상위부터 하위 순서로 부모 경로 생성
        for (let i = 1; i <= relativeParts.length; i++) {
          if (i === relativeParts.length) {
            // 자기 자신은 추가하지 않음
            continue;
          }
          const parentPath = normalizedSelectedPath + '/' + relativeParts.slice(0, i).join('/');
          if (parentPath !== normalizedPath) {
            parentPaths.push(parentPath);
          }
        }
      }
    }
    
    return parentPaths;
  };

  const handleAddFolder = async (path) => {
    try {
      // 부모 경로들을 먼저 추가
      const parentPaths = getParentPaths(path);
      
      // 모든 하위 경로를 재귀적으로 찾아서 추가
      const allSubPaths = await getAllSubPathsRecursive(path);
      
      const newPermissions = new Map(selectedPermissions);
      
      // 부모 경로들 추가
      parentPaths.forEach(parentPath => {
        if (!newPermissions.has(parentPath)) {
          newPermissions.set(parentPath, 'read');
        }
      });
      
      // 하위 경로들 추가
      allSubPaths.forEach(subPath => {
        if (!newPermissions.has(subPath)) {
          newPermissions.set(subPath, 'read');
        }
      });
      
      setSelectedPermissions(newPermissions);
    } catch (error) {
      console.error('Failed to add folder:', error);
      if (onMessage) {
          onMessage({
            text: '폴더 추가에 실패했습니다.',
            type: 'error'
          });
      }
    }
  };

  const handleRemoveFolder = (path) => {
    // 공유 모드에서 선택한 폴더는 제거할 수 없음
    if (isShareMode && selectedFolderPath !== null && path === selectedFolderPath) {
      return;
    }
    
    const newPermissions = new Map(selectedPermissions);
    
    // 해당 경로로 시작하는 모든 경로 제거
    const pathsToRemove = [];
    newPermissions.forEach((permission, selectedPath) => {
      // 정확히 일치하거나 하위 경로인 경우
      if (selectedPath === path || selectedPath.startsWith(path + '/')) {
        pathsToRemove.push(selectedPath);
      }
    });
    
    pathsToRemove.forEach(pathToRemove => {
      newPermissions.delete(pathToRemove);
    });
    
    setSelectedPermissions(newPermissions);
  };

  const handleTogglePermission = (path) => {
    const newPermissions = new Map(selectedPermissions);
    const currentPermission = newPermissions.get(path) || 'read';
    // 읽기 -> 쓰기, 쓰기 -> 읽기로 토글
    const newPermission = currentPermission === 'read' ? 'write' : 'read';
    newPermissions.set(path, newPermission);
    setSelectedPermissions(newPermissions);
  };

  const toggleExpand = async (path, isSelected = false) => {
    if (isSelected) {
      setSelectedExpandedPaths(prev => {
        const newSet = new Set(prev);
        if (newSet.has(path)) {
          newSet.delete(path);
        } else {
          newSet.add(path);
        }
        return newSet;
      });
    } else {
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
    }
  };

  const renderFolderTree = (rootPath, level = 0, isSelected = false) => {
    const node = folderTree.get(rootPath);
    if (!node) return null;
    
    const isExpanded = isSelected ? selectedExpandedPaths.has(node.path) : expandedPaths.has(node.path);
    const hasPermission = selectedPermissions.has(node.path);
    const permission = selectedPermissions.get(node.path) || 'read';
    const isLoading = loadingPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    
    // 관리자 모드에서 사용자 기본 폴더는 제거 불가
    const userBaseFolder = isAdminMode ? `/${username}` : null;
    const isUserBaseFolder = isAdminMode && node.path === userBaseFolder;
    // 공유 모드에서 선택한 폴더만 제거 불가 (하위 디렉토리는 제거 가능)
    // 주의: rootPath는 재귀 호출 시 변경되므로 selectedFolderPath 사용
    const isSelectedFolder = selectedFolderPath !== null && node.path === selectedFolderPath;
    const canRemove = !isUserBaseFolder && !isSelectedFolder;
    
    return (
      <Box key={node.path}>
        <Box sx={{ display: 'flex', alignItems: 'center', py: 0.5, pl: level * 2 }}>
          <IconButton
            size="small"
            onClick={() => toggleExpand(node.path, isSelected)}
            disabled={isLoading}
            sx={{ mr: 0.5 }}
          >
            {isLoading ? (
              <CircularProgress size={16} />
            ) : isExpanded ? (
              <ExpandMoreIcon />
            ) : (
              <ChevronRightIcon />
            )}
          </IconButton>
          {isExpanded ? <FolderOpenIcon sx={{ fontSize: 16, mr: 0.5 }} /> : <FolderIcon sx={{ fontSize: 16, mr: 0.5 }} />}
          <Typography variant="body2" sx={{ flex: 1, mr: 1 }}>
            {node.name || node.path}
          </Typography>
          {!isSelected ? (
            <IconButton
              size="small"
              onClick={async () => {
                if (hasPermission) {
                  handleRemoveFolder(node.path);
                } else {
                  await handleAddFolder(node.path);
                }
              }}
              disabled={hasPermission && !canRemove}
              color={hasPermission ? 'error' : 'primary'}
            >
              {hasPermission ? <RemoveCircleIcon /> : <AddCircleIcon />}
            </IconButton>
          ) : (
            <Button
              size="small"
              variant={permission === 'write' ? 'contained' : 'outlined'}
              startIcon={permission === 'write' ? <EditIcon /> : <VisibilityIcon />}
              onClick={() => handleTogglePermission(node.path)}
              disabled={isUserBaseFolder}
              color={permission === 'write' ? 'primary' : undefined}
              sx={{ minWidth: 80 }}
            >
              {permission === 'write' ? '쓰기' : '읽기'}
            </Button>
          )}
        </Box>
        {isExpanded && hasChildren && (
          <Box sx={{ pl: 2 }}>
            {node.children.map(child => renderFolderTree(child.path, level + 1, isSelected))}
          </Box>
        )}
      </Box>
    );
  };

  const getSelectedFoldersTree = () => {
    // selectedPermissions에 있는 모든 경로를 수집
    const selectedPaths = Array.from(selectedPermissions.keys());
    
    if (selectedPaths.length === 0) return [];
    
    // 경로를 기반으로 트리 구조 생성
    const pathMap = new Map();
    
    if (isAdminMode) {
      // 관리자 모드: 루트부터 시작하는 트리 구조
      // selectedPermissions에 있는 경로만 사용하여 노드 생성
      selectedPaths.forEach(path => {
        if (path === '/') {
          // 루트 경로가 선택된 경우
          const treeNode = folderTree.get('/');
          pathMap.set('/', {
            path: '/',
            name: treeNode?.name || 'Root',
            children: [],
            parentPath: null
          });
        } else {
          // folderTree에서 정보를 가져오거나, 없으면 경로에서 생성
          const treeNode = folderTree.get(path);
          const parts = path.split('/').filter(Boolean);
          const name = parts[parts.length - 1] || path;
          
          // 부모 경로 찾기: selectedPermissions에 있는 가장 가까운 상위 경로
          // 경로가 실제로 부모 경로로 시작하는지 확인
          let parentPath = null;
          for (let i = parts.length - 1; i > 0; i--) {
            const parentCandidate = '/' + parts.slice(0, i).join('/');
            // 부모 경로가 selectedPermissions에 있고, 현재 경로가 실제로 그 부모의 자식인지 확인
            if (selectedPermissions.has(parentCandidate) && path.startsWith(parentCandidate + '/')) {
              parentPath = parentCandidate;
              break;
            }
          }
          
          pathMap.set(path, {
            path: path,
            name: treeNode?.name || name,
            children: [],
            parentPath: parentPath
          });
        }
      });
      
      // 트리 구조 구성
      const buildTree = (parentPath) => {
        const children = [];
        pathMap.forEach((node, path) => {
          // 선택된 경로만 표시 (이중 체크)
          if (!selectedPermissions.has(path)) return;
          
          // 부모 경로 매칭
          let isChildOfParent = false;
          if (parentPath === null) {
            // 루트의 직접 자식들 (parentPath가 null이고, 루트 자체는 제외)
            isChildOfParent = node.parentPath === null && path !== '/';
          } else {
            // 특정 경로의 자식들 - 경로가 실제로 부모 경로의 자식인지 확인
            isChildOfParent = node.parentPath === parentPath && path.startsWith(parentPath + '/');
          }
          
          if (isChildOfParent) {
            const childNode = {
              ...node,
              children: buildTree(path)
            };
            children.push(childNode);
          }
        });
        return children.sort((a, b) => a.name.localeCompare(b.name));
      };
      
      // 루트부터 시작 (null은 루트의 직접 자식들을 의미)
      return buildTree(null);
    } else {
      // 공유 모드: 선택한 폴더부터 시작하는 트리 구조
      // selectedPermissions에 있는 경로만 사용하여 노드 생성
      selectedPaths.forEach(path => {
        if (path === rootPath) {
          const treeNode = folderTree.get(rootPath);
          pathMap.set(rootPath, {
            path: rootPath,
            name: treeNode?.name || folderName,
            children: [],
            parentPath: null
          });
        } else if (path.startsWith(rootPath + '/')) {
          // folderTree에서 정보를 가져오거나, 없으면 경로에서 생성
          const treeNode = folderTree.get(path);
          const relativePath = path.substring(rootPath.length + 1);
          const relativeParts = relativePath.split('/').filter(Boolean);
          const name = relativeParts[relativeParts.length - 1] || path;
          
          // 부모 경로 찾기: selectedPermissions에 있는 가장 가까운 상위 경로
          // 경로가 실제로 부모 경로로 시작하는지 확인
          let parentPath = rootPath;
          if (relativeParts.length > 1) {
            for (let i = relativeParts.length - 1; i > 0; i--) {
              const parentCandidate = rootPath === '/' 
                ? '/' + relativeParts.slice(0, i).join('/')
                : rootPath + '/' + relativeParts.slice(0, i).join('/');
              // 부모 경로가 selectedPermissions에 있고, 현재 경로가 실제로 그 부모의 자식인지 확인
              if (selectedPermissions.has(parentCandidate) && path.startsWith(parentCandidate + '/')) {
                parentPath = parentCandidate;
                break;
              }
            }
          }
          
          pathMap.set(path, {
            path: path,
            name: treeNode?.name || name,
            children: [],
            parentPath: parentPath
          });
        }
      });
      
      const buildTree = (parentPath) => {
        const children = [];
        pathMap.forEach((node, path) => {
          // 선택된 경로만 표시 (이중 체크)
          if (!selectedPermissions.has(path)) return;
          
          let isChildOfParent = false;
          if (parentPath === rootPath) {
            isChildOfParent = node.parentPath === rootPath && path !== rootPath;
          } else {
            // 특정 경로의 자식들 - 경로가 실제로 부모 경로의 자식인지 확인
            isChildOfParent = node.parentPath === parentPath && path.startsWith(parentPath + '/');
          }
          
          if (isChildOfParent) {
            const childNode = {
              ...node,
              children: buildTree(path)
            };
            children.push(childNode);
          }
        });
        return children.sort((a, b) => a.name.localeCompare(b.name));
      };
      
      const rootNode = pathMap.get(rootPath);
      if (rootNode) {
        return [{
          ...rootNode,
          children: buildTree(rootPath)
        }];
      }
      
      return buildTree(rootPath);
    }
  };

  const renderSelectedFolderTree = (nodes, level = 0) => {
    if (!nodes || nodes.length === 0) return null;
    
    const userBaseFolder = isAdminMode ? `/${username}` : null;
    
    return nodes.map(node => {
      const isExpanded = selectedExpandedPaths.has(node.path);
      const permission = selectedPermissions.get(node.path) || 'read';
      const hasChildren = node.children && node.children.length > 0;
      const isUserBaseFolder = isAdminMode && node.path === userBaseFolder;
      
      return (
        <Box key={node.path}>
          <Box sx={{ display: 'flex', alignItems: 'center', py: 0.5, pl: level * 2 }}>
            <IconButton
              size="small"
              onClick={() => toggleExpand(node.path, true)}
              sx={{ mr: 0.5 }}
            >
              {isExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
            </IconButton>
            {isExpanded ? <FolderOpenIcon sx={{ fontSize: 16, mr: 0.5 }} /> : <FolderIcon sx={{ fontSize: 16, mr: 0.5 }} />}
            <Typography variant="body2" sx={{ flex: 1, mr: 1 }}>
              {node.name || node.path}
            </Typography>
            <Button
              size="small"
              variant={permission === 'write' ? 'contained' : 'outlined'}
              startIcon={permission === 'write' ? <EditIcon /> : <VisibilityIcon />}
              onClick={() => handleTogglePermission(node.path)}
              disabled={isUserBaseFolder}
              color={permission === 'write' ? 'primary' : undefined}
              sx={{ minWidth: 80 }}
            >
              {permission === 'write' ? '쓰기' : '읽기'}
            </Button>
          </Box>
          {isExpanded && hasChildren && (
            <Box sx={{ pl: 2 }}>
              {renderSelectedFolderTree(node.children, level + 1)}
            </Box>
          )}
        </Box>
      );
    });
  };

  const handleSave = async () => {
    if (isAdminMode) {
      // 관리자 모드: 사용자 권한 일괄 업데이트
      try {
        const userBaseFolder = `/${username}`;
        const permissions = Array.from(selectedPermissions.entries())
          .map(([folderPath, permission]) => ({
            folderPath,
            permission: folderPath === userBaseFolder ? 'write' : permission // 사용자 기본 폴더는 항상 쓰기
          }));
        
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
      // 공유 모드: 선택한 사용자에게 폴더 공유
      if (!selectedUserId) {
        if (onMessage) {
          onMessage({
            text: '공유할 사용자를 선택해주세요.',
            type: 'error'
          });
        }
        return;
      }

      if (selectedPermissions.size === 0) {
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
        // 각 폴더에 대해 권한 부여
        const permissions = Array.from(selectedPermissions.entries());
        
        // 경로 정규화 헬퍼 함수 (끝의 슬래시 제거)
        const normalizePath = (p) => {
          if (!p || p === '/') return '/';
          return p.endsWith('/') ? p.slice(0, -1) : p;
        };
        
        for (const [folderPath, permission] of permissions) {
          // 폴더 경로 정규화 (끝에 / 제거하여 관리자 모드와 일관성 유지)
          const normalizedPath = normalizePath(folderPath);
          
          try {
            await axios.post('/api/permissions/grant', {
              userId: selectedUserId,
              folderPath: normalizedPath,
              permission: permission
            });
          } catch (error) {
            console.error(`Failed to grant permission for ${normalizedPath}:`, error);
            throw error;
          }
        }
        
        if (onMessage) {
          onMessage({
            text: `${selectedUsername}에게 폴더 공유가 완료되었습니다.`,
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
    if (!isAdminMode) {
      setSelectedUserId(null);
      setSelectedUsername(null);
    }
    setSelectedPermissions(new Map());
    setFolderTree(new Map());
    setExpandedPaths(new Set());
    setSelectedExpandedPaths(new Set());
    onClose();
  };

  const dialogTitle = isAdminMode 
    ? `권한 설정 - ${username}` 
    : `폴더 공유 - ${folderName}`;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: '90vh' }
      }}
    >
      <DialogTitle>
        {dialogTitle}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'hidden' }}>
        {/* 폴더 트리 영역 */}
        <Box sx={{ display: 'flex', gap: 2, flex: 1, overflow: 'hidden' }}>
          {/* 좌측: 디렉토리 선택 */}
          <Box sx={{ flex: 1, borderRight: 1, borderColor: 'divider', pr: 2, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              디렉토리 선택
            </Typography>
            <Box sx={{ mt: 1 }}>
              {folderTree.size === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  폴더를 불러오는 중...
                </Typography>
              ) : (
                renderFolderTree(rootPath, 0, false)
              )}
            </Box>
          </Box>

          {/* 우측: 권한 설정 */}
          <Box sx={{ flex: 1, pl: 2, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              권한 설정
            </Typography>
            <Box sx={{ mt: 1 }}>
              {selectedPermissions.size === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  선택된 폴더가 없습니다.
                </Typography>
              ) : (
                renderSelectedFolderTree(getSelectedFoldersTree(), 0)
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* 사용자 선택 영역 (공유 모드일 때만) */}
        {isShareMode && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body1">
              공유 대상:
            </Typography>
            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel>사용자 선택</InputLabel>
              <Select
                value={selectedUserId || ''}
                onChange={(e) => {
                  const userId = e.target.value;
                  setSelectedUserId(userId);
                  const user = users.find(u => u.id === userId);
                  setSelectedUsername(user ? user.username : null);
                }}
                disabled={loadingUsers}
                label="사용자 선택"
                MenuProps={{
                  PaperProps: {
                    style: {
                      maxHeight: '75vh',
                    },
                  },
                }}
              >
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {user.username} ({user.email})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedUsername && (
              <Chip
                label={selectedUsername}
                onDelete={() => {
                  setSelectedUserId(null);
                  setSelectedUsername(null);
                }}
              />
            )}
          </Box>
        )}
        {isAdminMode && <Box />}
        <Box>
          <Button onClick={handleClose} disabled={saving}>
            취소
          </Button>
          <Button 
            onClick={handleSave} 
            variant="contained" 
            color="primary" 
            disabled={saving || (isShareMode && !selectedUserId)} 
            sx={{ ml: 1 }}
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default ShareDialog;
