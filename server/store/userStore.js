'use strict';

const { createMetadataAdapter } = require('../infrastructure/adapters/metadata');

let _adapter;

function getAdapter() {
  if (!_adapter) _adapter = createMetadataAdapter();
  return _adapter;
}

module.exports = {
  get ensureUserIndexFile() { return getAdapter().ensureUserIndexFile; },
  get findByUsername() { return getAdapter().findByUsername; },
  get findByEmail() { return getAdapter().findByEmail; },
  get findById() { return getAdapter().findById; },
  get findAll() { return getAdapter().findAll; },
  get findByStatus() { return getAdapter().findByStatus; },
  get createUser() { return getAdapter().createUser; },
  get updateStatus() { return getAdapter().updateStatus; },
  get updateEmail() { return getAdapter().updateEmail; },
  get updatePassword() { return getAdapter().updatePassword; },
  get deleteUser() { return getAdapter().deleteUser; },
};
