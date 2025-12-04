import { useState, useEffect, useCallback, useMemo } from 'react';
import { listFiles, getWebDAVInfo } from '../services/fileService';
import { sortFiles } from '../utils/fileUtils';
import { SORT_MODES } from '../constants/fileManager';

export const useFileManager = (user) => {
  const [currentPath, setCurrentPath] = useState(() => {
    return user?.is_admin ? '/' : `/${user?.username || ''}`;
  });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState(SORT_MODES.NAME_ASC);
  const [webdavUrl, setWebdavUrl] = useState('');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles(currentPath);
      setFiles(data);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  const sortedFiles = useMemo(() => {
    return sortFiles(files, sortMode);
  }, [files, sortMode]);

  useEffect(() => {
    if (user && !user.is_admin) {
      const userFolder = `/${user.username}`;
      if (currentPath === '/' || !currentPath.startsWith(userFolder)) {
        setCurrentPath(userFolder);
      }
    }
  }, [user, currentPath]);

  useEffect(() => {
    if (currentPath) {
      loadFiles();
    }
  }, [currentPath, loadFiles]);

  useEffect(() => {
    const loadWebDAVUrl = async () => {
      try {
        const info = await getWebDAVInfo();
        setWebdavUrl(info.url || '');
      } catch (error) {
        console.error('Failed to load WebDAV URL:', error);
      }
    };
    loadWebDAVUrl();
  }, []);

  return {
    currentPath,
    setCurrentPath,
    files,
    sortedFiles,
    loading,
    sortMode,
    setSortMode,
    webdavUrl,
    loadFiles,
  };
};

