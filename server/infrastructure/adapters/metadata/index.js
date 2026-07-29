'use strict';

const { getBackend } = require('../../../store/storage');

/**
 * Factory: create a MetadataAdapter instance based on the configured backend.
 *
 * @returns {Object} MetadataAdapter instance
 */
function createMetadataAdapter() {
  const backend = getBackend();
  if (backend === 'postgresql') {
    return require('./PostgresqlMetadataAdapter')();
  }
  if (backend === 'sqlite') {
    return require('./SqliteMetadataAdapter')();
  }
  return require('./FsJsonMetadataAdapter')();
}

module.exports = { createMetadataAdapter };
