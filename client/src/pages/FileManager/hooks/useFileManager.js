import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import explorerGateway from '../../../services/explorerGateway';
import { resolvePath, getAncestors } from '../../../services/fileService';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { normalizePath, getParentPath, getBasename } from '../../../utils/pathUtils';

const VIRTUAL_RECENT = '__recent__';
const VIRTUAL_SHARED = '__shared__';
const VIRTUAL_TRASH = '__trash__';
const TRASH_TRAIL_MAX_DEPTH = 32;

export const useFileManager = (user, options = {}) => {
  const { onLoadComplete, onLoadError, shareToken, linkInfo } = options;
  const { '*': urlPath } = useParams();
  const navigate = useNavigate();

  const onLoadCompleteRef = useRef(onLoadComplete);
  const onLoadErrorRef = useRef(onLoadError);

  const isShareMode = Boolean(shareToken && linkInfo);

  const shareRootPath = useMemo(
    () => (linkInfo ? normalizePath(linkInfo.displayPath || linkInfo.filePath || '/') : ''),
    [linkInfo]
  );

  const [shareCurrentPath, setShareCurrentPath] = useState(() =>
    isShareMode ? normalizePath(linkInfo.displayPath || linkInfo.filePath || '/') : ''
  );

  // Current share folder, keyed by nodeId (null = share root listed via shareToken).
  const [shareCurrentNodeId, setShareCurrentNodeId] = useState(() =>
    isShareMode && linkInfo?.nodeId != null ? linkInfo.nodeId : null
  );

  useEffect(() => {
    if (isShareMode && shareRootPath) {
      setShareCurrentPath(shareRootPath);
    }
  }, [isShareMode, shareRootPath]);

  // Normalize the /files splat into a view key.
  // Real folders: /files/node/<nodeId>; virtual roots: /files/__recent__ / /files/__shared__;
  // legacy path URLs (e.g. /files/<username>/a/b) are bootstrapped through resolve-path.
  const urlView = useMemo(() => {
    const normalized = urlPath ? urlPath.replace(/\/+$/, '') : '';
    if (!normalized) {
      return { kind: 'home', path: '/' };
    }
    const segments = normalized.split('/');
    const first = segments[0];
    if (first === 'node') {
      const id = Number(segments[1]);
      return {
        kind: 'node',
        nodeId: Number.isInteger(id) && id > 0 ? id : null,
        path: `/${normalized}`,
      };
    }
    if (first === VIRTUAL_RECENT) return { kind: 'recent', path: '/__recent__' };
    if (first === VIRTUAL_SHARED) return { kind: 'shared', path: '/__shared__' };
    if (first === VIRTUAL_TRASH) {
      // Trash view (DEF-16 P9): /files/__trash__ lists topmost trashed items;
      // /files/__trash__/node/<nodeId> lists the trashed children of that
      // trashed folder (hierarchical navigation).
      const trashNodeId =
        segments[1] === 'node' && Number.isInteger(Number(segments[2])) && Number(segments[2]) > 0
          ? Number(segments[2])
          : null;
      return { kind: 'trash', path: '/__trash__', trashNodeId };
    }
    return { kind: 'legacy', path: `/${normalized}`, legacyPath: `/${normalized}` };
  }, [urlPath]);

  // Admin's home is the filesystem root (`/`), so its homeNodeId is null;
  // regular users get their named home node. Mirrors useFolderTreeController.
  const homeNodeId = user?.is_admin ? null : (user?.rootNodeId ?? null);

  // currentNodeId is the source of truth for the explorer location.
  // null = root / virtual-root level. In share mode it is the current share folder
  // nodeId (null = share root listed via shareToken).
  const currentNodeId = useMemo(() => {
    if (isShareMode) return shareCurrentNodeId;
    if (urlView.kind === 'node') return urlView.nodeId;
    if (urlView.kind === 'home') return homeNodeId;
    return null;
  }, [isShareMode, shareCurrentNodeId, urlView, homeNodeId]);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasWritePermission, setHasWritePermission] = useState(false);
  const [ancestors, setAncestors] = useState([]);
  const [trashTrail, setTrashTrail] = useState([]);
  const trashNameCacheRef = useRef(new Map());
  const requestIdRef = useRef(0);
  const permRequestIdRef = useRef(0);
  const filesRef = useRef([]);
  const prevLocationRef = useRef(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    onLoadCompleteRef.current = onLoadComplete;
    onLoadErrorRef.current = onLoadError;
  }, [onLoadComplete, onLoadError]);

  // Derived display path only (breadcrumbs/labels); not a navigation or lookup key.
  const currentPath = useMemo(() => {
    if (isShareMode) return shareCurrentPath;
    if (urlView.kind === 'recent') return '/__recent__';
    if (urlView.kind === 'shared') return '/__shared__';
    if (urlView.kind === 'trash') return '/__trash__';
    if (urlView.kind === 'node' && ancestors.length > 0) {
      return normalizePath('/' + ancestors.map((a) => a.name || '').join('/'));
    }
    return urlView.path || '/';
  }, [isShareMode, shareCurrentPath, urlView, ancestors]);

  const currentPathRef = useRef(currentPath);
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  // nodeId-first navigation setter: home (null/rootNodeId) -> /files, else /files/node/<id>.
  // Share mode keeps navigation local (share current folder nodeId).
  const setCurrentNodeId = useCallback(
    (nodeId) => {
      if (isShareMode) {
        setShareCurrentNodeId(nodeId ?? null);
        return;
      }
      if (nodeId == null || nodeId === homeNodeId) {
        navigate('/files');
      } else {
        navigate(`/files/node/${nodeId}`);
      }
    },
    [isShareMode, homeNodeId, navigate]
  );

  // Legacy path setter kept for recent-file flows and share display path
  // (Phase 5 keeps recent path-based; share display path drives the breadcrumb only).
  const setCurrentPath = useCallback(
    (path) => {
      const normalizedPath = normalizePath(path);
      if (isShareMode) {
        // Display path only (breadcrumb); navigation is nodeId-first via setCurrentNodeId.
        setShareCurrentPath(normalizedPath);
      } else {
        const navigatePath = normalizedPath === '/' ? '' : normalizedPath.substring(1);
        navigate(`/files/${navigatePath}`);
      }
    },
    [isShareMode, navigate]
  );

  // Legacy path URL bootstrap: resolve-path -> redirect to the nodeId URL.
  useEffect(() => {
    if (isShareMode || urlView.kind !== 'legacy') return undefined;
    let cancelled = false;
    const run = async () => {
      try {
        const data = await resolvePath(urlView.legacyPath);
        if (cancelled) return;
        if (data?.nodeId != null) {
          navigate(`/files/node/${data.nodeId}`, { replace: true });
        } else {
          navigate('/files', { replace: true });
        }
      } catch (error) {
        if (cancelled) return;
        // 404 / resolution failure -> fall back to the root-level listing.
        navigate('/files', { replace: true });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isShareMode, urlView, navigate]);

  // Ancestor chain for the breadcrumb (C2.2). Skipped for virtual views and home.
  useEffect(() => {
    if (
      isShareMode ||
      urlView.kind === 'recent' ||
      urlView.kind === 'shared' ||
      urlView.kind === 'trash' ||
      urlView.kind === 'home'
    ) {
      setAncestors([]);
      return undefined;
    }
    if (currentNodeId == null) {
      setAncestors([]);
      return undefined;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const data = await getAncestors(currentNodeId);
        if (!cancelled) setAncestors(data?.ancestors || []);
      } catch (error) {
        if (!cancelled) setAncestors([]);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isShareMode, urlView.kind, currentNodeId]);

  // Trash-view breadcrumb chain (DEF-16 P9): rebuilt from the session-local
  // trashed-name cache on every trash URL change. Names are cached on
  // openTrashFolder clicks; on direct URL entry the current trashed parent's
  // name is derived from the first listed child's displayPath (loadFiles).
  useEffect(() => {
    if (urlView.kind !== 'trash') {
      setTrashTrail([]);
      return undefined;
    }
    const parentId = urlView.trashNodeId ?? null;
    if (parentId == null) {
      setTrashTrail([]);
      return undefined;
    }
    const cache = trashNameCacheRef.current;
    const trail = [];
    let cursor = parentId;
    let guard = 0;
    while (cursor != null && guard < TRASH_TRAIL_MAX_DEPTH) {
      const entry = cache.get(cursor);
      if (!entry) break;
      trail.unshift({ nodeId: cursor, name: entry.name });
      cursor = entry.parentNodeId ?? null;
      guard += 1;
    }
    setTrashTrail(trail);
    return undefined;
  }, [urlView]);

  const openTrashFolder = useCallback(
    (nodeId, name) => {
      if (nodeId == null) {
        navigate('/files/__trash__');
        return;
      }
      trashNameCacheRef.current.set(nodeId, {
        name: name || `node-${nodeId}`,
        parentNodeId: urlView.kind === 'trash' ? (urlView.trashNodeId ?? null) : null,
      });
      navigate(`/files/__trash__/node/${nodeId}`);
    },
    [navigate, urlView]
  );

  // Fill the trashed parent's breadcrumb name from the first listed child's
  // displayPath when the session cache missed (direct URL entry / refresh).
  const fillTrashNameFromChildren = useCallback((nodeId, items) => {
    const cache = trashNameCacheRef.current;
    if (cache.has(nodeId)) return;
    const first = Array.isArray(items) ? items[0] : null;
    const displayPath = first?.displayPath || first?.path || '';
    if (!displayPath) return;
    const parentPath = getParentPath(displayPath);
    if (!parentPath || parentPath === '/') return;
    const name = getBasename(parentPath);
    if (!name) return;
    cache.set(nodeId, { name, parentNodeId: null });
    setTrashTrail((prev) => {
      if (prev.some((segment) => segment.nodeId === nodeId)) {
        return prev.map((segment) => (segment.nodeId === nodeId ? { ...segment, name } : segment));
      }
      return [...prev, { nodeId, name }];
    });
  }, []);

  const loadFiles = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      if (urlView.kind === 'recent') {
        const recentFilesList = await explorerGateway.loadRecentFiles();
        const recentFilesAsList = recentFilesList.map((recentFile) => {
          const fileName =
            recentFile.name ||
            recentFile.basename ||
            (recentFile.path
              ? recentFile.path.substring(recentFile.path.lastIndexOf('/') + 1)
              : '');
          return {
            nodeId: recentFile.nodeId,
            path: recentFile.path || recentFile.displayPath || '',
            displayPath: recentFile.displayPath || recentFile.path || '',
            basename: fileName,
            name: fileName,
            type: recentFile.type || 'file',
            size: 0,
            lastmod: null,
            lastmodified: recentFile.lastAccessed,
            hasReadPermission: true,
            hasWritePermission: false,
            isRecentFile: true,
          };
        });
        const fileEntries = recentFilesAsList.filter(
          (entry) => entry.type === 'file' && entry.nodeId != null
        );
        if (fileEntries.length > 0) {
          try {
            const metaList = await explorerGateway.getEntriesMetadata({ entries: fileEntries });
            const metaByNodeId = new Map(metaList.map((m) => [m.nodeId, m]));
            recentFilesAsList.forEach((entry) => {
              if (entry.type !== 'file' || entry.nodeId == null) return;
              const meta = metaByNodeId.get(entry.nodeId);
              if (meta) {
                entry.size = meta.size != null ? meta.size : 0;
                entry.lastmod = meta.lastmod ?? null;
                entry.mime = meta.mime ?? null;
              }
            });
          } catch (metaErr) {
            console.error(
              '[useFileManager] Failed to load metadata for __recent__ entries:',
              metaErr
            );
          }
        }
        if (requestId === requestIdRef.current) {
          setFiles(recentFilesAsList);
        }
      } else if (urlView.kind === 'shared') {
        const sharedFiles = await explorerGateway.loadSharedEntries({ user });
        if (requestId === requestIdRef.current) {
          setFiles(sharedFiles);
        }
      } else if (urlView.kind === 'trash') {
        const trashFiles = await explorerGateway.loadTrashEntries(
          urlView.trashNodeId != null ? { parentId: urlView.trashNodeId } : {}
        );
        if (requestId === requestIdRef.current) {
          setFiles(trashFiles);
          if (urlView.trashNodeId != null) {
            fillTrashNameFromChildren(urlView.trashNodeId, trashFiles);
          }
        }
      } else {
        if (!isShareMode && urlView.kind === 'legacy') return;
        const targetNodeId = isShareMode ? shareCurrentNodeId : currentNodeId;
        try {
          const filteredData = await explorerGateway.listDirectory({
            nodeId: targetNodeId ?? null,
            options: {
              shareToken,
              user,
            },
          });
          if (requestId === requestIdRef.current) {
            setFiles(filteredData);
          }
        } catch (error) {
          if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
            console.error('Access denied:', error);
            if (requestId === requestIdRef.current) {
              setFiles([]);
            }
            throw error;
          }
          throw error;
        }
      }
    } catch (error) {
      if (onLoadErrorRef.current) {
        try {
          await onLoadErrorRef.current(error, currentPathRef.current);
        } catch (callbackError) {
          console.error('[useFileManager] Error in onLoadError callback:', callbackError);
        }
      }
      if (error.response?.status !== HTTP_STATUS.FORBIDDEN && requestId === requestIdRef.current) {
        setFiles([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        onLoadCompleteRef.current?.();
      }
    }
  }, [
    urlView.kind,
    urlView.trashNodeId,
    fillTrashNameFromChildren,
    isShareMode,
    shareCurrentNodeId,
    currentNodeId,
    user,
    shareToken,
  ]);

  // Location key drives the listing reload; the display path (ancestors) must not retrigger it.
  // Trash view keys off the trashed-parent nodeId so navigating between trash
  // levels reloads the listing and clears selection like any other view change.
  const locationKey = isShareMode
    ? `share:${shareCurrentNodeId}`
    : urlView.kind === 'trash'
      ? `trash:${urlView.trashNodeId ?? 'root'}`
      : `${urlView.kind}:${currentNodeId}`;

  useEffect(() => {
    if (!locationKey) return undefined;
    if (prevLocationRef.current !== locationKey) {
      setFiles([]);
      prevLocationRef.current = locationKey;
    }

    if (!isShareMode && urlView.kind === 'legacy') return undefined;

    loadFiles();

    if (urlView.kind === 'recent' || urlView.kind === 'shared' || urlView.kind === 'trash') {
      setHasWritePermission(false);
      return undefined;
    }
    if (!user) return undefined;

    const loadPermission = async () => {
      const permId = ++permRequestIdRef.current;
      const targetNodeId = isShareMode ? null : currentNodeId;
      // Admin's home is the filesystem root; there are no grant rows for nested
      // folders, so the check would report no write access and hide the FAB and
      // drag-drop. Defense-in-depth mirror of the server-side admin bypass.
      if (user?.is_admin) {
        setHasWritePermission(true);
        return;
      }
      try {
        const permission = await explorerGateway.getPathAccess({ nodeId: targetNodeId ?? null });
        if (permId !== permRequestIdRef.current) return;
        setHasWritePermission(permission.canWrite);
      } catch (error) {
        console.error('Failed to check permission:', error);
        if (permId !== permRequestIdRef.current) return;
        if (user?.is_admin) {
          setHasWritePermission(true);
        } else {
          setHasWritePermission(false);
        }
      }
    };
    loadPermission();
    return undefined;
  }, [locationKey, urlView.kind, isShareMode, currentNodeId, user, shareToken, loadFiles]);

  useEffect(() => {
    if (urlView.kind !== 'recent') return undefined;

    return explorerGateway.subscribeToRecentFiles(() => {
      loadFiles();
    });
  }, [urlView.kind, user, shareToken, loadFiles]);

  return {
    currentPath,
    setCurrentPath,
    currentNodeId,
    setCurrentNodeId,
    ancestors,
    files,
    loading,
    loadFiles,
    hasWritePermission,
    onLoadErrorRef,
    trashParentNodeId: urlView.kind === 'trash' ? (urlView.trashNodeId ?? null) : null,
    trashTrail,
    openTrashFolder,
  };
};
