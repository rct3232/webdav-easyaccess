const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const Settings = require('../../../models/Settings');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const {
  TIER,
  getEntry,
  isT0,
  isTier,
  isSecret,
} = require('../../../infrastructure/configRegistry');
const {
  buildConfigSyncReport,
  syncConfigSyncEnv,
} = require('../services/configSyncService');
const {
  runProbe,
  classifyToHealthCode,
  toShortReason,
  SETUP_TEST_FAILED_CODE,
} = require('../../../infrastructure/backendProbe');
const { getBackendHealth } = require('../../../infrastructure/backendHealth');

const SECRET_MASK = '****';

// Registry key -> probe payload field per target (probe machinery in
// backendProbe.js reads lowercase field names; the config editor sends
// registry env keys). Effective values for secrets are masked ('****'), so
// the real stored value is resolved through the resolver before probing.
const TARGET_CONNECTION_FIELDS = {
  postgresql: {
    WEA_PG_HOST: 'host',
    WEA_PG_PORT: 'port',
    WEA_PG_DATABASE: 'database',
    WEA_PG_USER: 'user',
    WEA_PG_PASSWORD: 'password',
    WEA_PG_SSL: 'ssl',
  },
  s3: {
    S3_BUCKET: 'bucket',
    AWS_REGION: 'region',
    AWS_ACCESS_KEY_ID: 'accessKeyId',
    AWS_SECRET_ACCESS_KEY: 'secretAccessKey',
    S3_ENDPOINT: 'endpoint',
  },
  webdav: {
    WEBDAV_URL: 'url',
    WEBDAV_USERNAME: 'username',
    WEBDAV_PASSWORD: 'password',
    WEBDAV_AUTH_TYPE: 'authType',
  },
};

function stringifyConfigValue(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null) return undefined;
  return String(value);
}

// Merge pending registry keys over the current effective config, translate to
// the probe field namespace, and resolve masked secrets to the stored value.
function buildProbePayload(target, pending, effective) {
  const fieldMap = TARGET_CONNECTION_FIELDS[target] || {};
  const payload = {};

  for (const [key, entry] of Object.entries(effective)) {
    const field = fieldMap[key];
    if (!field) continue;
    if (entry.value === undefined) continue;
    const seeded = stringifyConfigValue(entry.value);
    payload[field] =
      seeded === SECRET_MASK ? (getSharedResolver().getConfigSync(key) ?? SECRET_MASK) : seeded;
  }

  for (const [key, value] of Object.entries(pending)) {
    if (value === undefined || value === null) continue;
    const field = fieldMap[key];
    if (field) {
      const seeded = stringifyConfigValue(value);
      payload[field] =
        seeded === SECRET_MASK ? (getSharedResolver().getConfigSync(key) ?? SECRET_MASK) : seeded;
    } else {
      // Pass through raw probe-field names (wizard-style payloads) untouched.
      payload[key] = value;
    }
  }

  return payload;
}

// Middleware to check if user is admin (same pattern as settings.js)
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get effective config (masked secrets, source/tier/secret per registry key).
router.get(
  '/config',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const config = await getSharedResolver().getEffectiveConfig();
    res.json({ config });
  })
);

// Update allowlisted config keys (write plaintext to DB, invalidate T2 cache)
router.put(
  '/config',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { values } = req.body;

    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw createError(SERVER_ERROR_CODES.admin.configInvalidPayload, HTTP_STATUS.BAD_REQUEST);
    }

    // Snapshot the current effective source per key so env-sourced writes can be
    // rejected (F4). getEffectiveConfig() primes the shared cache as a side
    // effect, which keeps the resolver consistent for the writes below.
    const current = await getSharedResolver().getEffectiveConfig();

    const applied = [];
    const restartRequired = [];
    const changedKeys = [];

    for (const [key, value] of Object.entries(values)) {
      if (!getEntry(key)) {
        throw createError(SERVER_ERROR_CODES.admin.configUnknownKey, HTTP_STATUS.BAD_REQUEST, {
          key,
        });
      }
      if (isT0(key)) {
        throw createError(SERVER_ERROR_CODES.admin.configT0Protected, HTTP_STATUS.BAD_REQUEST, {
          key,
        });
      }
      if (current[key]?.source === 'env') {
        throw createError(
          SERVER_ERROR_CODES.admin.configEnvSourcedProtected,
          HTTP_STATUS.BAD_REQUEST,
          { key }
        );
      }

      if (isSecret(key)) {
        // Masked/blank secret keeps its existing stored value (keep-existing).
        if (value === undefined || value === null || value === '' || value === '****') {
          continue;
        }
        await Settings.set(key, String(value));
      } else {
        await Settings.set(key, String(value));
      }

      changedKeys.push(key);
      if (isTier(key, TIER.T2)) {
        applied.push(key);
      } else {
        restartRequired.push(key);
      }
    }

    if (changedKeys.length > 0) {
      getSharedResolver().invalidateCache(changedKeys);
    }

    res.json({
      applied,
      restartRequired,
      messageCode: SERVER_MESSAGE_CODES.admin.configSaved,
    });
  })
);

// Connection test with pending values (D1 save gating). The client sends a
// subset of pending registry keys for the target backend; the server merges
// them over the current effective config before probing and records the
// outcome to the backend-health tracker.
router.post(
  '/config/test',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const { target } = body;
    const pending = { ...body };
    delete pending.target;

    try {
      const effective = await getSharedResolver().getEffectiveConfig();
      const result = await runProbe(target, buildProbePayload(target, pending, effective));
      getBackendHealth().report(target, { ok: true });
      res.json(result);
    } catch (error) {
      const status = error.status || error.statusCode || HTTP_STATUS.BAD_REQUEST;
      const message =
        error.message && error.message !== error.errorCode
          ? error.message
          : 'Connection test failed';
      const reason = toShortReason(error.reason || (error.params && error.params.reason));

      getBackendHealth().report(target, {
        ok: false,
        code: classifyToHealthCode(target, error.errorCode),
        ...(reason ? { reason } : {}),
      });

      res.status(status).json({
        ok: false,
        errorCode: error.errorCode || SETUP_TEST_FAILED_CODE,
        message,
        ...(reason ? { reason } : {}),
      });
    }
  })
);

// Admin health snapshot: full per-backend tracker state (code/hint/lastChecked).
router.get('/health', authenticateToken, isAdmin, (req, res) => {
  res.json({ backends: getBackendHealth().getHealth() });
});

// Env↔DB config-sync report (read-only). The env source is the running process
// environment, classified through the config resolver (source: 'env'); the .env
// file on disk is never read. Mirrors the CLI --check algorithm over the shared
// core (configSyncService) — same findings/summary/exitCode JSON.
router.get(
  '/config/sync-report',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const effective = await getSharedResolver().getEffectiveConfig();
    const envValueOf = (key) =>
      effective[key]?.source === 'env' ? process.env[key] : undefined;
    const report = await buildConfigSyncReport({
      settings: Settings,
      envValueOf,
    });
    res.json(report);
  })
);

// Env→DB config-sync reconcile — the web equivalent of the CLI --apply --yes.
// Writes env-sourced non-T0 registry values into the DB settings rows as
// plaintext (secrets included), then invalidates the resolver T2 cache for the
// written keys so the running server observes them immediately.
router.post(
  '/config/sync-from-env',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const resolver = getSharedResolver();
    const effective = await resolver.getEffectiveConfig();
    const envValueOf = (key) =>
      effective[key]?.source === 'env' ? process.env[key] : undefined;

    const result = await syncConfigSyncEnv({
      settings: Settings,
      envValueOf,
    });

    const changedKeys = result.writes.filter((w) => w.status === 'updated').map((w) => w.key);
    if (changedKeys.length > 0) {
      resolver.invalidateCache(changedKeys);
    }

    res.json({
      writes: result.writes,
      report: result.report,
      messageCode: SERVER_MESSAGE_CODES.admin.configSyncDone,
    });
  })
);

module.exports = router;
