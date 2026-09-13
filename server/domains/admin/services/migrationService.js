'use strict';

const crypto = require('crypto');
const { sha256HexLower } = require('../../../utils/hash');
const {
  deriveDirection,
  destinationTypeForDirection,
} = require('../../../infrastructure/adapters/blobstore/config');
const { buildTrashPath } = require('../../../service/webdavRemoteOps');
const Settings = require('../../../models/Settings');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

// Registry keys written when an `apply` run completes (D10/F2). Secret keys
// (AWS_SECRET_ACCESS_KEY, WEBDAV_PASSWORD) are stored as plaintext strings.
const STORAGE_PERSIST_MAP = {
  s3: [
    { key: 'WEA_FILE_STORAGE', valueFrom: 'type' },
    { key: 'S3_BUCKET', valueFrom: 'bucket' },
    { key: 'AWS_REGION', valueFrom: 'region' },
    { key: 'AWS_ACCESS_KEY_ID', valueFrom: 'accessKey' },
    { key: 'AWS_SECRET_ACCESS_KEY', valueFrom: 'secretKey' },
    { key: 'S3_ENDPOINT', valueFrom: 'endpoint' },
  ],
  webdav: [
    { key: 'WEA_FILE_STORAGE', valueFrom: 'type' },
    { key: 'WEBDAV_URL', valueFrom: 'url' },
    { key: 'WEBDAV_USERNAME', valueFrom: 'username' },
    { key: 'WEBDAV_PASSWORD', valueFrom: 'password' },
    { key: 'WEBDAV_AUTH_TYPE', valueFrom: 'authType' },
  ],
};

/**
 * Persist a completed blob-migration destination config to the DB (PLAN D10).
 *
 * For every mapped registry key with a non-empty value in `destConfig`, the
 * current effective source is checked first: env-sourced keys are skipped
 * (there is no env <-> DB sync tool; the operator edits `.env` instead).
 * DB/default-sourced keys are written via Settings.set as plaintext strings
 * (secret values included), then invalidated from the resolver cache. Returns
 * `{ persisted, skippedEnvSourced }`.
 *
 * @param {{ type: 's3'|'webdav', [k: string]: any }} destConfig
 * @returns {Promise<{ persisted: string[], skippedEnvSourced: string[] }>}
 */
async function persistStorageConfigToDb(destConfig) {
  const mapping = destConfig && STORAGE_PERSIST_MAP[destConfig.type];
  if (!mapping) return { persisted: [], skippedEnvSourced: [] };

  const values = {};
  for (const { key, valueFrom } of mapping) {
    const value = valueFrom === 'type' ? destConfig.type : destConfig[valueFrom];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    values[key] = String(value);
  }

  const current = await getSharedResolver().getEffectiveConfig();
  const persisted = [];
  const skippedEnvSourced = [];

  for (const key of Object.keys(values)) {
    if (current[key] && current[key].source === 'env') {
      skippedEnvSourced.push(key);
      continue;
    }

    await Settings.set(key, values[key]);
    persisted.push(key);
  }

  if (persisted.length > 0) {
    getSharedResolver().invalidateCache(persisted);
  }

  return { persisted, skippedEnvSourced };
}

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

function createMigrationService({
  srcBlobStore,
  fileNodesStore,
  fileNodeService,
  buildDestBlobStore,
  lockManager,
  fileStorageMode,
}) {
  if (
    !srcBlobStore ||
    !fileNodesStore ||
    !fileNodeService ||
    !buildDestBlobStore ||
    !lockManager ||
    !fileStorageMode
  ) {
    throw new Error('createMigrationService: missing required dependency');
  }

  async function enumerateSnapshot() {
    const isWebdavSource = fileStorageMode === 'webdav';
    // DEF-16 P8: trashed nodes (deleted_at set) are EXPLICITLY part of the
    // snapshot — a trashed item must survive the cutover still trashed. The
    // enumerations below include them naturally (S3 source: trash performs no
    // physical I/O and leaves sync_status='active' + the active object row;
    // WebDAV source: a trashed node is never 'orphaned_node' — a trash MOVE
    // failure aborts the trash instead). The copy never rewrites file_nodes,
    // so deleted_at survives untouched in both directions.
    const nodes = isWebdavSource
      ? await fileNodesStore.getNodesBySyncStatusNot('orphaned_node')
      : await fileNodesStore.getNodesBySyncStatus('active');
    const snapshot = [];
    for (const node of nodes) {
      if (node.type !== 'file') continue;
      const activeObject = await fileNodesStore.getActiveObject(node.id);
      if (!isWebdavSource && !activeObject) continue;
      snapshot.push({
        node,
        activeObject: activeObject || { s3_key: null, storage_backend: 'webdav' },
      });
    }
    snapshot.sort((a, b) => a.node.id - b.node.id);
    return snapshot;
  }

  /**
   * Trash-aware blob I/O path (DEF-16 P8): a trashed node's content lives at
   * /.wea-trash/<nodeId> in WebDAV storage — the webdav→s3 copy reads FROM
   * the trash path and the s3→webdav copy uploads TO the trash path (a
   * trashed row's display path must stay free, and the trash purge expects
   * the content under the trash path). The progress display keeps the
   * original display path.
   */
  function blobIoPathForNode(node, displayPath) {
    return node.deletedAt != null ? buildTrashPath(node.id) : displayPath;
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
    // DEF-16 P8: the resume probe uses the trash path for a trashed node.
    const ioPath = blobIoPathForNode(node, nodePath);
    const head = await dst.headBlob(ioPath);
    return Boolean(head && head.contentLength === Number(cache.size));
  }

  async function processNode({ direction, node, activeObject, nodePath, dst, resume, force }) {
    if (await shouldSkip({ direction, node, activeObject, nodePath, dst, resume, force })) {
      return { action: 'skipped', path: nodePath };
    }

    // DEF-16 P8: the physical I/O path is trash-aware for trashed nodes.
    const ioPath = blobIoPathForNode(node, nodePath);

    if (direction === 'webdav-to-s3') {
      const buf = await srcBlobStore.downloadBlob(ioPath);
      if (buf == null) throw new Error('Source blob not found');
      const key = crypto.randomUUID();
      await dst.uploadBlob(key, buf);
      await fileNodesStore.upsertObjectMap(node.id, key, 'active');
      const cache = await fileNodesStore.getCache(node.id);
      await fileNodesStore.upsertCache(
        node.id,
        buf.length,
        (cache && cache.mime_type) || null,
        sha256HexLower(buf)
      );
      await fileNodeService.updateSyncStatus(node.id, 'active');
      return { action: 'copied', path: nodePath };
    }

    const buf = await srcBlobStore.downloadBlob(activeObject.s3_key);
    if (buf == null) throw new Error('Source blob not found');
    await ensureAncestorDirectories(dst, ioPath);
    await dst.uploadBlob(ioPath, buf);
    const cache = await fileNodesStore.getCache(node.id);
    await fileNodesStore.upsertCache(
      node.id,
      buf.length,
      (cache && cache.mime_type) || null,
      sha256HexLower(buf)
    );
    await fileNodesStore.setObjectMapBackendWebdav(node.id);
    return { action: 'copied', path: nodePath };
  }

  async function runCopy({ direction, dst, snapshot, resume, force, onProgress, isCancelled }) {
    const results = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const total = snapshot.length;
    let done = 0;

    for (const { node, activeObject } of snapshot) {
      if (isCancelled && isCancelled()) break;

      const current = { nodeId: node.id };
      let path = null;
      let outcome = 'failed';
      try {
        path = await fileNodeService.getNodePath(node.id);
        current.path = path;
        const processed = await processNode({
          direction,
          node,
          activeObject,
          nodePath: path,
          dst,
          resume,
          force,
        });
        outcome = processed.action;
      } catch (error) {
        current.path = path;
        results.errors.push({ nodeId: node.id, path, error: error.message });
      }

      if (outcome === 'copied') results.copied += 1;
      else if (outcome === 'skipped') results.skipped += 1;
      else results.failed += 1;

      done += 1;
      onProgress({
        total,
        done,
        current,
        copied: results.copied,
        skipped: results.skipped,
        failed: results.failed,
      });
      if (isCancelled && isCancelled()) break;
    }

    return { ...results, dryRun: false };
  }

  async function runDry({ direction, dst, snapshot, resume, onProgress, isCancelled }) {
    const results = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const total = snapshot.length;
    let done = 0;

    for (const { node, activeObject } of snapshot) {
      if (isCancelled && isCancelled()) break;

      const current = { nodeId: node.id };
      let path = null;
      let outcome = 'pending';
      try {
        path = await fileNodeService.getNodePath(node.id);
        current.path = path;
        if (
          await shouldSkip({
            direction,
            node,
            activeObject,
            nodePath: path,
            dst,
            resume,
            force: false,
          })
        ) {
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
      onProgress({
        total,
        done,
        current,
        copied: 0,
        skipped: results.skipped,
        failed: results.failed,
      });
      if (isCancelled && isCancelled()) break;
    }

    return { ...results, dryRun: true };
  }

  function assertValidOptions({ mode }) {
    if (!VALID_MODES.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Expected one of: ${VALID_MODES.join(', ')}`);
    }
  }

  async function run({
    destConfig,
    mode = 'dry-run',
    force = false,
    onProgress = () => {},
    isCancelled = () => false,
  }) {
    const direction = deriveDirection(fileStorageMode);
    const expectedDestType = destinationTypeForDirection(direction);
    if (!destConfig || destConfig.type !== expectedDestType) {
      throw new Error(
        `Destination type mismatch: expected ${expectedDestType} for direction ${direction}`
      );
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
        return await runDry({ direction, dst, snapshot, resume: true, onProgress, isCancelled });
      }
      return await runCopy({
        direction,
        dst,
        snapshot,
        resume: true,
        force,
        onProgress,
        isCancelled,
      });
    } finally {
      await lock.release();
    }
  }

  return { run };
}

module.exports = { createMigrationService, persistStorageConfigToDb };
