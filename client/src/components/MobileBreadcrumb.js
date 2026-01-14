import React, { useEffect, useRef, useState } from 'react';
import { Box, Chip, IconButton } from '@mui/material';
import {
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  Share as ShareIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';
import axios from 'axios';

/**
 * Mobile-friendly breadcrumb navigation component
 * Displays current path as clickable chips for easy navigation
 */
const MobileBreadcrumb = ({ currentPath, onPathClick, user, onToggleFolderTree, isFolderTreeOpen }) => {
  const scrollContainerRef = useRef(null);
  const [sharedPermissionPaths, setSharedPermissionPaths] = useState(new Set());

  // 공유된 폴더 권한 정보 로드
  useEffect(() => {
    if (!user?.is_admin && currentPath && !currentPath.startsWith(`/${user?.username || ''}`) && currentPath !== '/') {
      const loadSharedFolders = async () => {
        try {
          const response = await axios.get(`/api/permissions/user/${user?.id}`);
          const userBaseFolder = `/${user?.username || ''}`;
          
          // 경로 정규화 함수
          const normalizePath = (path) => {
            if (!path || path === '/') return '/';
            return path.endsWith('/') ? path.slice(0, -1) : path;
          };
          
          // 자기 자신의 폴더 제외
          const sharedFolders = response.data.filter(perm => {
            const folderPath = normalizePath(perm.folder_path);
            const normalizedUserBaseFolder = normalizePath(userBaseFolder);
            return !folderPath.startsWith(normalizedUserBaseFolder + '/') && folderPath !== normalizedUserBaseFolder;
          });
          
          // 직접 권한이 있는 경로만 저장
          const permissionPaths = new Set();
          sharedFolders.forEach(perm => {
            const normalized = normalizePath(perm.folder_path);
            permissionPaths.add(normalized);
          });
          
          setSharedPermissionPaths(permissionPaths);
        } catch (error) {
          console.error('Failed to load shared folders:', error);
          setSharedPermissionPaths(new Set());
        }
      };
      
      loadSharedFolders();
    } else {
      setSharedPermissionPaths(new Set());
    }
  }, [user, currentPath]);

  // Parse path segments - FileTree처럼 표시 (유저 폴더 제외, 공유 폴더는 직접 권한이 있는 경로만)
  const getPathSegments = () => {
    if (currentPath === '/__shared__') {
      return [];
    }

    if (!currentPath || currentPath === '/') {
      return [];
    }

    // 공유됨 뷰인지 확인
    if (currentPath.startsWith('/__shared__')) {
      // 공유됨 이후의 경로만 추출
      const sharedPath = currentPath.replace('/__shared__', '');
      if (!sharedPath || sharedPath === '/') {
        return [];
      }
      const parts = sharedPath.split('/').filter(Boolean);
      const segments = [];
      let builtPath = '/__shared__';

      parts.forEach((part) => {
        builtPath += `/${part}`;
        segments.push({
          name: part,
          path: builtPath,
        });
      });

      return segments;
    }

    // 일반 경로 처리 - 유저 홈 폴더 제외
    const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
    if (currentPath === homePath) {
      return [];
    }

    // 공유된 폴더인지 확인 (유저 홈 폴더로 시작하지 않는 경로)
    if (!user?.is_admin && !currentPath.startsWith(homePath)) {
      // FolderPickerDialog의 breadcrumb 로직과 동일하게 처리
      // 권한이 없는 부모 경로만 제외하고, 권한이 있는 경로는 계층 구조 유지
      const normalizePath = (path) => {
        if (!path || path === '/') return '/';
        return path.endsWith('/') ? path.slice(0, -1) : path;
      };
      
      const normalizedCurrentPath = normalizePath(currentPath);
      const pathParts = normalizedCurrentPath.split('/').filter(Boolean);
      
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
        return pathParts.slice(startIndex).map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, startIndex + index + 1).join('/'),
        }));
      } else {
        // 권한이 있는 경로를 찾지 못한 경우 (fallback)
        return pathParts.map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, index + 1).join('/'),
        }));
      }
    }

    // 유저 홈 폴더 하위 경로 처리
    if (!currentPath.startsWith(homePath)) {
      return [];
    }

    // 홈 경로 이후의 부분만 추출
    const relativePath = currentPath.substring(homePath.length);
    if (!relativePath || relativePath === '/') {
      return [];
    }

    const parts = relativePath.split('/').filter(Boolean);
    const segments = [];
    let builtPath = homePath;

    parts.forEach((part) => {
      builtPath += `/${part}`;
      segments.push({
        name: part,
        path: builtPath,
      });
    });

    return segments;
  };

  const segments = getPathSegments();
  const isSharedView = currentPath === '/__shared__' || currentPath.startsWith('/__shared__') || (!user?.is_admin && currentPath && currentPath !== '/' && !currentPath.startsWith(`/${user?.username || ''}`));
  const homeIcon = isSharedView ? <ShareIcon /> : <HomeIcon />;
  const homeLabel = isSharedView ? '공유됨' : user?.is_admin ? '전체' : '홈';
  const homePath = isSharedView ? '/__shared__' : (user?.is_admin ? '/' : `/${user?.username || ''}`);

  // Auto-scroll to the right when currentPath changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
  }, [currentPath]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        ref={scrollContainerRef}
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          flex: 1,
          // Hide scrollbar but keep functionality
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          scrollbarWidth: 'none',
          // Smooth scrolling
          scrollBehavior: 'smooth',
        }}
      >
        <Chip
          icon={homeIcon}
          label={homeLabel}
          onClick={() => onPathClick(homePath)}
          clickable
          color={segments.length === 0 ? 'primary' : 'default'}
          sx={{
            minHeight: 44,
            fontSize: '0.875rem',
            fontWeight: segments.length === 0 ? 600 : 400,
            flexShrink: 0,
          }}
        />
        
        {segments.map((segment, index) => (
          <React.Fragment key={segment.path}>
            <ChevronRightIcon sx={{ mx: 0.5, color: 'text.secondary', flexShrink: 0 }} />
            <Chip
              label={segment.name}
              onClick={() => onPathClick(segment.path)}
              clickable
              color={index === segments.length - 1 ? 'primary' : 'default'}
              sx={{
                minHeight: 44,
                fontSize: '0.875rem',
                fontWeight: index === segments.length - 1 ? 600 : 400,
                flexShrink: 0,
              }}
            />
          </React.Fragment>
        ))}
      </Box>
      
      <IconButton
        onClick={onToggleFolderTree}
        sx={{
          ml: 1,
          flexShrink: 0,
          color: 'primary.main',
          minWidth: 44,
          minHeight: 44,
          transition: 'transform 0.2s',
        }}
        title={isFolderTreeOpen ? '폴더 트리 닫기' : '폴더 트리 열기'}
      >
        {isFolderTreeOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
      </IconButton>
    </Box>
  );
};

export default MobileBreadcrumb;

