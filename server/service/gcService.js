'use strict';

const { getSharedResolver } = require('../infrastructure/configResolver');

/**
 * Factory: create a garbage-collection service bound to one blob store + store pair.
 *
 * Three-tier orphan cleanup:
 *   Tier 1 (DB-driven): orphaned object_map rows classified per retention category
 *                       (garbage / version / guarded) — expired rows get their S3 blob
 *                       deleted and the row removed from object_map; stale pending rows
 *                       on stuck nodes are cleaned after their own TTL.
 *   Tier 2 (S3 scan):   listOrphanedKeys() diffed against the kept s3_key set
 *                       (active ∪ orphaned ∪ pending-live)
 *                       → keys present only in S3 are deleted.
 *   Tier 3 (trash):     trashed nodes whose TRASH_RETENTION_DAYS retention expired
 *                       are purged through the shared trash purge core (DEF-16 P5);
 *                       0 = retention off.
 *
 * @param {Object} opts
 * @param {Object} opts.blobStore - S3BlobStore or WebdavBlobStore adapter.
 * @param {Object} opts.fileNodesStore - fileNodesStore with GC support queries.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.gcConfig] - `{ orphanTtlDays, versionTtlDays, pendingStaleDays, trashRetentionDays }`;
 *   each key defaults from its DB setting (GC_ORPHAN_TTL_DAYS, GC_VERSION_TTL_DAYS,
 *   GC_PENDING_STALE_DAYS, TRASH_RETENTION_DAYS).
 * @param {Object} [opts.trashService] - trashService instance providing the shared
 *   physical purge core `purgeNode(nodeId)` (Tier 3 delegates each expired trashed
 *   root's purge to it).
 */
function createGcService({
  blobStore,
  fileNodesStore,
  fileStorageMode = 's3',
  gcConfig = {},
  trashService,
}) {
  const isWebdavMode = fileStorageMode === 'webdav';

  // GC_* TTLs are T2 (hot): resolved lazily per GC cycle so DB changes
  // apply without a restart.
  async function resolveOrphanTtlDays() {
    if (Number.isFinite(gcConfig.orphanTtlDays) && Number(gcConfig.orphanTtlDays) > 0) {
      return gcConfig.orphanTtlDays;
    }
    const configured = await getSharedResolver().getConfig('GC_ORPHAN_TTL_DAYS');
    const envDays = Number(configured);
    if (Number.isFinite(envDays) && envDays > 0) {
      return envDays;
    }
    return 1;
  }

  async function resolveVersionTtlDays() {
    if (Number.isFinite(gcConfig.versionTtlDays) && Number(gcConfig.versionTtlDays) > 0) {
      return gcConfig.versionTtlDays;
    }
    const configured = await getSharedResolver().getConfig('GC_VERSION_TTL_DAYS');
    const envDays = Number(configured);
    if (Number.isFinite(envDays) && envDays > 0) {
      return envDays;
    }
    return 1;
  }

  // 0 is a valid value (= pending-live cleanup disabled); only negatives fall back.
  async function resolvePendingStaleDays() {
    if (Number.isFinite(gcConfig.pendingStaleDays) && Number(gcConfig.pendingStaleDays) >= 0) {
      return gcConfig.pendingStaleDays;
    }
    const configured = await getSharedResolver().getConfig('GC_PENDING_STALE_DAYS');
    const envDays = Number(configured);
    if (Number.isFinite(envDays) && envDays >= 0) {
      return envDays;
    }
    return 3;
  }

  // 0 is a valid value (= trash retention off, Tier 3 skipped); only negatives fall back.
  async function resolveTrashRetentionDays() {
    if (Number.isFinite(gcConfig.trashRetentionDays) && Number(gcConfig.trashRetentionDays) >= 0) {
      return gcConfig.trashRetentionDays;
    }
    const configured = await getSharedResolver().getConfig('TRASH_RETENTION_DAYS');
    const envDays = Number(configured);
    if (Number.isFinite(envDays) && envDays >= 0) {
      return envDays;
    }
    return 30;
  }

  function toDateCutoff(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  async function deleteBlobsForRows(rows, result) {
    for (const row of rows) {
      if (!row.s3_key) continue;
      if (isWebdavMode) continue;
      try {
        await blobStore.deleteBlob(row.s3_key);
        result.deletedBlobs += 1;
      } catch (error) {
        result.errors.push(`Failed to delete S3 blob ${row.s3_key}: ${error.message}`);
      }
    }
  }

  async function deleteObjectMapRowsAndCount(ids, result, failureLabel) {
    try {
      const res = await fileNodesStore.deleteObjectMapRows(ids);
      return res.changes;
    } catch (error) {
      result.errors.push(`${failureLabel}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Tier 1 — DB-driven orphan cleanup (retention categories: garbage / version /
   * guarded) plus stale pending-live cleanup.
   * @returns {Promise<{ orphanedRows: number, guardedRows: number, deletedBlobs: number, deletedRows: number, pendingDeletedRows: number, errors: string[] }>}
   */
  async function runTier1(orphanDays, explicitOlderThanDays) {
    const result = {
      orphanedRows: 0,
      guardedRows: 0,
      deletedBlobs: 0,
      deletedRows: 0,
      pendingDeletedRows: 0,
      errors: [],
    };
    let rows;
    try {
      rows = await fileNodesStore.getOrphanedObjectsWithNodeState(orphanDays);
    } catch (error) {
      result.errors.push(`Failed to query orphaned object_map rows: ${error.message}`);
      return result;
    }

    result.orphanedRows = rows.length;

    const versionCutoffDays =
      Number.isFinite(explicitOlderThanDays) && explicitOlderThanDays > 0
        ? explicitOlderThanDays
        : await resolveVersionTtlDays();
    const versionCutoffMs = toDateCutoff(versionCutoffDays).getTime();

    const deletable = [];
    for (const row of rows) {
      if (row.node_sync_status == null) {
        deletable.push(row);
      } else if (row.node_sync_status === 'pending_upload' && !Number(row.has_active)) {
        result.guardedRows += 1;
      } else if (new Date(row.created_at).getTime() < versionCutoffMs) {
        deletable.push(row);
      }
    }

    await deleteBlobsForRows(deletable, result);
    result.deletedRows = await deleteObjectMapRowsAndCount(
      deletable.map((r) => r.id),
      result,
      'Failed to delete orphaned object_map rows'
    );

    const pendingStaleDays = await resolvePendingStaleDays();
    if (pendingStaleDays > 0) {
      let staleRows;
      try {
        staleRows = await fileNodesStore.getStalePendingObjects(pendingStaleDays);
      } catch (error) {
        result.errors.push(`Failed to query stale pending object_map rows: ${error.message}`);
        return result;
      }

      await deleteBlobsForRows(staleRows, result);
      result.pendingDeletedRows = await deleteObjectMapRowsAndCount(
        staleRows.map((r) => r.id),
        result,
        'Failed to delete stale pending object_map rows'
      );
      result.deletedRows += result.pendingDeletedRows;
    }

    return result;
  }

  /**
   * Tier 2 — S3 bucket reconciliation against the kept key set.
   * @returns {Promise<{ scannedKeys: number, untrackedKeys: number, deletedKeys: number, skipped: boolean, errors: string[] }>}
   */
  async function runTier2(olderThanDays) {
    const result = {
      scannedKeys: 0,
      untrackedKeys: 0,
      deletedKeys: 0,
      skipped: false,
      errors: [],
    };

    if (isWebdavMode || typeof blobStore.listOrphanedKeys !== 'function') {
      result.skipped = true;
      return result;
    }

    let candidateKeys;
    try {
      candidateKeys = await blobStore.listOrphanedKeys(toDateCutoff(olderThanDays));
    } catch (error) {
      result.errors.push(`Failed to list orphaned S3 keys: ${error.message}`);
      return result;
    }

    result.scannedKeys = candidateKeys.length;
    if (candidateKeys.length === 0) {
      return result;
    }

    let keptKeys;
    try {
      keptKeys = await fileNodesStore.getKeptS3Keys();
    } catch (error) {
      result.errors.push(`Failed to load kept s3_key set: ${error.message}`);
      return result;
    }
    const keptKeySet = new Set(keptKeys);

    const untracked = candidateKeys.filter((key) => !keptKeySet.has(key));
    result.untrackedKeys = untracked.length;

    for (const key of untracked) {
      try {
        await blobStore.deleteBlob(key);
        result.deletedKeys += 1;
      } catch (error) {
        result.errors.push(`Failed to delete untracked S3 blob ${key}: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Tier 3 — trash-retention purge (DEF-16 P5): every TOPMOST trashed node
   * whose deleted_at is older than TRASH_RETENTION_DAYS is purged through the
   * shared trash purge core (its whole subtree dies with the root). Per-node
   * best-effort: failures are collected and never abort the cycle.
   * @returns {Promise<{ purgedNodes: number, deletedBlobs: number, deletedRows: number, skipped: boolean, errors: string[] }>}
   */
  async function runTier3() {
    const result = {
      purgedNodes: 0,
      deletedBlobs: 0,
      deletedRows: 0,
      skipped: false,
      errors: [],
    };

    const retentionDays = await resolveTrashRetentionDays();
    if (retentionDays === 0) {
      result.skipped = true;
      return result;
    }
    if (!trashService || typeof trashService.purgeNode !== 'function') {
      result.skipped = true;
      return result;
    }

    let expiredRoots;
    try {
      expiredRoots = await fileNodesStore.getTopmostTrashedNodes(retentionDays);
    } catch (error) {
      result.errors.push(`Failed to query expired trashed nodes: ${error.message}`);
      return result;
    }

    for (const node of expiredRoots) {
      try {
        const purged = await trashService.purgeNode(node.id);
        result.purgedNodes += 1;
        result.deletedBlobs += purged.deletedBlobs || 0;
        result.deletedRows += purged.purgedNodes || 0;
        if (Array.isArray(purged.errors)) {
          result.errors.push(...purged.errors);
        }
      } catch (error) {
        result.errors.push(`Failed to purge trashed node ${node.id}: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Run a full GC cycle (Tier 1, Tier 2, Tier 3).
   * @param {Object} [opts]
   * @param {number} [opts.olderThanDays] - orphan age threshold; defaults to config TTL.
   * @returns {Promise<{ tier1: Object, tier2: Object, tier3: Object }>}
   */
  async function runGcCycle({ olderThanDays } = {}) {
    const days =
      Number.isFinite(olderThanDays) && olderThanDays > 0
        ? olderThanDays
        : await resolveOrphanTtlDays();

    const tier1 = await runTier1(days, olderThanDays);
    const tier2 = await runTier2(days);
    const tier3 = await runTier3();

    return { tier1, tier2, tier3 };
  }

  return { runGcCycle };
}

module.exports = { createGcService };
