'use strict';

class NoOpBlobStore {
  async uploadBlob() {}
  async downloadBlob() { return Buffer.from(''); }
  async deleteBlob() {}
  async headBlob() { return { contentLength: 0, contentType: 'application/octet-stream' }; }
  async listOrphanedKeys() { return []; }
}

module.exports = NoOpBlobStore;
