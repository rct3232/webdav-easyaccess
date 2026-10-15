'use strict';

/**
 * admin_reports plumbing (§4.14 Tier A, T0.7b) + the T0.8 store wiring + the
 * T0.1 content-hash completeness machinery:
 *
 * - constants + best-effort report-writer seam shared by the cleanup route,
 *   the scheduled GC cycle and the startup fail-safe scan;
 * - writer-side housekeeping: after each successful insert the shared writer
 *   best-effort deletes rows older than ADMIN_REPORTS_RETENTION_DAYS (§2.2.6);
 * - the boot completeness probe (`COUNT(*) WHERE content_hash IS NULL` →
 *   warn log + `contentHashCompleteness` section merged into the startup
 *   failsafe row by `runStartupFailSafeRecovery`);
 * - the streaming NULL content-hash backfill and the kind/action repair
 *   dispatch behind `POST /api/admin/reports/:id/repair`.
 *
 * Ownership: the `admin_reports` TABLE DDL lives in
 * `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (T0.2); the
 * store (`server/store/adminReportsStore.js`) and the read/repair routes land
 * with T0.8 (docs/spec/server/routes/admin.md §2.2.6).
 *
 * Writes are best-effort by contract: a missing/throwing store write (e.g.
 * the admin_reports table not yet migrated) is caught and warn-logged; GC,
 * cleanup and boot must never fail because reporting failed. Test seam:
 * `WEA_SKIP_ADMIN_REPORTS` truthy ⇒ all writes no-op.
 */

/* eslint-disable no-console -- best-effort ops reporting */

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, validationError } = require('../../../utils/errorHandler');
const { sha256HexLower } = require('../../../utils/hash');
const { buildTrashPath } = require('../../../service/webdavRemoteOps');

const ADMIN_REPORT_KINDS = Object.freeze({
  gc: 'gc',
  migration: 'migration',
  failsafe: 'failsafe',
  night_eval: 'night_eval',
  cleanup: 'cleanup',
});

const ADMIN_REPORT_STATUSES = Object.freeze({
  ok: 'ok',
  partial: 'partial',
});

/** Shipped default for ADMIN_REPORTS_RETENTION_DAYS (0 = retention off). */
const DEFAULT_ADMIN_REPORTS_RETENTION_DAYS = 30;

/** Test seam: any truthy value disables admin report persistence. */
function shouldSkipAdminReports() {
  const skip = (process.env.WEA_SKIP_ADMIN_REPORTS || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

/**
 * Derive the row status from a run result: 'partial' when the result or any
 * nested section (e.g. GC `tier1`/`tier2`/`tier3`) carries errors, else 'ok'.
 * @param {Object} [result]
 * @returns {'ok'|'partial'}
 */
function resolveAdminReportStatus(result) {
  if (result && Array.isArray(result.errors) && result.errors.length > 0) {
    return ADMIN_REPORT_STATUSES.partial;
  }
  if (result && typeof result === 'object') {
    const sections = Object.values(result).filter((value) => value && typeof value === 'object');
    if (sections.some((section) => Array.isArray(section.errors) && section.errors.length > 0)) {
      return ADMIN_REPORT_STATUSES.partial;
    }
  }
  return ADMIN_REPORT_STATUSES.ok;
}

/**
 * Resolve the shared admin-reports writer lazily (DI overrides it in tests).
 * Wired to the `admin_reports` store since T0.8; a store failure degrades to
 * the best-effort null result (never breaks GC/cleanup/boot).
 */
function resolveAdminReportsStore() {
  return require('../../../store/adminReportsStore');
}

/**
 * Hot read of ADMIN_REPORTS_RETENTION_DAYS via the shared resolver
 * (docs/spec/server/routes/admin.md §2.2.6). A non-numeric/negative value or
 * any read failure falls back to the shipped default (0 = retention off).
 * @returns {Promise<number>}
 */
async function resolveAdminReportsRetentionDays() {
  try {
    // Lazy require: no resolver/DB coupling at module load.
    const { getSharedResolver } = require('../../../infrastructure/configResolver');
    const raw = await getSharedResolver().getConfig('ADMIN_REPORTS_RETENTION_DAYS');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ADMIN_REPORTS_RETENTION_DAYS;
  } catch {
    return DEFAULT_ADMIN_REPORTS_RETENTION_DAYS;
  }
}

/**
 * Factory. `insertReport` is the store seam — injected in tests; the shared
 * singleton resolves `store/adminReportsStore.js` (T0.8). `pruneReports` is
 * the §2.2.6 housekeeping seam: after each successful insert the writer
 * best-effort deletes rows older than ADMIN_REPORTS_RETENTION_DAYS (a prune
 * failure warn-logs only, never fails the write).
 *
 * @param {Object} [opts]
 * @param {(row: {kind, status, payload, created_at}) => Promise<Object>} [opts.insertReport]
 * @param {(cutoffMs: number) => Promise<{ changes: number }>} [opts.pruneReports]
 * @param {(() => number|string|Promise<number|string>)} [opts.resolveRetentionDays] - seam (tests)
 * @param {() => string} [opts.now] - ISO timestamp provider (tests)
 */
function createAdminReportsWriter({
  insertReport = null,
  pruneReports = null,
  resolveRetentionDays = null,
  now = () => new Date().toISOString(),
} = {}) {
  /**
   * Best-effort housekeeping DELETE (§2.2.6). Never throws to the caller.
   */
  async function pruneOlderReports() {
    try {
      const raw = resolveRetentionDays
        ? await resolveRetentionDays()
        : await resolveAdminReportsRetentionDays();
      const parsed = Number(raw);
      const retentionDays =
        Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ADMIN_REPORTS_RETENTION_DAYS;
      if (retentionDays === 0) return;
      const writtenAt = Date.parse(now());
      const cutoffMs =
        (Number.isFinite(writtenAt) ? writtenAt : Date.now()) - retentionDays * 86400000;
      await pruneReports(cutoffMs);
    } catch (error) {
      console.warn(`admin report pruning skipped: ${error.message}`);
    }
  }

  /**
   * Persist one report row. Returns the insertReport result, or null when
   * skipped (seam / no store / write failure) — never throws to the caller.
   * A persisted row triggers the §2.2.6 prune when the seam is wired.
   * @param {{ kind: string, status: string, payload?: Object }} spec
   */
  async function writeReport({ kind, status, payload } = {}) {
    if (shouldSkipAdminReports()) return null;
    if (!ADMIN_REPORT_KINDS[kind]) {
      throw new TypeError(`Unknown admin report kind: ${String(kind)}`);
    }
    const store = insertReport || ((row) => resolveAdminReportsStore().insertReport(row));

    const row = {
      kind,
      status: ADMIN_REPORT_STATUSES[status] || status,
      payload: payload === undefined ? null : payload,
      created_at: now(),
    };
    try {
      const result = await store(row);
      const saved = result === undefined ? null : result;
      if (saved && pruneReports) {
        await pruneOlderReports();
      }
      return saved;
    } catch (error) {
      console.warn(`admin report persistence skipped: ${error.message}`);
      return null;
    }
  }

  return { writeReport };
}

let sharedWriter = null;

/** The process-wide writer, wired to the admin_reports store since T0.8. */
function getAdminReportsWriter() {
  if (!sharedWriter) {
    sharedWriter = createAdminReportsWriter({
      pruneReports: (cutoffMs) => resolveAdminReportsStore().deleteReportsOlderThan(cutoffMs),
    });
  }
  return sharedWriter;
}

/* ------------------------------------------------------------------ *
 * T0.1 — content-hash completeness (probe + streaming backfill)       *
 * ------------------------------------------------------------------ */

/** Repair actions dispatched by `repairAdminReport` (kind/action table). */
const ADMIN_REPAIR_ACTIONS = Object.freeze({
  content_hash: 'content_hash',
  repair_sync: 'repair-sync',
  perm_delete: 'perm-delete',
});

const BACKFILL_DEFAULT_BATCH = 200;

function resolveBackfillDeps(overrides = {}) {
  const fileNodesStore =
    overrides.fileNodesStore || require('../../../store/fileNodesStore').createFileNodesStore();
  const fileNodeService =
    overrides.fileNodeService ||
    require('../../../service/fileNodeService').createFileNodeService({ fileNodesStore });
  let blobStore = overrides.blobStore;
  let fileStorageMode = overrides.fileStorageMode;
  if (!blobStore || !fileStorageMode) {
    const { getComposition } = require('../../../service/composition');
    const composition = getComposition();
    blobStore = blobStore || composition.blobStore;
    fileStorageMode = fileStorageMode || composition.fileStorageMode;
  }
  return { fileNodesStore, fileNodeService, blobStore, fileStorageMode };
}

/**
 * Boot completeness probe (T0.1): a cheap, non-blocking
 * `COUNT(*) WHERE content_hash IS NULL` through the FileNodeRepository layer.
 * Returns the `contentHashCompleteness` section (`{ nullCount, checkedAt }`;
 * `nullCount: null` + `error` on count failure) and warn-logs when NULL rows
 * exist or the count fails. Persists nothing itself — `runStartupFailSafeRecovery`
 * merges the section into its single `kind='failsafe'` row
 * (docs/spec/server/routes/admin.md §2.2.6). Best-effort: never throws.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - DI seam (tests)
 * @param {() => string} [opts.now] - ISO timestamp provider (tests)
 * @returns {Promise<{ nullCount: number|null, checkedAt: string, error?: string }>}
 */
async function collectContentHashCompleteness({ fileNodesStore, now } = {}) {
  const checkedAt = now ? now() : new Date().toISOString();
  try {
    const store = fileNodesStore || require('../../../store/fileNodesStore').createFileNodesStore();
    const nullCount = await store.countCacheRowsWithNullContentHash();
    if (nullCount > 0) {
      console.warn(
        `⚠ content_hash completeness: ${nullCount} filecache row(s) missing content_hash — ` +
          `backfill available via POST /api/admin/reports/:id/repair (action content_hash)`
      );
    }
    return { nullCount, checkedAt };
  } catch (error) {
    console.warn(`content_hash completeness probe skipped: ${error.message}`);
    return { nullCount: null, checkedAt, error: error.message };
  }
}

/**
 * Resolve the physical blob location for one file node in the ACTIVE backend
 * mode: S3 → the active object_map s3_key; WebDAV → the display path, or the
 * `/.wea-trash/<rootId>/…` path for rows trashed inside a trashed subtree
 * (same covered-path semantics as trashService.purgeNode).
 * @returns {Promise<string|null>} blob key/path, or null when unresolvable.
 */
async function resolveNodeBlobLocation(node, { fileNodesStore, fileNodeService, fileStorageMode }) {
  if (fileStorageMode === 'webdav') {
    if (node.deletedAt == null) {
      return fileNodeService.getNodePath(node.nodeId);
    }
    // Topmost trashed ancestor (root-most first; getAncestorChain orders by
    // depth DESC) — the node itself when no ancestor row is trashed.
    const chain = await fileNodesStore.getAncestorChain(node.nodeId);
    let trashRoot = null;
    for (const entry of chain) {
      const candidate = await fileNodesStore.getNodeIncludingTrashed(entry.ancestorId);
      if (candidate && candidate.deletedAt != null) {
        trashRoot = candidate;
        break;
      }
    }
    if (!trashRoot) return null;
    if (trashRoot.id === node.nodeId) {
      return buildTrashPath(node.nodeId);
    }
    const nodePath = await fileNodeService.getNodePath(node.nodeId);
    const rootPath = await fileNodeService.getNodePath(trashRoot.id);
    const relative = nodePath.startsWith(rootPath) ? nodePath.slice(rootPath.length) : '';
    return `${buildTrashPath(trashRoot.id)}${relative}`;
  }

  const active = await fileNodesStore.getActiveObject(node.nodeId);
  return active && active.s3_key ? active.s3_key : null;
}

/**
 * T0.1 repair backfill: stream ALL `filecache` rows with
 * `content_hash IS NULL` in keyset-paginated batches, hash each node's blob
 * (`sha256HexLower`) and update `WHERE content_hash IS NULL` only — an
 * already-hashed row is never touched again (idempotency contract). Missing
 * blobs are recorded as errors, never fatal; rows that fail stay NULL and the
 * cursor moves past them, so a re-run only retries what is still NULL.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - DI seam (tests)
 * @param {Object} [opts.fileNodeService] - DI seam (tests)
 * @param {Object} [opts.blobStore] - DI seam (tests)
 * @param {'s3'|'webdav'} [opts.fileStorageMode] - DI seam (tests)
 * @param {number} [opts.batchSize=200]
 * @param {({ backfilled: number, errors: Array, nullCount: number }) => void} [opts.onProgress]
 * @param {() => string} [opts.now]
 * @returns {Promise<{ backfilled: number, nullCount: number, errors: Array, checkedAt: string }>}
 */
async function backfillContentHashes({
  fileNodesStore,
  fileNodeService,
  blobStore,
  fileStorageMode,
  batchSize = BACKFILL_DEFAULT_BATCH,
  onProgress,
  now,
} = {}) {
  const deps = resolveBackfillDeps({
    fileNodesStore,
    fileNodeService,
    blobStore,
    fileStorageMode,
  });
  const checkedAt = now ? now() : new Date().toISOString();
  const errors = [];
  let backfilled = 0;
  let cursor = 0;

  for (;;) {
    const rows = await deps.fileNodesStore.listCacheRowsWithNullContentHash({
      limit: batchSize,
      afterId: cursor,
    });
    if (!rows.length) break;

    for (const node of rows) {
      let location = null;
      try {
        location = await resolveNodeBlobLocation(node, deps);
        if (!location) {
          errors.push({ nodeId: node.nodeId, path: null, error: 'blob not found' });
          continue;
        }
        const buf = await deps.blobStore.downloadBlob(location);
        if (!buf) {
          errors.push({ nodeId: node.nodeId, path: location, error: 'blob not found' });
          continue;
        }
        const res = await deps.fileNodesStore.setCacheContentHash(node.nodeId, sha256HexLower(buf));
        if (res.changes > 0) backfilled += 1;
      } catch (error) {
        errors.push({ nodeId: node.nodeId, path: location, error: error.message });
      }
    }

    cursor = rows[rows.length - 1].nodeId;
    if (rows.length < batchSize) break;
    if (typeof onProgress === 'function') {
      try {
        onProgress({ backfilled, errors: [...errors] });
      } catch {
        /* progress reporting never breaks the backfill */
      }
    }
  }

  const nullCount = await deps.fileNodesStore.countCacheRowsWithNullContentHash();
  return { backfilled, nullCount, errors, checkedAt };
}

/**
 * Kind/action dispatch for `POST /api/admin/reports/:id/repair`.
 * Returns `{ report, result }` — `report` is the re-rendered row.
 *
 * @param {number|string} id
 * @param {{ action?: string, nodeId?: number|string, repairAction?: string }} params
 * @param {Object} [deps] - DI seams (tests): reportsStore, failSafeService,
 *   trashService, backfill (custom backfill impl) + the backfill DI seams.
 * @returns {Promise<{ report: Object, result: Object }>}
 */
async function repairAdminReport(id, params = {}, deps = {}) {
  const reportsStore = deps.reportsStore || resolveAdminReportsStore();
  const row = await reportsStore.getReport(id);
  if (!row) {
    throw createError(SERVER_ERROR_CODES.admin.reportNotFound, HTTP_STATUS.NOT_FOUND, {
      reportId: Number(id),
    });
  }

  const action = params && params.action;
  switch (action) {
    case ADMIN_REPAIR_ACTIONS.content_hash: {
      if (row.kind !== ADMIN_REPORT_KINDS.failsafe) {
        throw validationError(SERVER_ERROR_CODES.admin.repairNotAvailable);
      }
      const section =
        row.payload &&
        typeof row.payload === 'object' &&
        row.payload.contentHashCompleteness &&
        typeof row.payload.contentHashCompleteness === 'object';
      if (!section) {
        throw validationError(SERVER_ERROR_CODES.admin.repairNotAvailable);
      }
      const backfill =
        deps.backfill ||
        ((opts) =>
          backfillContentHashes({
            ...opts,
            rowId: row.id,
            reportsStore,
            onProgress: (progress) => updateReportProgressBestEffort(reportsStore, row, progress),
          }));
      const result = await backfill({
        ...(deps.fileNodesStore ? { fileNodesStore: deps.fileNodesStore } : {}),
        ...(deps.fileNodeService ? { fileNodeService: deps.fileNodeService } : {}),
        ...(deps.blobStore ? { blobStore: deps.blobStore } : {}),
        ...(deps.fileStorageMode ? { fileStorageMode: deps.fileStorageMode } : {}),
        ...(deps.batchSize ? { batchSize: deps.batchSize } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      });
      const payload = {
        ...(row.payload || {}),
        contentHashCompleteness: {
          ...(row.payload.contentHashCompleteness || {}),
          nullCount: result.nullCount,
          checkedAt: result.checkedAt,
          backfilled: result.backfilled,
          backfilledAt: result.checkedAt,
          ...(result.errors.length ? { errors: result.errors } : {}),
        },
      };
      const status =
        result.nullCount === 0 ? ADMIN_REPORT_STATUSES.ok : ADMIN_REPORT_STATUSES.partial;
      const report = await reportsStore.updateReport(row.id, { payload, status });
      return { report, result };
    }

    case ADMIN_REPAIR_ACTIONS.repair_sync: {
      const failSafeService =
        deps.failSafeService ||
        require('../../../service/composition').getComposition().failSafeService;
      const result = await failSafeService.repairNode(Number(params.nodeId), {
        action: params.repairAction,
      });
      return { report: row, result, messageCode: SERVER_MESSAGE_CODES.admin.repairSyncDone };
    }

    case ADMIN_REPAIR_ACTIONS.perm_delete: {
      const nodeIdValue = Number(params.nodeId);
      if (!nodeIdValue || !Number.isInteger(nodeIdValue) || nodeIdValue <= 0) {
        throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
      }
      const trashService =
        deps.trashService || require('../../../service/composition').getComposition().trashService;
      const purge = await trashService.purgeNode(nodeIdValue);
      // Same wrapped shape as the §2.2.3 perm-delete route result.
      const result = { nodeId: nodeIdValue, deletedCount: purge.purgedNodes };
      return { report: row, result, messageCode: SERVER_MESSAGE_CODES.admin.permDeleteDone };
    }

    default:
      throw validationError(SERVER_ERROR_CODES.admin.repairNotAvailable);
  }
}

function updateReportProgressBestEffort(reportsStore, row, progress) {
  return Promise.resolve(
    reportsStore.updateReport(row.id, {
      payload: {
        ...(row.payload || {}),
        contentHashCompleteness: {
          ...((row.payload && row.payload.contentHashCompleteness) || {}),
          ...progress,
        },
      },
    })
  ).catch(() => {
    /* progress persistence never breaks the repair */
  });
}

module.exports = {
  ADMIN_REPORT_KINDS,
  ADMIN_REPORT_STATUSES,
  ADMIN_REPAIR_ACTIONS,
  DEFAULT_ADMIN_REPORTS_RETENTION_DAYS,
  createAdminReportsWriter,
  getAdminReportsWriter,
  resolveAdminReportStatus,
  shouldSkipAdminReports,
  collectContentHashCompleteness,
  backfillContentHashes,
  repairAdminReport,
};
