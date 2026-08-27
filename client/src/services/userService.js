import { get, put } from './apiClient';

/**
 * 승인된 사용자 목록 조회 (공유 대상 선택용)
 * @returns {Promise<Array>} 사용자 배열
 */
export const getApprovedUsers = async () => {
  const response = await get('/users/approved');
  return response.data;
};

/**
 * 이메일 변경
 * @param {number} userId - 사용자 ID
 * @param {string} email - 새 이메일
 */
export const updateEmail = async (userId, email) => {
  await put(`/users/${userId}/email`, { email });
};

/**
 * 비밀번호 변경
 * @param {number} userId - 사용자 ID
 * @param {string} password - 새 비밀번호
 */
export const updatePassword = async (userId, password) => {
  await put(`/users/${userId}/password`, { password });
};

/**
 * 사용자 권한 일괄 수정 (관리자 전용)
 * @param {number} userId - 사용자 ID
 * @param {Array} permissions - [{ nodeId, permission }]
 */
export const updateUserPermissions = async (userId, permissions) => {
  await put(`/users/${userId}/permissions`, { permissions });
};
