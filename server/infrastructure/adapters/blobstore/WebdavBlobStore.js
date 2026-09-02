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

function reportWebdavOk() {
  const { getBackendHealth } = require('../../backendHealth');
  getBackendHealth().report('webdav', { ok: true });
}

function reportWebdavFail(error) {
  const { getBackendHealth } = require('../../backendHealth');
  const { classifyToHealthCode } = require('../../backendProbe');
  getBackendHealth().report('webdav', {
    ok: false,
    code: classifyToHealthCode('webdav', error && error.errorCode),
    reason: error && error.message,
  });
}

function withHealthReport(fn) {
  return async function wrappedHealthReport(...args) {
    try {
      const result = await fn.apply(this, args);
      reportWebdavOk();
      return result;
    } catch (error) {
      reportWebdavFail(error);
      throw error;
    }
  };
}

for (const method of ['uploadBlob', 'createDirectory', 'downloadBlob', 'deleteBlob', 'headBlob']) {
  WebdavBlobStore.prototype[method] = withHealthReport(WebdavBlobStore.prototype[method]);
}

module.exports = WebdavBlobStore;
