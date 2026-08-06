'use strict';

/**
 * Factory: create a garbage-collection service bound to one blob store + store pair.
 *
 * Two-tier orphan cleanup:
 *   Tier 1 (DB-driven): object_map rows with status='orphaned' older than the TTL
 *                       → S3 blob deleted, row removed from object_map.
 *   Tier 2 (S3 scan):   listOrphanedKeys() diffed against the active s3_key set
 *                       → keys present only in S3 are deleted.
 *
 * @param {Object} opts
 * @param {Object} opts.blobStore - S3BlobStore or WebdavBlobStore adapter.
 * @param {Object} opts.fileNodesStore - fileNodesStore with GC support queries.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.gcConfig] - `{ orphanTtlDays }`; defaults from GC_ORPHAN_TTL_DAYS.
 */
function createGcService({ blobStore, fileNodesStore, fileStorageMode = 's3', gcConfig = {} }) {
  const isWebdavMode = fileStorageMode === 'webdav';

  function resolveOrphanTtlDays() {
    if (Number.isFinite(gcConfig.orphanTtlDays) && Number(gcConfig.orphanTtlDays) > 0) {
      return gcConfig.orphanTtlDays;
    }
    const envDays = Number(process.env.GC_ORPHAN_TTL_DAYS);
    if (Number.isFinite(envDays) && envDays > 0) {
      return envDays;
    }
    return 1;
  }

  function toDateCutoff(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  /**
   * Tier 1 — DB-driven orphan cleanup.
   * @returns {Promise<{ orphanedRows: number, deletedBlobs: number, deletedRows: number, errors: string[] }>}
   */
  async function runTier1(olderThanDays) {
    const result = { orphanedRows: 0, deletedBlobs: 0, deletedRows: 0, errors: [] };
    let rows;
    try {
      rows = await fileNodesStore.getOrphanedObjects(olderThanDays);
    } catch (error) {
      result.errors.push(`Failed to query orphaned object_map rows: ${error.message}`);
      return result;
    }

    result.orphanedRows = rows.length;
    if (rows.length === 0) {
      return result;
    }

    for (const row of rows) {
      if (!row.s3_key) continue;
      try {
        await blobStore.deleteBlob(row.s3_key);
        result.deletedBlobs += 1;
      } catch (error) {
        result.errors.push(`Failed to delete S3 blob ${row.s3_key}: ${error.message}`);
      }
    }

    try {
      const res = await fileNodesStore.deleteObjectMapRows(rows.map((r) => r.id));
      result.deletedRows = res.changes;
    } catch (error) {
      result.errors.push(`Failed to delete orphaned object_map rows: ${error.message}`);
    }

    return result;
  }

  /**
   * Tier 2 — S3 bucket reconciliation against the active key set.
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

    let activeKeys;
    try {
      activeKeys = await fileNodesStore.getAllActiveS3Keys();
    } catch (error) {
      result.errors.push(`Failed to load active s3_key set: ${error.message}`);
      return result;
    }
    const activeKeySet = new Set(activeKeys);

    const untracked = candidateKeys.filter((key) => !activeKeySet.has(key));
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
   * Run a full GC cycle (Tier 1 then Tier 2).
   * @param {Object} [opts]
   * @param {number} [opts.olderThanDays] - orphan age threshold; defaults to config TTL.
   * @returns {Promise<{ tier1: Object, tier2: Object }>}
   */
  async function runGcCycle({ olderThanDays } = {}) {
    const days = Number.isFinite(olderThanDays) && olderThanDays > 0
      ? olderThanDays
      : resolveOrphanTtlDays();

    const tier1 = await runTier1(days);
    const tier2 = await runTier2(days);

    return { tier1, tier2 };
  }

  return { runGcCycle };
}

module.exports = { createGcService };
