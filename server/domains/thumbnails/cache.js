/**
 * Shared CacheAdapter singleton for the thumbnails domain.
 * Ensures all consumers (routes, services, shim) share the same cache.
 */
const { createCacheAdapter } = require('../../infrastructure/adapters/cache');

let _adapter = null;

function getThumbnailCacheAdapter() {
  if (!_adapter) {
    _adapter = createCacheAdapter();
  }
  return _adapter;
}

module.exports = { getThumbnailCacheAdapter };
