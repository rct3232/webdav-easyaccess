const storage = require('./storage');
const { normalizeWebdavPath } = require('./metaPaths');
const { normalizePath } = require('../utils/pathUtils');

const RECENT_FILES_DIR = '/.wea/recent-files/';
const MAX_RECENT_FILES = 20;

/**
 * 사용자별 최근 파일 경로 생성
 * @param {number} userId - 사용자 ID
 * @returns {string} WebDAV 경로
 */
function getUserRecentFilesPath(userId) {
  return normalizeWebdavPath(`${RECENT_FILES_DIR}${userId}.json`);
}

/**
 * 사용자의 최근 파일 목록 조회
 * @param {number} userId - 사용자 ID
 * @returns {Promise<Array>} 최근 파일 목록
 */
async function getUserRecentFiles(userId) {
  try {
    // 디렉토리 존재 확인 및 생성
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    
    const filePath = getUserRecentFilesPath(userId);
    const exists = await storage.exists(filePath);
    
    if (!exists) {
      return [];
    }
    
    const content = await storage.readFile(filePath);
    const files = JSON.parse(content);
    return Array.isArray(files) ? files : [];
  } catch (error) {
    // 파일이 없거나 파싱 실패 시 빈 배열 반환
    console.error('Failed to get user recent files:', error);
    return [];
  }
}

/**
 * 최근 파일 추가
 * @param {number} userId - 사용자 ID
 * @param {Object} fileData - 파일 정보 { path, name, type }
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
async function addRecentFile(userId, fileData) {
  try {
    // 디렉토리 존재 확인 및 생성
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    
    const files = await getUserRecentFiles(userId);
    
    // 경로 정규화
    const normalizedNewPath = normalizePath(fileData.path);
    
    // 중복 제거 (정규화된 경로로 비교)
    const filtered = files.filter(f => {
      const normalizedExistingPath = normalizePath(f.path);
      return normalizedExistingPath !== normalizedNewPath;
    });
    
    // 새 파일을 맨 앞에 추가
    const newFiles = [
      {
        path: normalizedNewPath, // 정규화된 경로로 저장
        name: fileData.name || fileData.basename || normalizedNewPath.split('/').pop(),
        type: fileData.type || 'file',
        lastAccessed: new Date().toISOString(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_FILES);
    
    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(newFiles, null, 2), { overwrite: true });
    
    return newFiles;
  } catch (error) {
    console.error('Failed to add recent file:', error);
    throw error;
  }
}

/**
 * 최근 파일 제거
 * @param {number} userId - 사용자 ID
 * @param {string} filePath - 파일 경로
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
async function removeRecentFile(userId, targetPath) {
  try {
    const files = await getUserRecentFiles(userId);
    // 경로 정규화하여 비교
    const normalizedTargetPath = normalizePath(targetPath);
    const filtered = files.filter(f => {
      const normalizedExistingPath = normalizePath(f.path);
      return normalizedExistingPath !== normalizedTargetPath;
    });
    
    const userFilePath = getUserRecentFilesPath(userId);
    await storage.writeFile(userFilePath, JSON.stringify(filtered, null, 2), { overwrite: true });
    
    return filtered;
  } catch (error) {
    console.error('Failed to remove recent file:', error);
    throw error;
  }
}

/**
 * 최근 파일 목록 초기화
 * @param {number} userId - 사용자 ID
 * @returns {Promise<void>}
 */
async function clearRecentFiles(userId) {
  try {
    const filePath = getUserRecentFilesPath(userId);
    await storage.deletePath(filePath);
  } catch (error) {
    // 파일이 없어도 에러로 처리하지 않음
    if (error.message && !error.message.includes('not found')) {
      console.error('Failed to clear recent files:', error);
      throw error;
    }
  }
}

module.exports = {
  getUserRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
};
