'use strict';

class WebdavBlobStore {
  constructor(webdavClient) {
    if (!webdavClient) {
      throw new Error('WebdavBlobStore requires a webdavClient file-store adapter');
    }
    this.webdav = webdavClient;
  }

  async uploadBlob(filepath, buffer) {
    if (!filepath) throw new Error('WebDAV filepath is required');
    if (buffer == null) throw new Error('Buffer is required');
    await this.webdav.putFileContents(filepath, buffer);
  }

  async createDirectory(filepath) {
    if (!filepath) throw new Error('WebDAV filepath is required');
    await this.webdav.createDirectory(filepath);
  }

  async downloadBlob(filepath) {
    try {
      const data = await this.webdav.getFileContents(filepath);
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
    } catch (err) {
      if (this._isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteBlob(filepath) {
    try {
      await this.webdav.deleteFile(filepath, { isDirectory: false });
    } catch (err) {
      if (this._isNotFound(err)) return;
      throw err;
    }
  }

  async headBlob(filepath) {
    try {
      const meta = await this.webdav.getFileMetadata(filepath);
      return {
        contentLength: meta.size,
        contentType: meta.mime,
      };
    } catch (err) {
      if (this._isNotFound(err)) return null;
      throw err;
    }
  }

  async listOrphanedKeys() {
    return [];
  }

  _isNotFound(err) {
    if (!err) return false;
    if (err.status === 404) return true;
    if (String(err.name).toLowerCase().includes('notfound')) return true;
    return String(err.message || '').includes('404');
  }
}

module.exports = WebdavBlobStore;