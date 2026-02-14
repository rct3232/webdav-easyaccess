import { get, post, del } from './apiClient';

/**
 * 사용자별 폴더 권한 목록 조회 (WebDAV 존재 폴더만 반환)
 * @param {number} userId - 사용자 ID
 * @returns {Promise<Array>} 권한 배열
 */
export const getUserPermissions = async (userId) => {
  const response = await get(`/permissions/user/${userId}`);
  return response.data;
};

/**
 * 폴더별 권한 목록 조회
 * @param {string} path - 폴더 경로
 * @param {boolean} includeSubfolders - 하위 폴더 포함 여부
 * @param {string} [filePath] - 파일 경로 (지정 시 각 항목에 file_permission 포함)
 * @returns {Promise<Array>} 권한 배열
 */
export const getFolderPermissions = async (path, includeSubfolders = false, filePath) => {
  const params = { path, includeSubfolders: includeSubfolders ? 'true' : 'false' };
  if (filePath != null && filePath !== '') params.filePath = filePath;
  const response = await get('/permissions/folder', { params });
  return response.data;
};

/**
 * 권한 부여 (폴더 또는 파일). 파일일 때는 target: 'file' 전달.
 * @param {Object} params - { userId, folderPath, permission, target? } target 'file'이면 파일 권한
 */
export const grantPermission = async ({ userId, folderPath, permission, target }) => {
  const body = { userId, folderPath, permission };
  if (target != null) body.target = target;
  await post('/permissions/grant', body);
};

/**
 * 권한 철회 (폴더 또는 파일). 파일만 회수할 때는 scope: 'pathOnly' 전달.
 * @param {Object} params - { userId, folderPath, includeSubfolders?, scope? }
 */
export const revokePermission = async ({ userId, folderPath, includeSubfolders = false, scope }) => {
  const params = { userId, folderPath, includeSubfolders: includeSubfolders ? 'true' : 'false' };
  if (scope != null) params.scope = scope;
  await del('/permissions/revoke', { params });
};

/**
 * 현재 사용자의 유효 권한 조회 (경로/파일 공통). 반환: { path, hasRead, hasWrite, source: 'file'|'path' }.
 */
export const checkPermission = async (path) => {
  const response = await get('/permissions/check', { params: { path } });
  return response.data;
};

/**
 * 현재 사용자의 파일 단위 권한 목록 조회. folderPath 지정 시 해당 경로 접두사로 필터.
 * @param {string|null} [folderPath] - 폴더 경로 (접두사 필터, null이면 전체)
 * @returns {Promise<Array>} 권한 배열
 */
export const listFilePermissions = async (folderPath = null) => {
  const params = folderPath != null ? { folderPath } : {};
  const response = await get('/permissions/file/list', { params });
  return response.data;
};
