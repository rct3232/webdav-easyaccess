const storage = require('./storage');
const { normalizeWebdavPath } = require('./metaPaths');

const SHARE_LINKS_DIR = '/.wea/share-links/';

/**
 * ShareLink 저장소
 * WebDAV의 /.wea/share-links/ 경로에 JSON 파일로 저장
 */

/**
 * 공유 링크 파일 경로 생성
 * @param {string} token - Access token
 * @returns {string} WebDAV 경로
 */
function getShareLinkPath(token) {
  return normalizeWebdavPath(`${SHARE_LINKS_DIR}${token}.json`);
}

/**
 * 공유 링크 생성
 * @param {Object} linkData - 링크 데이터
 * @returns {Promise<Object>} 생성된 링크 데이터
 */
async function createShareLink(linkData) {
  const { token, filePath, createdBy, expiresInDays } = linkData;
  
  // 디렉토리 존재 확인 및 생성
  await storage.ensureDirSafe(SHARE_LINKS_DIR);
  
  const createdAt = new Date().toISOString();
  let expiresAt = null;
  if (expiresInDays !== null && expiresInDays !== undefined) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);
    expiresAt = expiryDate.toISOString();
  }
  
  const link = {
    token,
    filePath: normalizeWebdavPath(filePath),
    createdBy,
    createdAt,
    expiresAt,
    downloadCount: 0,
  };
  
  const linkPath = getShareLinkPath(token);
  
  // 파일이 이미 존재하는지 확인
  const exists = await storage.exists(linkPath);
  if (exists) {
    // 이미 존재하는 경우 기존 링크 반환 (토큰 충돌은 거의 불가능하지만 방어적 코드)
    const existingLink = await getShareLink(token);
    if (existingLink) {
      return existingLink;
    }
  }
  
  // 파일 쓰기 (overwrite 옵션 사용)
  await storage.writeFile(linkPath, JSON.stringify(link, null, 2), { overwrite: true });
  
  return link;
}

/**
 * 공유 링크 조회
 * @param {string} token - Access token
 * @returns {Promise<Object|null>} 링크 데이터 또는 null
 */
async function getShareLink(token) {
  try {
    const linkPath = getShareLinkPath(token);
    const content = await storage.readFile(linkPath);
    return JSON.parse(content);
  } catch (error) {
    if (error.message && error.message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

/**
 * 사용자가 생성한 모든 공유 링크 조회
 * @param {number} userId - 사용자 ID
 * @returns {Promise<Array>} 링크 목록
 */
async function getUserShareLinks(userId) {
  try {
    // 디렉토리 존재 확인 및 생성
    await ensureShareLinksDir();
    
    // /.wea/share-links/ 디렉토리의 모든 파일 조회
    const linksDir = normalizeWebdavPath(SHARE_LINKS_DIR);
    const files = await storage.listDir(linksDir);
    
    const links = [];
    for (const file of files) {
      if (file.type === 'file' && file.basename.endsWith('.json')) {
        try {
          const linkPath = normalizeWebdavPath(`${SHARE_LINKS_DIR}${file.basename}`);
          const content = await storage.readFile(linkPath);
          const link = JSON.parse(content);
          
          // 해당 사용자가 생성한 링크만 필터링
          if (link.createdBy === userId) {
            links.push(link);
          }
        } catch (error) {
          // 파일 읽기 실패 시 무시하고 계속
          console.error(`Failed to read share link file ${file.basename}:`, error);
        }
      }
    }
    
    // 생성일 기준 내림차순 정렬
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return links;
  } catch (error) {
    // 디렉토리가 없거나 다른 에러 발생 시 빈 배열 반환
    console.error('Failed to get user share links:', error);
    return [];
  }
}

/**
 * 공유 링크 수정
 * @param {string} token - Access token
 * @param {Object} updates - 수정할 데이터
 * @returns {Promise<Object>} 수정된 링크 데이터
 */
async function updateShareLink(token, updates) {
  const link = await getShareLink(token);
  if (!link) {
    throw new Error('Share link not found');
  }
  
  const updatedLink = {
    ...link,
    ...updates,
  };
  
  const linkPath = getShareLinkPath(token);
  await storage.writeFile(linkPath, JSON.stringify(updatedLink, null, 2));
  
  return updatedLink;
}

/**
 * 공유 링크 삭제
 * @param {string} token - Access token
 * @returns {Promise<void>}
 */
async function deleteShareLink(token) {
  const linkPath = getShareLinkPath(token);
  await storage.deletePath(linkPath);
}

/**
 * 공유 링크 다운로드 횟수 증가
 * @param {string} token - Access token
 * @returns {Promise<Object>} 업데이트된 링크 데이터
 */
async function incrementDownloadCount(token) {
  const link = await getShareLink(token);
  if (!link) {
    throw new Error('Share link not found');
  }
  
  return await updateShareLink(token, {
    downloadCount: (link.downloadCount || 0) + 1,
  });
}

/**
 * 만료된 링크 확인
 * @param {Object} link - 링크 데이터
 * @returns {boolean} 만료 여부
 */
function isLinkExpired(link) {
  if (!link.expiresAt) {
    return false; // 무제한
  }
  
  const now = new Date();
  const expiresAt = new Date(link.expiresAt);
  return now > expiresAt;
}

module.exports = {
  createShareLink,
  getShareLink,
  getUserShareLinks,
  updateShareLink,
  deleteShareLink,
  incrementDownloadCount,
  isLinkExpired,
};
