'use strict';

const { createFileNodesStore } = require('../store/fileNodesStore');
const { createBlobStore } = require('../infrastructure/adapters/blobstore/index');
const { createFileNodeService } = require('./fileNodeService');
const { createBlobStorageService } = require('./blobStorageService');
const { createUploadService } = require('./uploadService');
const { createGcService } = require('./gcService');
const { createFailSafeService } = require('./failSafeService');
const aclService = require('../domains/permissions/services/aclService');
const ownerNodeResolver = require('../domains/permissions/policy/ownerNodeResolver');
const permissionStore = require('../store/permissionStore');
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
    permissionStore,
    ownerNodeResolver,
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

  const gcService = overrides.gcService || createGcService({
    blobStore,
    fileNodesStore,
    fileStorageMode,
  });

  const failSafeService = overrides.failSafeService || createFailSafeService({
    fileNodeService,
    fileNodesStore,
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
    gcService,
    failSafeService,
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
