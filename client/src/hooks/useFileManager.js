import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listFiles, getWebDAVInfo, checkPermission, listFilePermissions, getFilesMetadata } from '../services/fileService';
import { getShowHiddenFiles, getSortMode } from '../utils/localStorage';
import { getRecentFiles } from '../utils/recentFiles';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { normalizePath, getParentPath, getBasename } from '../utils/pathUtils';
import { filterOutUserOwnFolders } from '../utils/userUtils';
import { getUserPermissions } from '../services/permissionService';

export const useFileManager = (user, options = {}) => {
  const { onLoadComplete, onLoadError, shareToken, linkInfo } = options;
  const { '*' : urlPath } = useParams();
  const navigate = useNavigate();
  
  const onLoadCompleteRef = useRef(onLoadComplete);
  const onLoadErrorRef = useRef(onLoadError);

  const shareRootPath = useMemo(
    () => (linkInfo ? normalizePath(linkInfo.filePath || '/') : ''),
    [linkInfo]
  );

  const currentPathFromUrl = useMemo(() => {
    const path = urlPath ? `/${urlPath}` : '/';
    return normalizePath(path);
  }, [urlPath]);

  const [shareCurrentPath, setShareCurrentPath] = useState(() =>
    shareToken && linkInfo ? normalizePath(linkInfo.filePath || '/') : ''
  );

  useEffect(() => {
    if (shareToken && linkInfo && shareRootPath) {
      setShareCurrentPath(shareRootPath);
    }
  }, [shareToken, linkInfo, shareRootPath]);

  const currentPath = shareToken && linkInfo ? shareCurrentPath : currentPathFromUrl;

  const setCurrentPath = useCallback(
    (path) => {
      const normalizedPath = normalizePath(path);
      if (shareToken && linkInfo) {
        setShareCurrentPath(normalizedPath);
      } else {
        const navigatePath = normalizedPath === '/' ? '' : normalizedPath.substring(1);
        navigate(`/files/${navigatePath}`);
      }
    },
    [shareToken, linkInfo, navigate]
  );

  const [files, setFiles] = useState([]);
  // loading: 파일 목록 로딩 중인지 여부 (초기 로딩 및 새로고침 모두 포함)
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState(() => getSortMode());
  const [webdavUrl, setWebdavUrl] = useState('');
  const [hasWritePermission, setHasWritePermission] = useState(false);
  const requestIdRef = useRef(0);
  const prevPathRef = useRef(currentPath);
  const permRequestIdRef = useRef(0);
  
  // onLoadComplete ref 업데이트 (의존성 배열에 포함하지 않기 위해)
  useEffect(() => {
    onLoadCompleteRef.current = onLoadComplete;
    onLoadErrorRef.current = onLoadError;
  }, [onLoadComplete, onLoadError]);

  const loadFiles = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const targetPath = currentPath;
    try {
      // 공유 링크 모드: listFiles with shareToken only
      if (shareToken && linkInfo) {
        const data = await listFiles(targetPath, { shareToken });
        if (requestId === requestIdRef.current) {
          setFiles(data);
        }
        return;
      }

      // 최근 파일 뷰인 경우 특별 처리
      if (targetPath === '/__recent__') {
        const recentFilesList = await getRecentFiles();
        // 최근 파일을 파일 목록 형식으로 변환
        const recentFilesAsList = recentFilesList.map((recentFile) => {
          const fileName = recentFile.path.substring(recentFile.path.lastIndexOf('/') + 1);
          return {
            path: recentFile.path,
            basename: fileName,
            name: fileName,
            type: recentFile.type || 'file',
            size: 0,
            lastmod: null,
            lastmodified: recentFile.lastAccessed,
            hasReadPermission: true,
            hasWritePermission: false, // 최근 파일은 읽기 전용으로 표시
            isRecentFile: true, // 최근 파일임을 표시
          };
        });
        const recentFilePaths = recentFilesAsList.filter((e) => e.type === 'file').map((e) => e.path);
        if (recentFilePaths.length > 0) {
          try {
            const metaList = await getFilesMetadata(recentFilePaths);
            const metaByPath = new Map(metaList.map((m) => [m.path, m]));
            recentFilesAsList.forEach((entry) => {
              if (entry.type !== 'file') return;
              const meta = metaByPath.get(entry.path);
              if (meta) {
                entry.size = meta.size != null ? meta.size : 0;
                entry.lastmod = meta.lastmod ?? null;
                entry.mime = meta.mime ?? null;
              }
            });
          } catch (metaErr) {
            console.error('[useFileManager] Failed to load metadata for __recent__ entries:', metaErr);
          }
        }
        if (requestId === requestIdRef.current) {
          setFiles(recentFilesAsList);
        }
      } else if (targetPath === '/__shared__') {
        // 공유된 폴더 목록을 가져옴
        const data = await getUserPermissions(user?.id);
        const sharedFolders = filterOutUserOwnFolders(data || [], user);
        
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
        
        // 최상위 폴더들만 표시 (각 폴더의 실제 내용은 클릭했을 때 표시)
        const folderEntries = topLevelFolders.map(([normalizedPath, perm]) => {
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
            hasWritePermission: perm.permission === 'write' || perm.permission === 'admin',
            hasAdminPermission: perm.permission === 'admin'
          };
        });

        // 경로에는 권한이 없고(noauth) 해당 파일에만 독립 권한이 있는 파일을 공유됨에 노출
        let fileOnlyEntries = [];
        try {
          const filePermList = await listFilePermissions();
          if (Array.isArray(filePermList) && filePermList.length > 0) {
            fileOnlyEntries = filePermList
              .filter(({ filePath }) => {
                const normalized = normalizePath(filePath);
                const parentPath = getParentPath(normalized);
                return parentPath !== undefined && parentPath !== null && !permissionPaths.has(parentPath);
              })
              .map(({ filePath, permission }) => {
                const normalized = normalizePath(filePath);
                const name = getBasename(normalized) || normalized;
                return {
                  path: normalized,
                  basename: name,
                  name: name,
                  type: 'file',
                  size: 0,
                  lastmodified: null,
                  hasReadPermission: true,
                  hasWritePermission: permission === 'write' || permission === 'admin',
                  hasAdminPermission: permission === 'admin'
                };
              });
          }
        } catch (err) {
          console.error('[useFileManager] Failed to load file-only permissions for __shared__:', err);
        }

        const filePaths = fileOnlyEntries.map((e) => e.path);
        if (filePaths.length > 0) {
          try {
            const metaList = await getFilesMetadata(filePaths);
            const metaByPath = new Map(metaList.map((m) => [m.path, m]));
            fileOnlyEntries.forEach((entry) => {
              const meta = metaByPath.get(entry.path);
              if (meta) {
                entry.size = meta.size != null ? meta.size : 0;
                entry.lastmod = meta.lastmod ?? null;
                entry.mime = meta.mime ?? null;
              }
            });
          } catch (metaErr) {
            console.error('[useFileManager] Failed to load metadata for __shared__ file-only entries:', metaErr);
          }
        }

        const sharedFiles = [...folderEntries, ...fileOnlyEntries];

        if (requestId === requestIdRef.current) {
          setFiles(sharedFiles);
        }
      } else {
        try {
          const data = await listFiles(targetPath);
          // 숨김 파일 필터링 (옵션이 꺼져있으면 isHidden === true인 항목 제외)
          const showHiddenFiles = getShowHiddenFiles();
          let filteredData = showHiddenFiles 
            ? data 
            : data.filter(item => !item.isHidden);
          // 비관리자: 폴더/파일 공통 hasAdminPermission 보강 (공유 버튼 표시용 - admin 권한이 있을 때만)
          if (user && !user.is_admin && filteredData.length > 0) {
            try {
              const perms = await getUserPermissions(user.id);
              const adminPrefixes = (perms || [])
                .filter(p => p.permission === 'admin')
                .map(p => normalizePath(p.folder_path));
              filteredData = filteredData.map(item => {
                if (!item.path) return item;
                const np = normalizePath(item.path);
                const hasAdmin = adminPrefixes.some(ap => np === ap || np.startsWith(ap + '/'));
                return { ...item, hasAdminPermission: hasAdmin };
              });
            } catch (permErr) {
              console.error('[useFileManager] Failed to load permissions for hasAdminPermission:', permErr);
            }
          }
          // 모든 항목 표시 (직접 권한이 없는 디렉토리는 비활성화 상태로 표시)
          if (requestId === requestIdRef.current) {
            setFiles(filteredData);
          }
        } catch (error) {
          // 403 에러 등 권한 관련 에러 처리
          if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
            console.error('Access denied:', error);
            if (requestId === requestIdRef.current) {
              setFiles([]);
            }
            // 에러는 상위 컴포넌트에서 처리하도록 전달
            throw error;
          }
          throw error;
        }
      }
    } catch (error) {
      // onLoadError 콜백 호출
      if (onLoadErrorRef.current) {
        try {
          await onLoadErrorRef.current(error, targetPath);
        } catch (callbackError) {
          console.error('[useFileManager] Error in onLoadError callback:', callbackError);
        }
      }
      // 403 에러가 아닌 경우에만 빈 배열로 설정
      if (error.response?.status !== HTTP_STATUS.FORBIDDEN && requestId === requestIdRef.current) {
        setFiles([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        // 로딩 완료 시 콜백 호출
        // ref를 사용하여 의존성 배열에 포함하지 않음 (무한 루프 방지)
        onLoadCompleteRef.current?.();
      }
    }
  }, [currentPath, user, shareToken, linkInfo]);

  useEffect(() => {
    if (shareToken && linkInfo) return;
    if (user && !user.is_admin) {
      const userFolder = `/${user.username}`;
      // 특수 경로는 리다이렉트하지 않음
      if (currentPath === '/__shared__' || currentPath === '/__recent__') {
        return;
      }
      // 공유된 폴더 접근을 허용하기 위해 경로 제한 완화
      // 단, 루트 경로(/)만 자신의 폴더로 리다이렉트
      if (currentPath === '/') {
        setCurrentPath(userFolder);
      }
      // 다른 경로는 서버에서 권한 체크를 하므로 허용
    }
  }, [shareToken, linkInfo, user, currentPath, setCurrentPath]);

  useEffect(() => {
    if (currentPath) {
      // Clear current list only when navigating to a different path.
      // Keep the list intact for refreshes (loadFiles called without path change).
      if (prevPathRef.current !== currentPath) {
        setFiles([]);
      }
      prevPathRef.current = currentPath;

      loadFiles();
      // 특수 경로는 쓰기 권한 체크 불필요 (읽기 전용 뷰)
      if (currentPath === '/__shared__' || currentPath === '/__recent__') {
        setHasWritePermission(false);
      } else {
        // user가 설정되지 않았으면 권한 체크 건너뛰기
        if (!user) {
          // 초기 로딩 중이므로 권한 체크 대기
          // user가 설정되면 이 useEffect가 다시 실행됨
          return;
        }
        
        // 현재 경로의 쓰기 권한 확인
        const loadPermission = async () => {
          const permId = ++permRequestIdRef.current;
          try {
            const permission = await checkPermission(currentPath);
            // Ignore stale results: when redirecting / -> /username, older loadPermission('/') can complete after loadPermission('/username')
            if (permId !== permRequestIdRef.current) return;
            setHasWritePermission(permission.hasWrite);
          } catch (error) {
            console.error('Failed to check permission:', error);
            if (permId !== permRequestIdRef.current) return;
            // 에러 발생 시 기본값: 관리자는 true, 일반 사용자는 자신의 폴더인지 확인
            // 단, 권한 체크 실패 시에는 보안을 위해 false로 설정하는 것이 안전함
            if (user?.is_admin) {
              setHasWritePermission(true);
            } else {
              const userFolder = `/${user?.username || ''}`;
              // 자신의 폴더인 경우에만 기본값으로 쓰기 권한 부여
              setHasWritePermission(currentPath === userFolder || currentPath === userFolder + '/' || currentPath.startsWith(userFolder + '/'));
            }
          }
        };
        loadPermission();
      }
    }
  }, [currentPath, loadFiles, user]);

  useEffect(() => {
    if (shareToken && linkInfo) return;
    const loadWebDAVUrl = async () => {
      try {
        const info = await getWebDAVInfo();
        setWebdavUrl(info.url || '');
      } catch (error) {
        console.error('Failed to load WebDAV URL:', error);
      }
    };
    loadWebDAVUrl();
  }, [shareToken, linkInfo]);

  return {
    currentPath,
    setCurrentPath,
    files,
    loading,
    sortMode,
    setSortMode,
    webdavUrl,
    loadFiles,
    hasWritePermission,
    onLoadErrorRef, // 외부에서 onLoadError를 업데이트하기 위해 반환
  };
};

