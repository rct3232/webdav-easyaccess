'use strict';

const crypto = require('crypto');

/**
 * Deterministic, cheap content hash for the write path.
 * Local crypto wrapper to avoid the utf8 coercion loss in server/utils/hash.js
 * for binary buffers. Single convention for every filecache.content_hash
 * writer (upload, WebDAV upload, version restore — aiJobService.md §2.2).
 */
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { sha256Buffer };
