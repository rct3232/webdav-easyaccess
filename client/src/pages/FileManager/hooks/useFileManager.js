import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import explorerGateway from '../../../services/explorerGateway';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from '../../../utils/pathUtils';

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
  const [hasWritePermission, setHasWritePermission] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const requestIdRef = useRef(0);
  const prevPathRef = useRef(currentPath);
  const permRequestIdRef = useRef(0);
  const filesRef = useRef([]);
  const nodeIdByPathRef = useRef(new Map());
  const pathByNodeIdRef = useRef(new Map());

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const resolveCurrentNodeId = useCallback(() => {
    const targetPath = currentPath;
    if (!targetPath || targetPath === '/' || targetPath === '/__recent__' || targetPath === '/__shared__') {
      return null;
    }
    if (nodeIdByPathRef.current.has(targetPath)) {
      return nodeIdByPathRef.current.get(targetPath);
    }
    const matched = filesRef.current.find(
      (f) => f?.type === 'directory' && (f.path === targetPath || f.display_path === targetPath)
    );
    if (matched && matched.nodeId != null) {
      return matched.nodeId;
    }
    return null;
  }, [currentPath]);

  const resolveNodeIdFromPath = useCallback((path) => {
    const targetPath = normalizePath(path);
    if (!targetPath || targetPath === '/') return null;
    if (nodeIdByPathRef.current.has(targetPath)) {
      const mapped = nodeIdByPathRef.current.get(targetPath);
      if (mapped != null) return mapped;
    }
    const matched = filesRef.current.find(
      (f) => f?.type === 'directory' && (f.path === targetPath || f.display_path === targetPath)
    );
    return matched?.nodeId != null ? matched.nodeId : null;
  }, []);

  const resolvePathFromNodeId = useCallback((nodeId) => {
    if (nodeId == null) return null;
    if (pathByNodeIdRef.current.has(nodeId)) {
      return pathByNodeIdRef.current.get(nodeId) || null;
    }
    const matched = filesRef.current.find((f) => f?.nodeId === nodeId);
    return matched?.path ?? matched?.display_path ?? null;
  }, []);
  
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
      // 최근 파일 뷰인 경우 특별 처리
      if (targetPath === '/__recent__') {
        const recentFilesList = await explorerGateway.loadRecentFiles();
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
        const fileEntries = recentFilesAsList.filter((entry) => entry.type === 'file');
        if (fileEntries.length > 0) {
          try {
            const metaList = await explorerGateway.getEntriesMetadata({ entries: fileEntries });
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
        const sharedFiles = await explorerGateway.loadSharedEntries({ user });
        if (requestId === requestIdRef.current) {
          setFiles(sharedFiles);
        }
      } else {
        const targetNodeId = resolveCurrentNodeId();
        setCurrentNodeId(targetNodeId);
        nodeIdByPathRef.current.set(targetPath, targetNodeId);
        if (targetNodeId != null) {
          pathByNodeIdRef.current.set(targetNodeId, targetPath);
        }
        try {
          const filteredData = await explorerGateway.listDirectory({
            nodeId: targetNodeId ?? null,
            options: {
              shareToken,
              user,
            },
          });
          // 모든 항목 표시 (직접 권한이 없는 디렉토리는 비활성화 상태로 표시)
          if (requestId === requestIdRef.current) {
            (filteredData || []).forEach((item) => {
              if (item?.nodeId == null) return;
              const itemPath = item.path || item.display_path;
              if (itemPath) {
                nodeIdByPathRef.current.set(normalizePath(itemPath), item.nodeId);
                pathByNodeIdRef.current.set(item.nodeId, itemPath);
              }
            });
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
  }, [currentPath, user, shareToken, resolveCurrentNodeId]);

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
          const targetNodeId = resolveCurrentNodeId();
          try {
            const permission = await explorerGateway.getPathAccess({ nodeId: targetNodeId ?? null });
            // Ignore stale results: when redirecting / -> /username, older loadPermission('/') can complete after loadPermission('/username')
            if (permId !== permRequestIdRef.current) return;
            setHasWritePermission(permission.canWrite);
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
  }, [currentPath, user, shareToken, loadFiles, resolveCurrentNodeId]);

  useEffect(() => {
    if (currentPath !== '/__recent__') return undefined;

    return explorerGateway.subscribeToRecentFiles(() => {
      loadFiles();
    });
  }, [currentPath, user, shareToken, loadFiles]);

  return {
    currentPath,
    setCurrentPath,
    currentNodeId,
    setCurrentNodeId,
    files,
    loading,
    loadFiles,
    hasWritePermission,
    resolveNodeIdFromPath,
    resolvePathFromNodeId,
    onLoadErrorRef, // 외부에서 onLoadError를 업데이트하기 위해 반환
  };
};

