import { get } from './apiClient';

/**
 * 공개 설정 조회 (인증 불필요)
 * @returns {Promise<Object>} { registration_enabled, email_enabled, ... }
 */
export const getPublicSettings = async () => {
  const response = await get('/settings/public');
  return response.data;
};
