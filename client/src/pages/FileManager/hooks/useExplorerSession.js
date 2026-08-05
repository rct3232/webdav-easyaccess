import { useCallback, useEffect, useMemo, useState } from 'react';
import { VIEW_MODES } from '../../../constants/fileManager';
import { sortFiles } from '../../../utils/fileUtils';
import {
  getSortMode,
  getViewMode,
  setViewMode as saveViewMode,
  setSortMode as saveSortMode,
} from '../../../utils/localStorage';
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll';

export const useExplorerSession = ({
  currentPath,
  files: filesFromListing,
  initialSearchQuery = '',
  isMobile = false,
} = {}) => {
  const sessionKey = useMemo(() => currentPath || '/', [currentPath]);

  const [viewMode, setViewMode] = useState(() => getViewMode());
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
    saveSortMode(sortMode);
  }, [sortMode]);

  // Mobile: preserve current behavior (detail mode is not allowed)
  useEffect(() => {
    if (isMobile && viewMode === VIEW_MODES.DETAIL) {
      setViewMode(VIEW_MODES.LIST);
    }
  }, [isMobile, viewMode]);

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

    filteredFiles,
    sortedFiles,
    displayedFiles,
    loadMoreRef,
    hasMore,

    handleThumbnailsLoaded,
  };
};

