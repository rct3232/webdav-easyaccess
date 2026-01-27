const shareLinkStore = require('../store/shareLinkStore');
const crypto = require('crypto');

class ShareLink {
  /**
   * 공유 링크 생성
   * @param {string} filePath - 파일 경로
   * @param {number} createdBy - 생성한 사용자 ID
   * @param {number|null} expiresInDays - 유효기간 (일수, null이면 무제한)
   * @returns {Promise<Object>} 생성된 링크 데이터
   */
  static async create(filePath, createdBy, expiresInDays = 14) {
    // Access token 생성 (32바이트 랜덤)
    const token = crypto.randomBytes(32).toString('base64url');
    
    return await shareLinkStore.createShareLink({
      token,
      filePath,
      createdBy,
      expiresInDays,
    });
  }

  /**
   * 공유 링크 조회
   * @param {string} token - Access token
   * @returns {Promise<Object|null>} 링크 데이터 또는 null
   */
  static async findByToken(token) {
    return await shareLinkStore.getShareLink(token);
  }

  /**
   * 사용자가 생성한 모든 공유 링크 조회
   * @param {number} userId - 사용자 ID
   * @returns {Promise<Array>} 링크 목록
   */
  static async findByUserId(userId) {
    return await shareLinkStore.getUserShareLinks(userId);
  }

  /**
   * 공유 링크 수정
   * @param {string} token - Access token
   * @param {Object} updates - 수정할 데이터
   * @returns {Promise<Object>} 수정된 링크 데이터
   */
  static async update(token, updates) {
    return await shareLinkStore.updateShareLink(token, updates);
  }

  /**
   * 공유 링크 삭제
   * @param {string} token - Access token
   * @returns {Promise<void>}
   */
  static async delete(token) {
    return await shareLinkStore.deleteShareLink(token);
  }

  /**
   * 다운로드 횟수 증가
   * @param {string} token - Access token
   * @returns {Promise<Object>} 업데이트된 링크 데이터
   */
  static async incrementDownloadCount(token) {
    return await shareLinkStore.incrementDownloadCount(token);
  }

  /**
   * 링크 만료 여부 확인
   * @param {Object} link - 링크 데이터
   * @returns {boolean} 만료 여부
   */
  static isExpired(link) {
    return shareLinkStore.isLinkExpired(link);
  }
}

module.exports = ShareLink;
