'use strict';

const crypto = require('crypto');
const { sha256HexLower } = require('../../../utils/hash');

const MIGRATION_LOCK_NAME = 'migration:blobs';
const MIGRATION_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

const VALID_DIRECTIONS = ['webdav-to-s3', 's3-to-webdav'];
const VALID_MODES = ['dry-run', 'apply'];

function isNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  const haystack = `${error.name || ''} ${error.message || ''}`;
  return /404|not found|nosuchkey/i.test(haystack);
}

function createMigrationService({ srcBlobStore, fileNodesStore, fileNodeService, buildDestBlobStore, lockManager }) {
  if (!srcBlobStore || !fileNodesStore || !fileNodeService || !buildDestBlobStore || !lockManager) {
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
    try {
      await dst.headBlob('/');
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

  async function runFinalize({ dst, snapshot, onProgress }) {
    const results = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const total = snapshot.length;
    let done = 0;

    for (const { node, activeObject } of snapshot) {
      const current = { nodeId: node.id };
      let path = null;
      let outcome = 'skipped';
      try {
        if (activeObject.storage_backend === 's3' && activeObject.s3_key) {
          path = await fileNodeService.getNodePath(node.id);
          current.path = path;
          const cache = await fileNodesStore.getCache(node.id);
          const cacheSize = cache != null ? Number(cache.size) : null;
          const head = await dst.headBlob(path);
          if (head && cacheSize != null && head.contentLength === cacheSize) {
            await fileNodesStore.setObjectMapBackendWebdav(node.id);
            outcome = 'copied';
          }
        }
      } catch (error) {
        outcome = 'failed';
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

  function assertValidOptions({ direction, phase, mode }) {
    if (!VALID_DIRECTIONS.includes(direction)) {
      throw new Error(`Invalid direction: ${direction}. Expected one of: ${VALID_DIRECTIONS.join(', ')}`);
    }
    if (phase !== 'copy' && phase !== 'finalize') {
      throw new Error(`Invalid phase: ${phase}. Expected 'copy' or 'finalize'`);
    }
    if (!VALID_MODES.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Expected one of: ${VALID_MODES.join(', ')}`);
    }
    if (phase === 'finalize' && direction !== 's3-to-webdav') {
      throw new Error('phase "finalize" is only valid for direction "s3-to-webdav"');
    }
    if (phase === 'finalize' && mode !== 'apply') {
      throw new Error('phase "finalize" requires mode "apply"');
    }
  }

  async function run({ direction, phase = 'copy', destConfig, mode = 'dry-run', resume = false, force = false, onProgress = () => {} }) {
    assertValidOptions({ direction, phase, mode });

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

      if (phase === 'finalize') {
        return await runFinalize({ dst, snapshot, onProgress });
      }
      if (mode === 'dry-run') {
        return await runDry({ direction, dst, snapshot, resume, onProgress });
      }
      return await runCopy({ direction, dst, snapshot, resume, force, onProgress });
    } finally {
      await lock.release();
    }
  }

  return { run };
}

module.exports = { createMigrationService };
