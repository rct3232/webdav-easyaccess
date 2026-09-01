'use strict';

const express = require('express');
const {
  HTTP_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { deriveDirection, destinationTypeForDirection } = require('../../../infrastructure/adapters/blobstore/config');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const { getMigrationGate } = require('../../../infrastructure/migrationGate');
const { clearPresenceCache } = require('../../../infrastructure/metadataPresence');
const { getBackend } = require('../../../store/storage');

const VALID_MODES = ['dry-run', 'apply'];
const DEST_REQUIRED_FIELDS = {
  s3: ['bucket', 'accessKey', 'secretKey'],
  webdav: ['url', 'username', 'password'],
};

const METADATA_VALID_BACKENDS = ['postgresql', 'sqlite'];
const METADATA_PG_REQUIRED_FIELDS = ['host', 'port', 'database', 'user', 'password'];

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

/**
 * Validate and normalize the migration request payload.
 * `expectedDestType` is derived server-side from the composition's
 * fileStorageMode; a dest.type that does not match it is invalid.
 * Returns `{ errorCode }` for a 400, or `{ payload }` for a valid body.
 */
function parseMigrationPayload(body, expectedDestType) {
  const {
    mode = 'dry-run',
    force = false,
    dest,
  } = body || {};

  if (!VALID_MODES.includes(mode)) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  if (!dest || typeof dest !== 'object' || !dest.type) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }
  if (dest.type !== 's3' && dest.type !== 'webdav') {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  if (dest.type !== expectedDestType) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  const missing = DEST_REQUIRED_FIELDS[dest.type].filter((field) => !dest[field]);
  if (missing.length > 0) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }

  return {
    payload: {
      mode,
      force: Boolean(force),
      dest,
    },
  };
}

/**
 * Validate a metadata-migration start payload. The target backend must be a
 * supported backend different from the active one; connection fields must be
 * complete. Mirrors parseMigrationPayload's `{ errorCode } | { payload }`
 * contract.
 */
function parseMetadataMigrationPayload(body, activeBackend) {
  const { targetBackend, pg, sqlitePath, wipeTarget } = body || {};

  if (!METADATA_VALID_BACKENDS.includes(targetBackend)) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  if (targetBackend === activeBackend) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }

  if (targetBackend === 'postgresql') {
    if (!pg || typeof pg !== 'object') {
      return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
    }
    const missing = METADATA_PG_REQUIRED_FIELDS.filter(
      (field) => pg[field] == null || String(pg[field]).trim() === ''
    );
    if (missing.length > 0) {
      return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
    }
  } else if (sqlitePath == null || String(sqlitePath).trim() === '') {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }

  return {
    payload: {
      targetBackend,
      pg,
      sqlitePath,
      wipeTarget: Boolean(wipeTarget),
    },
  };
}

/**
 * Validate a target-scan payload. Accepts the pg connection either as a
 * nested `pg` object or as flat fields (a GET client may send query params
 * like ?targetBackend=postgresql&host=...&port=...).
 */
function parseTargetScanPayload(source) {
  const { targetBackend } = source;
  if (!METADATA_VALID_BACKENDS.includes(targetBackend)) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }

  let pg = source.pg;
  let sqlitePath = source.sqlitePath;
  if (targetBackend === 'postgresql') {
    if (!pg || typeof pg !== 'object') {
      pg = {};
      for (const field of METADATA_PG_REQUIRED_FIELDS) {
        if (source[field] != null && String(source[field]).trim() !== '') {
          pg[field] = source[field];
        }
      }
    }
    const missing = METADATA_PG_REQUIRED_FIELDS.filter(
      (field) => pg[field] == null || String(pg[field]).trim() === ''
    );
    if (missing.length > 0) {
      return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
    }
  } else if (sqlitePath == null || String(sqlitePath).trim() === '') {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }

  return { payload: { backend: targetBackend, pg, sqlitePath } };
}

/**
 * Background blob worker: drives one blob migration job to a terminal state.
 * Progress updates are written on every onProgress callback. Cancellation is
 * read from the job store (the runCopy loop checks it between nodes). On an
 * `apply` completion the destination storage config is persisted to the DB
 * (D10). The migration gate is cleared once the job is terminal.
 */
function runMigrationWorker(jobId, { destConfig, mode, force }) {
  const { getComposition } = require('../../../service/composition');
  const { migrationService, migrationJobStore } = getComposition();

  migrationJobStore.update(jobId, { status: 'running' });

  let total = 0;
  return migrationService
    .run({
      destConfig,
      mode,
      force,
      isCancelled: () => {
        const current = migrationJobStore.get(jobId);
        return Boolean(current && current.status === 'cancelled');
      },
      onProgress: ({ total: jobTotal, done, current, copied, skipped, failed }) => {
        total = jobTotal;
        migrationJobStore.update(jobId, {
          stage: 'copy',
          progress: done,
          total: jobTotal,
          current: current && current.path ? current.path : null,
          results: { copied, skipped, failed, errors: [] },
        });
      },
    })
    .then(async (results) => {
      const current = migrationJobStore.get(jobId);
      if (!current || current.status === 'cancelled') {
        migrationJobStore.update(jobId, {
          status: 'cancelled',
          progress: total,
          total,
          current: null,
          results,
        });
        return;
      }

      let configPersist = null;
      if (mode === 'apply') {
        const { persistStorageConfigToDb } = require('../services/migrationService');
        try {
          configPersist = await persistStorageConfigToDb(destConfig);
        } catch (error) {
          // F2 persist must never fail the migration itself.
          console.error(`[migration] configPersist failed for ${jobId}: ${error.message}`);
          configPersist = { persisted: [], skippedEnvSourced: [], note: error.message };
        }
      }

      migrationJobStore.update(jobId, {
        status: 'completed',
        progress: total,
        total,
        current: null,
        results,
        configPersist,
        completedAt: new Date().toISOString(),
      });
    })
    .catch((error) => {
      const current = migrationJobStore.get(jobId);
      if (current && current.status === 'cancelled') {
        migrationJobStore.update(jobId, {
          status: 'cancelled',
          results: { copied: 0, skipped: 0, failed: 0, errors: [] },
        });
        return;
      }
      migrationJobStore.update(jobId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date().toISOString(),
      });
    })
    .finally(() => {
      // A terminal migration changes which backend holds metadata, so the
      // ".env setup needed" presence cache (60s TTL) must not serve a stale
      // pre-migration snapshot to System Settings.
      clearPresenceCache();
      getMigrationGate().clear();
    });
}

/**
 * Background metadata worker: drives one metadata DB migration job. Progress
 * (stage + percent + current table) is written on every onProgress callback;
 * cancellation is read from the job store (the service ROLLBACKs the target
 * transaction). The migration gate is cleared once the job is terminal.
 */
function runMetadataMigrationWorker(jobId, { direction, target, wipeTarget }) {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();
  const metadataMigrationService = require('../services/metadataMigrationService').getService();

  migrationJobStore.update(jobId, { status: 'running' });

  return metadataMigrationService
    .runMigration({
      direction,
      target,
      wipeTarget,
      onProgress: (stage, table, done, total) => {
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        const current = migrationJobStore.get(jobId);
        const patch = {
          stage,
          progress: {
            percent,
            currentLabel: table ? `Copying ${table} … ${done}/${total}` : stage,
          },
        };
        // Never clobber a terminal/cancelled status with a progress tick: a
        // cancel that lands between ticks must stay observable to isCancelled()
        // so the copy aborts and the target transaction ROLLBACKs. Only advance
        // a non-terminal (pending/running) job to 'running'.
        if (!current || current.status === 'pending' || current.status === 'running') {
          patch.status = 'running';
        }
        migrationJobStore.update(jobId, patch);
      },
      isCancelled: () => {
        const current = migrationJobStore.get(jobId);
        return Boolean(current && current.status === 'cancelled');
      },
    })
    .then((result) => {
      if (result.status === 'cancelled') {
        migrationJobStore.update(jobId, {
          status: 'cancelled',
          stage: 'done',
          results: result,
        });
        return;
      }
      migrationJobStore.update(jobId, {
        status: 'completed',
        stage: 'done',
        progress: { percent: 100, currentLabel: null },
        results: result,
        completedAt: new Date().toISOString(),
      });
    })
    .catch((error) => {
      const current = migrationJobStore.get(jobId);
      migrationJobStore.update(jobId, {
        status: current && current.status === 'cancelled' ? 'cancelled' : 'failed',
        error: error.message,
        errorMessage: error.message,
        completedAt: new Date().toISOString(),
      });
    })
    .finally(() => {
      // See runMigrationWorker: a terminal migration changes the metadata
      // presence, so drop the TTL cache to keep the banner accurate.
      clearPresenceCache();
      getMigrationGate().clear();
    });
}

/**
 * Dispatch a background worker. The migration gate is set here (not in the
 * route) so that the WEA_SKIP_MIGRATION_WORKER test seam — which skips the
 * worker entirely — never leaves a stale active gate behind. Real migrations
 * set the gate synchronously before the 202 response and clear it in the
 * worker's terminal finally.
 */
function dispatchWorker(jobId, params) {
  // WEA_SKIP_MIGRATION_WORKER is T2 (test seam): read lazily at dispatch time.
  if (getSharedResolver().getConfigSync('WEA_SKIP_MIGRATION_WORKER') === '1') return;
  try {
    getMigrationGate().set({ type: params.type || 'blobs', jobId });
  } catch (error) {
    // A gate already active here means an inconsistent state (both route-level
    // 409 guards passed). Mark the job failed so it does not stay pending (a
    // non-terminal job never expires and would block future migrations).
    console.error(`[migration] cannot start worker for ${jobId}: ${error.message}`);
    const { migrationJobStore } = require('../../../service/composition').getComposition();
    migrationJobStore.update(jobId, {
      status: 'failed',
      errorMessage: error.message,
      completedAt: new Date().toISOString(),
    });
    return;
  }
  setImmediate(() => {
    if (params.type === 'metadata') {
      runMetadataMigrationWorker(jobId, params);
    } else {
      runMigrationWorker(jobId, params);
    }
  });
}

const router = express.Router();

// Migration info: source + direction derived from the current config
router.get('/migration/info', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { fileStorageMode } = getComposition();
  res.json({ source: fileStorageMode, direction: deriveDirection(fileStorageMode) });
}));

// Read-only scan of an explicit (non-active) metadata target backend
router.get('/migration/target-scan', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const source = { ...req.query, ...body };

  const parsed = parseTargetScanPayload(source);
  if (parsed.errorCode) {
    throw createError(parsed.errorCode, HTTP_STATUS.BAD_REQUEST);
  }

  const { backend, pg, sqlitePath } = parsed.payload;
  const metadataMigrationService = require('../services/metadataMigrationService').getService();
  const result = await metadataMigrationService.scanTarget({ backend, pg, sqlitePath });
  res.json(result);
}));

// Start a blob migration job (202 + poll contract)
router.post('/migration/blobs', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore, fileStorageMode } = getComposition();

  const direction = deriveDirection(fileStorageMode);
  const expectedDestType = destinationTypeForDirection(direction);
  const parsed = parseMigrationPayload(req.body, expectedDestType);
  if (parsed.errorCode) {
    throw createError(parsed.errorCode, HTTP_STATUS.BAD_REQUEST);
  }

  if (migrationJobStore.hasRunning()) {
    throw createError(SERVER_ERROR_CODES.admin.migrationAlreadyRunning, HTTP_STATUS.CONFLICT);
  }

  const { mode, force, dest } = parsed.payload;
  const job = migrationJobStore.create({ type: 'blobs', direction, mode });
  const destConfig = { type: dest.type, ...dest };

  dispatchWorker(job.jobId, { type: 'blobs', destConfig, mode, force });

  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job.jobId });
}));

// Start a metadata DB migration job (202 + poll contract)
router.post('/migration/metadata', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();

  if (getMigrationGate().isActive() || migrationJobStore.hasRunning()) {
    throw createError(SERVER_ERROR_CODES.admin.migrationAlreadyRunning, HTTP_STATUS.CONFLICT);
  }

  const activeBackend = getBackend();
  const parsed = parseMetadataMigrationPayload(req.body, activeBackend);
  if (parsed.errorCode) {
    throw createError(parsed.errorCode, HTTP_STATUS.BAD_REQUEST);
  }

  const { targetBackend, pg, sqlitePath, wipeTarget } = parsed.payload;
  const direction = activeBackend === 'sqlite' ? 'sqliteToPostgresql' : 'postgresqlToSqlite';

  const job = migrationJobStore.create({
    type: 'metadata',
    direction,
    mode: 'apply',
    status: 'pending',
  });

  dispatchWorker(job.jobId, {
    type: 'metadata',
    direction,
    target: { backend: targetBackend, pg, sqlitePath },
    wipeTarget,
  });

  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job.jobId });
}));

// Get migration job status/progress
router.get('/migration/jobs/:jobId', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();
  const job = migrationJobStore.get(req.params.jobId);
  if (!job) {
    throw createError(SERVER_ERROR_CODES.admin.migrationJobNotFound, HTTP_STATUS.NOT_FOUND);
  }
  res.json(job);
}));

// Cancel a running migration job (blobs: runCopy loop picks it up; metadata:
// isCancelled() aborts the transaction -> rollback)
router.post('/migration/jobs/:jobId/cancel', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();
  if (!migrationJobStore.cancel(req.params.jobId)) {
    throw createError(SERVER_ERROR_CODES.admin.migrationJobNotFound, HTTP_STATUS.NOT_FOUND);
  }
  res.json({ messageCode: SERVER_MESSAGE_CODES.admin.migrationCancelled, jobId: req.params.jobId });
}));

module.exports = router;
