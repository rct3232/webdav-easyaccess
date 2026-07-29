'use strict';

/**
 * Factory: create a MetadataAdapter instance based on the configured backend.
 * All adapter requires are lazy to ensure Jest mocks on store/storage are picked up.
 *
 * @returns {Object} MetadataAdapter instance
 */
function createMetadataAdapter() {
  // Lazy require so Jest mocks apply correctly
  const storage = require('../../../store/storage');
  const backend = storage.getBackend();
  if (backend === 'postgresql') {
    return require('./PostgresqlMetadataAdapter')();
  }
  if (backend === 'sqlite') {
    return require('./SqliteMetadataAdapter')();
  }
  return require('./FsJsonMetadataAdapter')();
}

module.exports = { createMetadataAdapter };
