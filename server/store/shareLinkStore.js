const storage = require('./storage');
const { normalizeWebdavPath } = require('./metaPaths');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../utils/errorHandler');

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

function isPostgresqlBackend() {
  return storage.getBackend() === 'postgresql';
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapShareLinkRow(row) {
  if (!row) return null;
  return {
    token: row.token,
    filePath: normalizeWebdavPath(row.file_path),
    createdBy: Number(row.created_by),
    createdAt: toIsoString(row.created_at),
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : null,
    downloadCount: Number(row.download_count || 0),
  };
}

/**
 * 공유 링크 생성
 * @param {Object} linkData - 링크 데이터
 * @returns {Promise<Object>} 생성된 링크 데이터
 */
async function createShareLink(linkData) {
  const { token, filePath, createdBy, expiresInDays } = linkData;

  if (isPostgresqlBackend()) {
    let expiresAt = null;
    if (expiresInDays !== null && expiresInDays !== undefined) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiresInDays);
      expiresAt = expiryDate.toISOString();
    }

    const normalizedFilePath = normalizeWebdavPath(filePath);
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM share_links
            WHERE token = $1
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length > 0) {
          return mapShareLinkRow(existing.rows[0]);
        }

        const inserted = await client.query(
          `INSERT INTO share_links (token, file_path, created_by, created_at, expires_at, download_count)
           VALUES ($1, $2, $3, NOW(), $4, 0)
           RETURNING *`,
          [String(token), normalizedFilePath, Number(createdBy), expiresAt]
        );
        return mapShareLinkRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM share_links
          WHERE token = $1
          LIMIT 1`,
        [String(token)]
      );
      if (res.rows.length === 0) return null;
      return mapShareLinkRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    const linkPath = getShareLinkPath(token);
    const content = await storage.readFile(linkPath);
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
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
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM share_links
          WHERE created_by = $1
          ORDER BY created_at DESC`,
        [Number(userId)]
      );
      return res.rows.map(mapShareLinkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    // 디렉토리 존재 확인 및 생성
    await storage.ensureDirSafe(SHARE_LINKS_DIR);
    
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
  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM share_links
            WHERE token = $1
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }

        const current = mapShareLinkRow(existing.rows[0]);
        const merged = {
          ...current,
          ...updates,
        };

        const updated = await client.query(
          `UPDATE share_links
              SET file_path = $2,
                  expires_at = $3,
                  download_count = $4
            WHERE token = $1
            RETURNING *`,
          [
            String(token),
            normalizeWebdavPath(merged.filePath),
            merged.expiresAt || null,
            Number(merged.downloadCount || 0),
          ]
        );
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const link = await getShareLink(token);
  if (!link) {
    throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
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
  if (isPostgresqlBackend()) {
    try {
      await storage.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM share_links
            WHERE token = $1`,
          [String(token)]
        );
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const linkPath = getShareLinkPath(token);
  await storage.deletePath(linkPath);
}

/**
 * 공유 링크 다운로드 횟수 증가
 * @param {string} token - Access token
 * @returns {Promise<Object>} 업데이트된 링크 데이터
 */
async function incrementDownloadCount(token) {
  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const updated = await client.query(
          `UPDATE share_links
              SET download_count = download_count + 1
            WHERE token = $1
            RETURNING *`,
          [String(token)]
        );
        if (updated.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const link = await getShareLink(token);
  if (!link) {
    throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
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
