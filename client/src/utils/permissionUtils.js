/**
 * 권한 관련 유틸리티 함수
 */

/**
 * 파일/폴더의 읽기 권한 확인
 * @param {object} file - 파일/폴더 객체
 * @param {boolean} fallback - 권한 정보가 없을 때 기본값 (기본: true)
 * @returns {boolean} 읽기 권한 여부
 */
export const hasReadPermission = (file, fallback = true) => {
  if (!file) return fallback;
  return file.hasReadPermission !== undefined ? file.hasReadPermission : fallback;
};

/**
 * 파일/폴더의 쓰기 권한 확인
 * @param {object} file - 파일/폴더 객체
 * @param {boolean} fallback - 권한 정보가 없을 때 기본값 (기본: true)
 * @returns {boolean} 쓰기 권한 여부
 */
export const hasWritePermission = (file, fallback = true) => {
  if (!file) return fallback;
  return file.hasWritePermission !== undefined ? file.hasWritePermission : fallback;
};

/**
 * 파일/폴더가 권한 부족으로 비활성화되어야 하는지 확인
 * @param {object} file - 파일/폴더 객체
 * @returns {boolean} 비활성화 여부
 */
export const isPermissionDisabled = (file) => {
  if (!file) return false;
  return file.hasReadPermission === false;
};

/**
 * 권한 레벨 가져오기 (비교용)
 * @param {string} permission - 권한 문자열 ('read' | 'write')
 * @returns {number} 권한 레벨 (0: 없음, 1: 읽기, 2: 쓰기)
 */
export const getPermissionLevel = (permission) => {
  if (!permission) return 0;
  if (permission === 'write') return 2;
  if (permission === 'read') return 1;
  return 0;
};

/**
 * 두 권한 중 높은 권한 반환
 * @param {string} perm1 - 첫 번째 권한
 * @param {string} perm2 - 두 번째 권한
 * @returns {string} 더 높은 권한
 */
export const getHigherPermission = (perm1, perm2) => {
  const level1 = getPermissionLevel(perm1);
  const level2 = getPermissionLevel(perm2);
  return level1 >= level2 ? perm1 : perm2;
};
