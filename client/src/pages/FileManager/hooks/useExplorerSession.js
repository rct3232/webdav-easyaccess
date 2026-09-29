import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VIEW_MODES } from '../../../constants/fileManager';
import { sortFiles } from '../../../utils/fileUtils';
import {
  getSortMode,
  getViewMode,
  setViewMode as saveViewMode,
  setSortMode as saveSortMode,
  getCollectionMemberViewMode,
  setCollectionMemberViewMode as saveMemberViewMode,
} from '../../../utils/localStorage';
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll';

export const useExplorerSession = ({
  currentNodeId,
  view = 'folder',
  files: filesFromListing,
  initialSearchQuery = '',
  isMobile = false,
  onSubmitQuery,
} = {}) => {
  const sessionKey = useMemo(() => {
    if (view === 'recent') return 'view:recent';
    if (view === 'shared') return 'view:shared';
    if (view === 'trash') return 'view:trash';
    return currentNodeId == null ? 'node:root' : `node:${currentNodeId}`;
  }, [view, currentNodeId]);

  const [viewMode, setViewMode] = useState(() => getViewMode());
  // P-4: per-surface view mode of the collection MEMBERS surface — its own
  // localStorage key (`collectionMemberViewMode`, default grid); file browsing
  // keeps `viewMode` untouched.
  const [memberViewMode, setMemberViewMode] = useState(() => getCollectionMemberViewMode());
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [sortMode, setSortMode] = useState(() => getSortMode());

  // Keep a local file list so we can apply in-place view updates (e.g. thumbnails)
  const [files, setFiles] = useState([]);

  useEffect(() => {
    setFiles(Array.isArray(filesFromListing) ? filesFromListing : []);
  }, [filesFromListing]);

  useEffect(() => {
    saveViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    saveMemberViewMode(memberViewMode);
  }, [memberViewMode]);

  useEffect(() => {
    saveSortMode(sortMode);
  }, [sortMode]);

  // Mobile: preserve current behavior (detail mode is not allowed) — the
  // restriction applies to the members key too (P-4, useExplorerSession.md).
  useEffect(() => {
    if (isMobile && viewMode === VIEW_MODES.DETAIL) {
      setViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, viewMode]);

  useEffect(() => {
    if (isMobile && memberViewMode === VIEW_MODES.DETAIL) {
      setMemberViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, memberViewMode]);

  const filteredFiles = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => {
      const name = (file?.basename || file?.name || '').toLowerCase();
      return name.includes(q);
    });
  }, [files, searchQuery]);

  const sortedFiles = useMemo(() => sortFiles(filteredFiles, sortMode), [filteredFiles, sortMode]);

  const { displayedFiles, loadMoreRef, hasMore } = useInfiniteScroll(sortedFiles, {
    initialCount: 50,
    incrementCount: 50,
  });

  const handleThumbnailsLoaded = useCallback((thumbnailMap) => {
    setFiles((prevFiles) => {
      if (!(thumbnailMap instanceof Map) || thumbnailMap.size === 0) return prevFiles;

      const hasChanges = Array.from(thumbnailMap.keys()).some((nodeId) => {
        const file = prevFiles.find((f) => f.nodeId === nodeId);
        return file && !file.thumbnailUrl;
      });

      if (!hasChanges) return prevFiles;

      return prevFiles.map((file) => {
        const thumbnailUrl = thumbnailMap.get(file.nodeId);
        if (thumbnailUrl && !file.thumbnailUrl) {
          return { ...file, thumbnailUrl };
        }
        return file;
      });
    });
  }, []);

  // §3 AI-platform boundary (D1): the server-search submit is NOT owned here.
  // onSubmitQuery is the stable passthrough invoked by FloatingSearchBar on
  // Enter / search-icon press and delegated to the shell wiring
  // (useSearchResults.submitSearch). Stable identity across renders; the hook
  // itself performs no fetch (the no-IO rule stays absolute).
  const onSubmitQueryRef = useRef(onSubmitQuery);
  useEffect(() => {
    onSubmitQueryRef.current = onSubmitQuery;
  }, [onSubmitQuery]);
  const submitQuery = useCallback((query) => {
    if (typeof onSubmitQueryRef.current === 'function') {
      onSubmitQueryRef.current(query);
    }
  }, []);

  return {
    sessionKey,

    files,
    setFiles,

    searchQuery,
    setSearchQuery,

    sortMode,
    setSortMode,

    viewMode,
    setViewMode,

    memberViewMode,
    setMemberViewMode,

    filteredFiles,
    sortedFiles,
    displayedFiles,
    loadMoreRef,
    hasMore,

    handleThumbnailsLoaded,

    onSubmitQuery: submitQuery,
  };
};
