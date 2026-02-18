/**
 * Path utilities: re-export from shared with client-specific options (treatAsRoot);
 * local helpers for UI (getFolderName, getFileName, getPathParts, joinPath, isSubPath).
 */
import {
  normalizePath as sharedNormalizePath,
  getParentPath as sharedGetParentPath,
  isRootPath as sharedIsRootPath,
  getBasename,
  isPathUnder,
  getParentPaths,
} from '@webdav-easyaccess/shared/pathUtils';

const VIRTUAL_ROOTS = ['/__shared__', '/__recent__'];

export const normalizePath = sharedNormalizePath;

export const getParentPath = (path) =>
  sharedGetParentPath(path, { treatAsRoot: VIRTUAL_ROOTS });

export const isRootPath = (path) => sharedIsRootPath(path, VIRTUAL_ROOTS);

export { getBasename, getParentPaths };

export const isSubPath = isPathUnder;

/**
 * Get folder name from path (UI / localization).
 * @param {string} path - Path (e.g. '/', '/__shared__', '/__recent__', '/a/b/c')
 * @param {(key: string) => string} [t] - Optional i18n t function; when provided, virtual roots and root use translated labels
 * @returns {string} Display name for the path
 */
export const getFolderName = (path, t) => {
  if (!path || path === '/') {
    return typeof t === 'function' ? t('nav.root') : 'Root';
  }
  if (sharedIsRootPath(path, VIRTUAL_ROOTS)) {
    if (path === '/__shared__') {
      return typeof t === 'function' ? t('nav.shared') : 'Shared';
    }
    if (path === '/__recent__') {
      return typeof t === 'function' ? t('nav.recentShort') : 'Recent';
    }
    return typeof t === 'function' ? t('nav.root') : 'Root';
  }
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || (typeof t === 'function' ? t('nav.root') : 'Root');
};

/**
 * Get file/folder name from path (without localization)
 */
export const getFileName = (path) => {
  if (!path) return '';
  return path.split('/').filter(Boolean).pop() || '';
};

/**
 * Split path into parts
 */
export const getPathParts = (path) => {
  if (!path) return [];
  return path.split('/').filter(Boolean);
};

/**
 * Join path parts
 */
export const joinPath = (...parts) => {
  const joined = parts
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return '/' + joined;
};

/**
 * linkInfo.filePath를 /files/... 경로로 변환
 * @param {string} filePath - 정규화된 파일/폴더 경로
 * @returns {string} /files/... 형태의 라우트 경로
 */
export const toFilesPath = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return '/files';
  const normalized = sharedNormalizePath(filePath).replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  return normalized ? `/files/${normalized}` : '/files';
};
