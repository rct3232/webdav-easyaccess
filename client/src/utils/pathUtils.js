/**
 * Path utilities: re-export from shared with client-specific options (treatAsRoot);
 * local helper for UI (toFilesPath). Supports virtual roots via VIRTUAL_ROOTS.
 */
import {
  normalizePath as sharedNormalizePath,
  getParentPath as sharedGetParentPath,
  getBasename,
} from '@webdav-easyaccess/shared/pathUtils';

const VIRTUAL_ROOTS = ['/__shared__', '/__recent__', '/__trash__'];

export const normalizePath = sharedNormalizePath;

export const getParentPath = (path) => sharedGetParentPath(path, { treatAsRoot: VIRTUAL_ROOTS });

export { getBasename };

/**
 * linkInfo.filePath를 /files/... 경로로 변환
 * @param {string} filePath - 정규화된 파일/폴더 경로
 * @returns {string} /files/... 형태의 라우트 경로
 */
export const toFilesPath = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return '/files';
  const normalized = sharedNormalizePath(filePath)
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  return normalized ? `/files/${normalized}` : '/files';
};
