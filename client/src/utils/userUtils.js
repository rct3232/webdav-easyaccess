/**
 * 사용자 관련 유틸리티 함수
 */

import { normalizePath } from './pathUtils';

/**
 * 사용자 기본 폴더 경로 가져오기
 * @param {object} user - 사용자 객체
 * @returns {string} 사용자 기본 폴더 경로
 */
export const getUserBaseFolder = (user) => {
  return `/${user?.username || ''}`;
};

/**
 * 경로가 사용자 자신의 폴더인지 확인
 * @param {string} path - 확인할 경로
 * @param {object} user - 사용자 객체
 * @returns {boolean} 사용자 자신의 폴더이면 true
 */
export const isUserOwnFolder = (path, user) => {
  const userBaseFolder = getUserBaseFolder(user);
  const normalizedPath = normalizePath(path);
  const normalizedBase = normalizePath(userBaseFolder);
  return normalizedPath.startsWith(normalizedBase + '/') || normalizedPath === normalizedBase;
};

/**
 * 권한 목록에서 사용자 자신의 폴더 제외
 * @param {Array} permissions - 권한 배열
 * @param {object} user - 사용자 객체
 * @returns {Array} 필터링된 권한 배열
 */
export const filterOutUserOwnFolders = (permissions, user) => {
  return permissions.filter(perm => !isUserOwnFolder(perm.folder_path, user));
};

/**
 * 표시할 사용자 목록 필터링
 * ShareFolderTree와 UserSelectionMenu에서 사용되는 공통 로직
 * 
 * @param {Array} users - 사용자 배열 (entries 형식: [[userId, permData], ...])
 * @param {object} options - 필터 옵션
 * @param {boolean} options.isAdminMode - 관리자 모드 여부
 * @param {string} options.currentUserId - 현재 선택된 사용자 ID (관리자 모드용)
 * @param {object} options.user - 현재 로그인한 사용자 객체
 * @param {Map} options.userInfoMap - 사용자 정보 맵
 * @param {Array} options.allUsers - 전체 사용자 배열
 * @returns {Array} 필터링된 사용자 배열
 */
export const filterDisplayUsers = (users, options = {}) => {
  const { isAdminMode, currentUserId, user, userInfoMap, allUsers } = options;
  
  if (isAdminMode) {
    return users.filter(([uid]) => uid === currentUserId);
  }
  
  return users.filter(([targetUserId]) => {
    // 자신 제외
    if (user && targetUserId === user.id) return false;
    
    // 관리자 제외
    const userInfo = userInfoMap?.get(targetUserId);
    if (userInfo?.is_admin) return false;
    
    const fullUser = allUsers?.find(u => u.id === targetUserId);
    if (fullUser?.is_admin) return false;
    
    return true;
  });
};

/**
 * 사용자 표시 이름 가져오기
 * @param {object} user - 사용자 객체
 * @returns {string} 표시 이름
 */
export const getUserDisplayName = (user) => {
  if (!user) return '';
  return user.username || user.email || user.id || '';
};
