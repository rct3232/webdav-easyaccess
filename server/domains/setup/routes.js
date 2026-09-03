'use strict';

const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler, createError } = require('../../utils/errorHandler');
const {
  SETUP_INVALID_PAYLOAD_CODE,
  SETUP_TEST_FAILED_CODE,
  toShortReason,
  deriveReason,
  probeError,
  classifyPgError,
  runProbe,
  resolvePgPassword,
} = require('../../infrastructure/backendProbe');
const { computeSetupStatus } = require('../../infrastructure/setupStatus');
const { isSecret } = require('../../infrastructure/configRegistry');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const {
  EFFECTIVE_SECRET_MASK,
  applySetup,
  isMissing,
  normalizeEffectiveForStatus,
} = require('./setupCore');

// Thin HTTP shell over the shared apply core: payload validation, env building,
// T0/DB partition, encryption and the write orchestration live in setupCore.js,
// which the first-run CLI setup tool also consumes (docs/features/setup-cli.md).
// The prefill-only PG direct reads below stay here — they are wizard-only.

/**
 * Build the wizard-prefill `current` map from `settings` rows read directly
 * from the target metadata DB (Q1b — setup-phase reads are always direct).
 *
 * - secret keys (configRegistry `isSecret`) → masked `'****'` whenever the row
 *   exists; never plaintext, regardless of how the row is stored (encrypted
 *   payload or legacy plaintext).
 * - plaintext rows → JSON-parse when the value is a JSON string (node-pg
 *   returns JSONB already parsed, so a row stored as the JSON string `"host"`
 *   arrives as `host`); scalars are coerced to String; null/undefined skipped.
 */
function buildPrefillCurrent(rows) {
  const current = {};
  for (const row of rows) {
    const key = row && row.key;
    if (key == null) continue;
    if (isSecret(key)) {
      current[key] = EFFECTIVE_SECRET_MASK;
      continue;
    }
    let value = row.value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed !== null && typeof parsed !== 'object') value = parsed;
      } catch {
        // keep the raw string
      }
    }
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    current[key] = String(value);
  }
  return current;
}

/**
 * Read the `settings` table directly from the target PostgreSQL using the
 * credentials the operator entered in wizard step 1. Mirrors the
 * probePostgresql connection/Client pattern and reuses the same
 * classifyPgError/deriveReason error mapping so unreachable / auth / db-missing
 * failures surface with the connection-test i18n codes.
 *
 * Missing-table errors (`undefined_table` / pg code `42P01` or similar) yield
 * empty rows — a fresh PG has no `settings` table yet.
 */
async function readSettingsRows(metadata) {
  const required = ['host', 'port', 'database', 'user', 'password'];
  const missing = required.filter((key) => isMissing(metadata[key]));
  if (missing.length > 0) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      `Missing required fields: ${missing.join(', ')}`
    );
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (error) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'pg module unavailable'
    );
  }

  const client = new Client({
    host: metadata.host,
    port: Number(metadata.port) || 5432,
    database: metadata.database,
    user: metadata.user,
    password: resolvePgPassword(metadata.password),
    ssl: metadata.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
  } catch (error) {
    throw probeError(
      classifyPgError(error),
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      deriveReason(error)
    );
  }

  try {
    const result = await client.query('SELECT key, value FROM settings');
    return result.rows || [];
  } catch (error) {
    const code = String((error && error.code) || '').toUpperCase();
    const message = String((error && error.message) || '');
    if (code === '42P01' || /(does not exist|undefined_table)/i.test(message)) {
      return [];
    }
    throw probeError(
      classifyPgError(error),
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      deriveReason(error)
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function requireSetupIncomplete(req, res, next) {
  try {
    const effective = await getSharedResolver().getEffectiveConfig();
    const { setup_complete } = computeSetupStatus(process.env, {
      effectiveConfig: normalizeEffectiveForStatus(effective),
    });
    if (setup_complete) {
      return next(createError(SERVER_ERROR_CODES.setup.complete, HTTP_STATUS.FORBIDDEN));
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const router = express.Router();

// GET /api/setup/status — public, always available.
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const effective = await getSharedResolver().getEffectiveConfig();
    const status = computeSetupStatus(process.env, {
      effectiveConfig: normalizeEffectiveForStatus(effective),
    });

    res.json(status);
  })
);

// POST /api/setup/test — public; 403 setup.complete when already complete.
router.post(
  '/test',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runProbe(body.target, body);
      res.json(result);
    } catch (error) {
      const status = error.status || error.statusCode || HTTP_STATUS.BAD_REQUEST;
      const message =
        error.message && error.message !== error.errorCode
          ? error.message
          : 'Connection test failed';
      const reason = toShortReason(error.reason || (error.params && error.params.reason));
      res.status(status).json({
        ok: false,
        errorCode: error.errorCode || SETUP_TEST_FAILED_CODE,
        message,
        ...(reason ? { reason } : {}),
      });
    }
  })
);

// POST /api/setup/apply — public; 403 when already complete.
// Orchestration (validation → .env → admin password → DB settings → cache
// invalidate) lives in setupCore.applySetup.
router.post(
  '/apply',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      res.json(await applySetup(req.body));
    } catch (error) {
      // Invalid payloads are returned as the same 400 { errorCode, message,
      // fields } body the wizard always produced; genuine write errors keep
      // bubbling to the error handler.
      if (error.errorCode === SETUP_INVALID_PAYLOAD_CODE) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ errorCode: error.errorCode, message: error.message, fields: error.fields });
      }
      throw error;
    }
  })
);

// POST /api/setup/prefill — public; 403 setup.complete when already complete.
// Reads the target metadata DB `settings` rows DIRECTLY with the credentials
// entered in wizard step 1 (Q1b) and returns masked prefill values. Deliberately
// does NOT use the shared resolver / the app's own store: a no-`.env` boot runs
// on the default sqlite store, and the PG the operator enters is only reachable
// via a direct connection.
router.post(
  '/prefill',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const metadata = body.metadata;
      if (metadata == null || metadata.backend !== 'postgresql') {
        // sqlite (or missing metadata) is already prefilled from the app's own
        // store via GET /status on mount.
        return res.json({ current: {} });
      }

      const rows = await readSettingsRows(metadata);
      res.json({
        current: buildPrefillCurrent(rows),
      });
    } catch (error) {
      // Same error shape + classified codes as POST /test so the client renders
      // the existing connection-test translations.
      const status = error.status || error.statusCode || HTTP_STATUS.BAD_REQUEST;
      const message =
        error.message && error.message !== error.errorCode
          ? error.message
          : 'Connection test failed';
      const reason = toShortReason(error.reason || (error.params && error.params.reason));
      res.status(status).json({
        ok: false,
        errorCode: error.errorCode || SETUP_TEST_FAILED_CODE,
        message,
        ...(reason ? { reason } : {}),
      });
    }
  })
);

module.exports = router;
