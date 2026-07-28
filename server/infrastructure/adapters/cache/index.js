const InMemoryCacheAdapter = require('./InMemoryCacheAdapter');

/**
 * Factory: create a CacheAdapter instance.
 * Default returns InMemoryCacheAdapter.
 * Future: RedisCacheAdapter via environment config.
 *
 * @param {Object} [options]
 * @returns {import('./InMemoryCacheAdapter')}
 */
function createCacheAdapter(options) {
  return new InMemoryCacheAdapter(options);
}

module.exports = { createCacheAdapter, InMemoryCacheAdapter };
