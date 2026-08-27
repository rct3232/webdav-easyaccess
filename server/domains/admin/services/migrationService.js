'use strict';

const crypto = require('crypto');
const { sha256HexLower } = require('../../../utils/hash');
const { deriveDirection, destinationTypeForDirection } = require('../../../infrastructure/adapters/blobstore/config');

const MIGRATION_LOCK_NAME = 'migration:blobs';
const MIGRATION_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

const VALID_MODES = ['dry-run', 'apply'];

function isNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  if (error.$metadata && error.$metadata.httpStatusCode === 404) return true;
  const haystack = `${error.name || ''} ${error.message || ''}`;
  return /404|not found|notfound|nosuchkey/i.test(haystack);
}

function createMigrationService({ srcBlobStore, fileNodesStore, fileNodeService, buildDestBlobStore, lockManager, fileStorageMode }) {
  if (!srcBlobStore || !fileNodesStore || !fileNodeService || !buildDestBlobStore || !lockManager || !fileStorageMode) {
    throw new Error('createMigrationService: missing required dependency');
  }

  async function enumerateSnapshot() {
    const nodes = await fileNodesStore.getNodesBySyncStatus('active');
    const snapshot = [];
    for (const node of nodes) {
      if (node.type !== 'file') continue;
      const activeObject = await fileNodesStore.getActiveObject(node.id);
      if (!activeObject) continue;
      snapshot.push({ node, activeObject });
    }
    snapshot.sort((a, b) => a.node.id - b.node.id);
    return snapshot;
  }

  async function probeDestination(dst) {
    // Probe a random key, not '/': MinIO returns a response the S3 SDK cannot
    // parse for the bare root key (UnknownError). A missing random key yields a
    // clean 404/NotFound on both S3 and WebDAV destinations, which is what a
    // connectivity probe should expect.
    try {
      await dst.headBlob(`__wea_migration_probe_${crypto.randomUUID()}`);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  async function ensureAncestorDirectories(dst, nodePath) {
    const segments = nodePath.split('/').filter(Boolean);
    let currentPath = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[i]}` : `/${segments[i]}`;
      await dst.ensureDirectoryExists(currentPath);
    }
  }

  async function shouldSkip({ direction, node, activeObject, nodePath, dst, resume, force }) {
    if (direction === 'webdav-to-s3') {
      return Boolean(resume && !force && activeObject.s3_key);
    }
    if (!activeObject.s3_key || activeObject.storage_backend !== 's3') {
      return true;
    }
    if (!resume || force) return false;
    const cache = await fileNodesStore.getCache(node.id);
    if (cache == null) return false;
    const head = await dst.headBlob(nodePath);
    return Boolean(head && head.contentLength === Number(cache.size));
  }

  async function processNode({ direction, node, activeObject, nodePath, dst, resume, force }) {
    if (await shouldSkip({ direction, node, activeObject, nodePath, dst, resume, force })) {
      return { action: 'skipped', path: nodePath };
    }

    if (direction === 'webdav-to-s3') {
      const buf = await srcBlobStore.downloadBlob(nodePath);
      if (buf == null) throw new Error('Source blob not found');
      const key = crypto.randomUUID();
      await dst.uploadBlob(key, buf);
      await fileNodesStore.upsertObjectMap(node.id, key, 'active');
      const cache = await fileNodesStore.getCache(node.id);
      await fileNodesStore.upsertCache(node.id, buf.length, (cache && cache.mime_type) || null, sha256HexLower(buf));
      return { action: 'copied', path: nodePath };
    }

    const buf = await srcBlobStore.downloadBlob(activeObject.s3_key);
    if (buf == null) throw new Error('Source blob not found');
    await ensureAncestorDirectories(dst, nodePath);
    await dst.uploadBlob(nodePath, buf);
    const cache = await fileNodesStore.getCache(node.id);
    await fileNodesStore.upsertCache(node.id, buf.length, (cache && cache.mime_type) || null, sha256HexLower(buf));
    await fileNodesStore.setObjectMapBackendWebdav(node.id);
    return { action: 'copied', path: nodePath };
  }

  async function runCopy({ direction, dst, snapshot, resume, force, onProgress }) {
    const results = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const total = snapshot.length;
    let done = 0;

    for (const { node, activeObject } of snapshot) {
      const current = { nodeId: node.id };
      let path = null;
      let outcome = 'failed';
      try {
        path = await fileNodeService.getNodePath(node.id);
        current.path = path;
        const processed = await processNode({ direction, node, activeObject, nodePath: path, dst, resume, force });
        outcome = processed.action;
      } catch (error) {
        current.path = path;
        results.errors.push({ nodeId: node.id, path, error: error.message });
      }

      if (outcome === 'copied') results.copied += 1;
      else if (outcome === 'skipped') results.skipped += 1;
      else results.failed += 1;

      done += 1;
      onProgress({ total, done, current, copied: results.copied, skipped: results.skipped, failed: results.failed });
    }

    return { ...results, dryRun: false };
  }

  async function runDry({ direction, dst, snapshot, resume, onProgress }) {
    const results = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const total = snapshot.length;
    let done = 0;

    for (const { node, activeObject } of snapshot) {
      const current = { nodeId: node.id };
      let path = null;
      let outcome = 'pending';
      try {
        path = await fileNodeService.getNodePath(node.id);
        current.path = path;
        if (await shouldSkip({ direction, node, activeObject, nodePath: path, dst, resume, force: false })) {
          outcome = 'skipped';
        }
      } catch (error) {
        current.path = path;
        outcome = 'failed';
        results.errors.push({ nodeId: node.id, path, error: error.message });
      }

      if (outcome === 'skipped') results.skipped += 1;
      else if (outcome === 'failed') results.failed += 1;

      done += 1;
      onProgress({ total, done, current, copied: 0, skipped: results.skipped, failed: results.failed });
    }

    return { ...results, dryRun: true };
  }

  function assertValidOptions({ mode }) {
    if (!VALID_MODES.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Expected one of: ${VALID_MODES.join(', ')}`);
    }
  }

  async function run({ destConfig, mode = 'dry-run', force = false, onProgress = () => {} }) {
    const direction = deriveDirection(fileStorageMode);
    const expectedDestType = destinationTypeForDirection(direction);
    if (!destConfig || destConfig.type !== expectedDestType) {
      throw new Error(`Destination type mismatch: expected ${expectedDestType} for direction ${direction}`);
    }
    assertValidOptions({ mode });

    let lock;
    try {
      lock = await lockManager.acquireLock(MIGRATION_LOCK_NAME, {
        ttlMs: MIGRATION_LOCK_TTL_MS,
        waitMs: 0,
      });
    } catch (error) {
      if (error && error.code === 'LOCK_TIMEOUT') {
        throw new Error('migration already in progress');
      }
      throw error;
    }

    try {
      const dst = buildDestBlobStore(destConfig).blobStore;
      const snapshot = await enumerateSnapshot();
      await probeDestination(dst);

      if (mode === 'dry-run') {
        return await runDry({ direction, dst, snapshot, resume: true, onProgress });
      }
      return await runCopy({ direction, dst, snapshot, resume: true, force, onProgress });
    } finally {
      await lock.release();
    }
  }

  return { run };
}

module.exports = { createMigrationService };
