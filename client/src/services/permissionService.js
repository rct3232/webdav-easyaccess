import { get, post, put, del } from './apiClient';

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
 * @returns {Promise<Array>} 권한 배열
 */
export const getFolderPermissions = async (path, includeSubfolders = false) => {
  const response = await get('/permissions/folder', {
    params: { path, includeSubfolders: includeSubfolders ? 'true' : 'false' },
  });
  return response.data;
};

/**
 * 폴더 권한 부여
 * @param {Object} params - { userId, folderPath, permission }
 */
export const grantPermission = async ({ userId, folderPath, permission }) => {
  await post('/permissions/grant', { userId, folderPath, permission });
};

/**
 * 폴더 권한 철회
 * @param {Object} params - { userId, folderPath, includeSubfolders }
 */
export const revokePermission = async ({ userId, folderPath, includeSubfolders = false }) => {
  await del('/permissions/revoke', {
    params: { userId, folderPath, includeSubfolders: includeSubfolders ? 'true' : 'false' },
  });
};
