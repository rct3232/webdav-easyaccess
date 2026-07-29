'use strict';

const { createMetadataAdapter } = require('../infrastructure/adapters/metadata');
const { isLinkExpired } = require('../infrastructure/adapters/metadata/isLinkExpired');

let _adapter;

function getAdapter() {
  if (!_adapter) _adapter = createMetadataAdapter();
  return _adapter;
}

module.exports = {
  get createShareLink() { return getAdapter().createShareLink; },
  get getShareLink() { return getAdapter().getShareLink; },
  get getUserShareLinks() { return getAdapter().getUserShareLinks; },
  get updateShareLink() { return getAdapter().updateShareLink; },
  get deleteShareLink() { return getAdapter().deleteShareLink; },
  get incrementDownloadCount() { return getAdapter().incrementDownloadCount; },
  isLinkExpired,
};
