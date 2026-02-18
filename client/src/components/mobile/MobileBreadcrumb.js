import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, IconButton } from '@mui/material';
import {
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  Share as ShareIcon,
  AccessTime as AccessTimeIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';
import { getUserPermissions } from '../../services/permissionService';
import { normalizePath } from '../../utils/pathUtils';
import { isUserOwnFolder, filterOutUserOwnFolders } from '../../utils/userUtils';

/**
 * Mobile-friendly breadcrumb navigation component
 * Displays current path as clickable chips for easy navigation
 * When shareRootPath is set, uses share mode: root = share folder, segments = path within share
 */
const MobileBreadcrumb = ({ currentPath, onPathClick, user, onToggleFolderTree, isFolderTreeOpen, shareRootPath, shareRootName, showFolderTreeToggle }) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef(null);
  const [sharedPermissionPaths, setSharedPermissionPaths] = useState(new Set());

  // 공유된 폴더 권한 정보 로드 (로그인한 사용자만; 공유 링크 뷰에서는 user 없음 → 호출 안 함)
  useEffect(() => {
    if (!user?.id || user?.is_admin || !currentPath || currentPath === '/' || isUserOwnFolder(currentPath, user)) {
      setSharedPermissionPaths(new Set());
      return;
    }
    const loadSharedFolders = async () => {
      try {
        const data = await getUserPermissions(user.id);
        const sharedFolders = filterOutUserOwnFolders(data || [], user);

        const permissionPaths = new Set();
        sharedFolders.forEach(perm => {
          permissionPaths.add(normalizePath(perm.folder_path));
        });

        setSharedPermissionPaths(permissionPaths);
      } catch (error) {
        console.error('Failed to load shared folders:', error);
        setSharedPermissionPaths(new Set());
      }
    };

    loadSharedFolders();
  }, [user, currentPath]);

  // Parse path segments - FileTree처럼 표시 (유저 폴더 제외, 공유 폴더는 직접 권한이 있는 경로만)
  const getPathSegments = () => {
    // Share link mode: path from shareRootPath
    if (shareRootPath) {
      const normRoot = normalizePath(shareRootPath);
      const normCurrent = normalizePath(currentPath);
      if (normCurrent === normRoot || !normCurrent.startsWith(normRoot)) {
        return [];
      }
      const suffix = normCurrent.slice(normRoot.endsWith('/') ? normRoot.length : normRoot.length + 1);
      if (!suffix) return [];
      const parts = suffix.split('/').filter(Boolean);
      const segments = [];
      let builtPath = normRoot.endsWith('/') ? normRoot.slice(0, -1) : normRoot;
      parts.forEach((part) => {
        builtPath = builtPath === '/' ? `/${part}` : `${builtPath}/${part}`;
        segments.push({ name: part, path: builtPath });
      });
      return segments;
    }

    if (currentPath === '/__shared__' || currentPath === '/__recent__') {
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
  const isRecentView = !shareRootPath && currentPath === '/__recent__';
  const isSharedView = !shareRootPath && (currentPath === '/__shared__' || currentPath.startsWith('/__shared__') || (!user?.is_admin && currentPath && currentPath !== '/' && !currentPath.startsWith(`/${user?.username || ''}`) && !isRecentView));
  
  let homeIcon, homeLabel, homePath;
  if (isRecentView) {
    homeIcon = <AccessTimeIcon />;
    homeLabel = t('nav.recentShort');
    homePath = '/__recent__';
  } else if (shareRootPath) {
    homeIcon = <ShareIcon />;
    homeLabel = shareRootName || normalizePath(shareRootPath).split('/').filter(Boolean).pop() || t('nav.sharedFolder');
    homePath = normalizePath(shareRootPath);
  } else if (isSharedView) {
    homeIcon = <ShareIcon />;
    homeLabel = t('nav.shared');
    homePath = '/__shared__';
  } else {
    homeIcon = <HomeIcon />;
    homeLabel = user?.is_admin ? t('nav.all') : t('nav.home');
    homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
  }

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
      
      {(!shareRootPath || showFolderTreeToggle) && onToggleFolderTree && (
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
        title={isFolderTreeOpen ? t('nav.folderTreeClose') : t('nav.folderTreeOpen')}
      >
        {isFolderTreeOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
      </IconButton>
      )}
    </Box>
  );
};

export default MobileBreadcrumb;
