import { get, post, del } from './apiClient';

const USER_PERMISSIONS_TTL_MS = 3000;
const userPermissionsCache = new Map();
const inFlightUserPermissions = new Map();

const getUserCacheKey = (userId) => String(userId);

export const clearUserPermissionsCache = (userId) => {
  if (userId == null) {
    userPermissionsCache.clear();
    inFlightUserPermissions.clear();
    return;
  }
  const cacheKey = getUserCacheKey(userId);
  userPermissionsCache.delete(cacheKey);
  inFlightUserPermissions.delete(cacheKey);
};

/**
 * 사용자별 폴더 권한 목록 조회 (WebDAV 존재 폴더만 반환)
 * @param {number} userId - 사용자 ID
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh=false] - 캐시 무시 여부
 * @returns {Promise<Array>} 권한 배열
 */
export const getUserPermissions = async (userId, options = {}) => {
  const { forceRefresh = false } = options;
  const cacheKey = getUserCacheKey(userId);
  const cached = userPermissionsCache.get(cacheKey);

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < USER_PERMISSIONS_TTL_MS) {
    return cached.data;
  }

  const existingInFlight = inFlightUserPermissions.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const request = get(`/permissions/user/${userId}`)
    .then((response) => {
      userPermissionsCache.set(cacheKey, {
        data: response.data,
        fetchedAt: Date.now(),
      });
      return response.data;
    })
    .finally(() => {
      inFlightUserPermissions.delete(cacheKey);
    });

  inFlightUserPermissions.set(cacheKey, request);
  return request;
};

/**
 * 현재 사용자의 "공유된(shared-with-me)" 권한 목록 조회.
 * 서버가 본인 소유 하위 트리를 제외하고 실명(name)/type을 포함해 반환한다.
 * @returns {Promise<Array<{ nodeId, name, permission, type }>>}
 */
export const getSharedPermissions = async () => {
  const response = await get('/permissions/shared');
  return response.data;
};

/**
 * 폴더별 권한 목록 조회
 * @param {string} nodeId - 폴더 nodeId
 * @param {string} [fileNodeId] - 파일 nodeId (지정 시 각 항목에 file_permission 포함)
 * @returns {Promise<Array>} 권한 배열
 */
export const getFolderPermissions = async (nodeId, fileNodeId) => {
  const params = { nodeId };
  if (fileNodeId != null && fileNodeId !== '') params.fileNodeId = fileNodeId;
  const response = await get('/permissions/folder', { params });
  return response.data;
};

/**
 * 권한 부여 (폴더 또는 파일). 파일일 때는 target: 'file' 전달.
 * @param {Object} params - { userId, nodeId, permission, target? } target 'file'이면 파일 권한
 */
export const grantPermission = async ({ userId, nodeId, permission, target }) => {
  if (target === 'file') {
    await post('/permissions/file/grant', { userId, fileNodeId: nodeId, permission });
    clearUserPermissionsCache(userId);
    return;
  }
  const body = { userId, nodeId, permission };
  if (target != null) body.target = target;
  await post('/permissions/grant', body);
  clearUserPermissionsCache(userId);
};

/**
 * 권한 철회 (폴더 또는 파일). 파일은 target: 'file' 전달.
 * @param {Object} params - { userId, nodeId, scope?, target? } target 'file'이면 파일 권한
 */
export const revokePermission = async ({ userId, nodeId, scope, target }) => {
  if (target === 'file') {
    await del('/permissions/file/revoke', { params: { userId, fileNodeId: nodeId } });
    clearUserPermissionsCache(userId);
    return;
  }
  const params = { userId, nodeId };
  if (scope != null) params.scope = scope;
  await del('/permissions/revoke', { params });
  clearUserPermissionsCache(userId);
};

/**
 * 현재 사용자의 유효 권한 조회 (경로/파일 공통). 반환: { nodeId, hasRead, hasWrite, source: 'file'|'path' }.
 */
export const checkPermission = async (nodeId) => {
  const response = await get('/permissions/check', { params: { nodeId } });
  return response.data;
};

/**
 * 현재 사용자의 파일 단위 권한 목록 조회. parentNodeId 지정 시 해당 nodeId로 필터.
 * @param {string|null} [parentNodeId] - 부모 폴더 nodeId (접두사 필터, null이면 전체)
 * @returns {Promise<Array>} 권한 배열
 */
export const listFilePermissions = async (parentNodeId = null) => {
  const params = parentNodeId != null ? { parentNodeId } : {};
  const response = await get('/permissions/file/list', { params });
  return response.data;
};
