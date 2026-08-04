'use strict';

const { createFileNodesStore } = require('../store/fileNodesStore');
const { createBlobStore } = require('../infrastructure/adapters/blobstore/index');
const { createFileNodeService } = require('./fileNodeService');
const { createBlobStorageService } = require('./blobStorageService');
const { createUploadService } = require('./uploadService');
const aclService = require('../domains/permissions/services/aclService');
const { createFileService } = require('../domains/files/services/fileService');
const { createBatchOperationService } = require('../domains/files/services/batchOperationService');
const { createDownloadService } = require('../domains/files/services/downloadService');

let _composition = null;

function createComposition(overrides = {}) {
  const fileStorageMode = overrides.fileStorageMode || process.env.WEA_FILE_STORAGE || 's3';

  const fileNodesStore = overrides.fileNodesStore || createFileNodesStore();
  const blobStore = overrides.blobStore || createBlobStore();
  const fileNodeService = overrides.fileNodeService || createFileNodeService({ fileNodesStore });
  const blobStorageService = overrides.blobStorageService || createBlobStorageService({
    blobStore,
    fileNodesStore,
    fileStorageMode,
    fileNodeService,
  });
  const uploadService = overrides.uploadService || createUploadService({
    fileNodeService,
    blobStorageService,
    blobStore,
  });

  const effectiveAclService = overrides.aclService || aclService;

  const fileService = overrides.fileService || createFileService({
    fileNodeService,
    blobStorageService,
    uploadService,
    aclService: effectiveAclService,
    fileStorageMode,
  });

  const batchOperationService = overrides.batchOperationService || createBatchOperationService({
    fileNodeService,
    fileService,
    aclService: effectiveAclService,
  });

  const downloadService = overrides.downloadService || createDownloadService({
    fileNodeService,
    blobStorageService,
    aclService: effectiveAclService,
  });

  return {
    fileNodesStore,
    blobStore,
    fileNodeService,
    blobStorageService,
    uploadService,
    aclService: effectiveAclService,
    fileService,
    batchOperationService,
    downloadService,
  };
}

function getComposition() {
  if (!_composition) {
    _composition = createComposition();
  }
  return _composition;
}

function __setCompositionForTests(overrides) {
  _composition = createComposition(overrides);
}

function resetComposition() {
  _composition = null;
}

module.exports = {
  createComposition,
  getComposition,
  __setCompositionForTests,
  resetComposition,
};
