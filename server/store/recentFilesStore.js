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

/**
 * 일괄 이동 적용 (한 번의 읽기/쓰기로 N개 이동 반영)
 * @param {number} userId - 사용자 ID
 * @param {Array<{ oldPath: string, newPath: string, file?: { type?: string, name?: string, basename?: string } }>} moves
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
async function applyBulkMove(userId, moves) {
  if (!moves || moves.length === 0) return await getUserRecentFiles(userId);
  try {
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    let files = await getUserRecentFiles(userId);

    for (const { oldPath, newPath, file } of moves) {
      const oldNorm = normalizePath(oldPath);
      const newNorm = normalizePath(newPath);
      const isDir = file?.type === 'directory';

      if (isDir) {
        const toReAdd = [];
        files = files.filter((f) => {
          const p = normalizePath(f.path);
          if (p === oldNorm || p.startsWith(oldNorm + '/')) {
            const rel = p === oldNorm ? '' : p.slice(oldNorm.length);
            toReAdd.push({ ...f, path: newNorm + rel });
            return false;
          }
          return true;
        });
        const now = new Date().toISOString();
        for (const f of toReAdd) {
          if (f.type === 'directory') continue;
          files.unshift({ ...f, lastAccessed: now });
        }
      } else {
        files = files.filter((f) => normalizePath(f.path) !== oldNorm);
        const name = file?.name || file?.basename || newNorm.split('/').pop();
        files.unshift({
          path: newNorm,
          name,
          type: file?.type || 'file',
          lastAccessed: new Date().toISOString(),
        });
      }
    }

    const seen = new Set();
    const deduped = files.filter((f) => {
      const p = normalizePath(f.path);
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    const result = deduped.slice(0, MAX_RECENT_FILES);
    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(result, null, 2), { overwrite: true });
    return result;
  } catch (error) {
    console.error('Failed to apply bulk move to recent files:', error);
    throw error;
  }
}

/**
 * 일괄 경로 제거 (한 번의 읽기/쓰기로 N개 삭제 반영)
 * @param {number} userId - 사용자 ID
 * @param {string[]} filePaths - 제거할 파일/폴더 경로 배열 (삭제된 항목 전체)
 * @param {string[]} folderPaths - 제거할 폴더 경로 배열 (하위 경로도 제거용, filePaths의 부분집합)
 * @returns {Promise<Array>} 업데이트된 최근 파일 목록
 */
async function removePaths(userId, filePaths = [], folderPaths = []) {
  if (!filePaths.length && !folderPaths.length) return await getUserRecentFiles(userId);
  try {
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    let files = await getUserRecentFiles(userId);
    const filePathsSet = new Set((filePaths || []).map((p) => normalizePath(p)));
    const folderPathsNorm = (folderPaths || []).map((p) => normalizePath(p));

    files = files.filter((f) => {
      const p = normalizePath(f.path);
      if (filePathsSet.has(p)) return false;
      for (const folder of folderPathsNorm) {
        if (p === folder || p.startsWith(folder + '/')) return false;
      }
      return true;
    });

    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(files, null, 2), { overwrite: true });
    return files;
  } catch (error) {
    console.error('Failed to remove paths from recent files:', error);
    throw error;
  }
}

module.exports = {
  getUserRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  applyBulkMove,
  removePaths,
};
