'use strict';

const { createFileNodesStore } = require('../store/fileNodesStore');
const { createBlobStore } = require('../infrastructure/adapters/blobstore/index');
const { createFileNodeService } = require('./fileNodeService');
const { createBlobStorageService } = require('./blobStorageService');
const { createUploadService } = require('./uploadService');
const { createGcService } = require('./gcService');
const { createFailSafeService } = require('./failSafeService');
const { createTrashService } = require('./trashService');
const aiJobsStore = require('../store/aiJobsStore');
const { createNodeContentHook } = require('../domains/ai/nodeContentHook');
const { syncNodeDerivedTagsForNode } = require('../domains/ai/derivedTags');
const aclService = require('../domains/permissions/services/aclService');
const ownerNodeResolver = require('../domains/permissions/policy/ownerNodeResolver');
const permissionStore = require('../store/permissionStore');
const { createFileService } = require('../domains/files/services/fileService');
const { createBatchOperationService } = require('../domains/files/services/batchOperationService');
const { createDownloadService } = require('../domains/files/services/downloadService');
const { createVersionsService } = require('../domains/files/services/versionsService');
const { createMigrationJobStore } = require('../domains/admin/stores/migrationJobStore');
const { createMigrationService } = require('../domains/admin/services/migrationService');
const { buildDestBlobStore } = require('../infrastructure/adapters/blobstore/config');
const lockManager = require('../infrastructure/lockManager');

let _composition = null;

/**
 * Post-commit hook composition: AI enrichment stays independent, then the
 * local derived tags are refreshed so a tag predicate can see the fresh node,
 * then the collections admission point-check materializes any matching
 * membership, and the owner's upload evolution debounce is (re-)armed.
 * Everything after the write is best-effort — failures are logged, never
 * propagated.
 */
function createComposedNodeContentHook(enrichmentHook, { fileNodesStore, syncDerivedTags } = {}) {
  const syncTags =
    syncDerivedTags || ((nodeId) => syncNodeDerivedTagsForNode(nodeId, { fileNodesStore }));
  return {
    async onNodeContentCommitted(nodeId, contentHash) {
      await enrichmentHook.onNodeContentCommitted(nodeId, contentHash);
      try {
        // LLM-free derived facets; tag-predicate admission below reads
        // ai_tag_raw, so this must run before checkUploadAdmissionsForNode.
        await syncTags(nodeId);
      } catch (error) {
        console.error(
          `[derivedTags] commit sync failed for node ${nodeId}:`,
          error && error.message
        );
      }
      try {
        await require('../domains/collections/service').checkUploadAdmissionsForNode(nodeId);
      } catch (error) {
        console.error(
          `[collections] upload admission failed for node ${nodeId}:`,
          error && error.message
        );
      }
      try {
        // Batch-end trigger only (§evolutionService §2.2): re-arms the owner's
        // trailing-edge timer; the hint path is latency sugar, never required.
        await require('../domains/collections/evolutionService').armUploadTriggerForNode(nodeId);
      } catch (error) {
        console.error(
          `[collections] evolution trigger arm failed for node ${nodeId}:`,
          error && error.message
        );
      }
    },
  };
}

function createComposition(overrides = {}) {
  const fileStorageMode = overrides.fileStorageMode || process.env.WEA_FILE_STORAGE || 's3';

  const fileNodesStore = overrides.fileNodesStore || createFileNodesStore();
  const blobStore = overrides.blobStore || createBlobStore();
  const fileNodeService = overrides.fileNodeService || createFileNodeService({ fileNodesStore });
  const blobStorageService =
    overrides.blobStorageService ||
    createBlobStorageService({
      blobStore,
      fileNodesStore,
      fileStorageMode,
      fileNodeService,
    });
  const nodeContentHook =
    overrides.nodeContentHook ||
    createComposedNodeContentHook(
      createNodeContentHook({
        aiJobsRepository: aiJobsStore,
        fileNodesStore,
      }),
      { fileNodesStore }
    );

  const uploadService =
    overrides.uploadService ||
    createUploadService({
      fileNodeService,
      blobStorageService,
      blobStore,
      fileNodesStore,
      nodeContentHook,
    });

  const effectiveAclService = overrides.aclService || aclService;

  const fileService =
    overrides.fileService ||
    createFileService({
      fileNodeService,
      blobStorageService,
      uploadService,
      aclService: effectiveAclService,
      fileStorageMode,
      permissionStore,
      ownerNodeResolver,
      blobStore,
      fileNodesStore,
      nodeContentHook,
    });

  const batchOperationService =
    overrides.batchOperationService ||
    createBatchOperationService({
      fileNodeService,
      fileService,
      aclService: effectiveAclService,
    });

  const downloadService =
    overrides.downloadService ||
    createDownloadService({
      fileNodeService,
      blobStorageService,
      aclService: effectiveAclService,
    });

  const versionsService =
    overrides.versionsService ||
    createVersionsService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode,
      aclService: effectiveAclService,
      nodeContentHook,
    });

  const trashService =
    overrides.trashService ||
    createTrashService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode,
      aclService: effectiveAclService,
    });

  const gcService =
    overrides.gcService ||
    createGcService({
      blobStore,
      fileNodesStore,
      fileStorageMode,
      trashService,
    });

  const failSafeService =
    overrides.failSafeService ||
    createFailSafeService({
      fileNodeService,
      fileNodesStore,
      blobStore,
      fileStorageMode,
    });

  const migrationJobStore = overrides.migrationJobStore || createMigrationJobStore();

  const migrationService =
    overrides.migrationService ||
    createMigrationService({
      srcBlobStore: blobStore,
      fileNodesStore,
      fileNodeService,
      buildDestBlobStore,
      lockManager,
      fileStorageMode,
    });

  return {
    fileStorageMode,
    fileNodesStore,
    blobStore,
    fileNodeService,
    blobStorageService,
    uploadService,
    nodeContentHook,
    aclService: effectiveAclService,
    fileService,
    batchOperationService,
    downloadService,
    versionsService,
    trashService,
    gcService,
    failSafeService,
    migrationJobStore,
    migrationService,
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
