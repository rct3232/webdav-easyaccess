import { get, post, put, del } from './apiClient';

const API_BASE = '/share-links';

/**
 * 공유 링크 생성
 * @param {string} filePath - 파일 경로
 * @param {number|null} expiresInDays - 유효기간 (일수, null이면 무제한)
 * @returns {Promise<Object>} 생성된 링크 데이터
 */
export const createShareLink = async (filePath, expiresInDays = 14) => {
  const response = await post(API_BASE, {
    filePath,
    expiresInDays,
  });
  return response.data;
};

/**
 * 사용자가 생성한 공유 링크 목록 조회
 * @returns {Promise<Array>} 링크 목록
 */
export const getShareLinks = async () => {
  const response = await get(API_BASE);
  return response.data;
};

/**
 * 공유 링크 정보 조회
 * @param {string} token - Access token
 * @returns {Promise<Object>} 링크 데이터
 */
export const getShareLink = async (token) => {
  const response = await get(`${API_BASE}/${token}`);
  return response.data;
};

/**
 * 공유 링크 수정 (유효기간 연장 등)
 * @param {string} token - Access token
 * @param {Object} updates - 수정할 데이터
 * @returns {Promise<Object>} 수정된 링크 데이터
 */
export const updateShareLink = async (token, updates) => {
  const response = await put(`${API_BASE}/${token}`, updates);
  return response.data;
};

/**
 * 공유 링크 삭제
 * @param {string} token - Access token
 * @returns {Promise<void>}
 */
export const deleteShareLink = async (token) => {
  await del(`${API_BASE}/${token}`);
};

/**
 * 공유 링크 URL 생성
 * @param {string} token - Access token
 * @returns {string} 공유 링크 URL
 */
export const getShareLinkUrl = (token) => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/share/${token}`;
};

/**
 * 공개 공유 링크 정보 조회 (인증 불필요)
 * @param {string} token - Access token
 * @returns {Promise<Object>} 링크 정보
 */
export const getPublicShareLinkInfo = async (token) => {
  const response = await fetch(`/api/share/${token}/info`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const data = body.errorCode ? body : { errorCode: 'errors.unknown' };
    const err = new Error(data.errorCode);
    err.response = { data };
    throw err;
  }
  return response.json();
};

/**
 * Check if current user has sufficient (read or higher) permission on the share link path.
 * Requires authentication.
 * @param {string} token - Share link token
 * @returns {Promise<{ hasSufficientPermission: boolean, path?: string }>}
 */
export const checkMyPermissionForShare = async (token) => {
  const response = await get(`/share/${token}/check-my-permission`);
  return response.data;
};

/**
 * Add the share link path to current user's permissions (read).
 * Requires authentication.
 * @param {string} token - Share link token
 * @returns {Promise<{ message: string }>}
 */
export const addShareLinkToMyPermissions = async (token) => {
  const response = await post(`/share/${token}/add-to-my-permissions`);
  return response.data;
};
