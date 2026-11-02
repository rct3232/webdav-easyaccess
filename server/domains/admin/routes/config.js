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
const { getLlmAdapter } = require('../../../infrastructure/llmAdapterRuntime');
const {
  TIER,
  getEntry,
  isT0,
  isTier,
  isSecret,
} = require('../../../infrastructure/configRegistry');
const { buildConfigSyncReport, syncConfigSyncEnv } = require('../services/configSyncService');
const { commitSettingChange, isCuratedSettingKey } = require('../services/settingsJournalService');
const { ensureLlmProbeTarget } = require('../../../infrastructure/adapters/llm/probe');
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
    WEA_DB_HOST: 'host',
    WEA_DB_PORT: 'port',
    WEA_DB_DATABASE: 'database',
    WEA_DB_USER: 'user',
    WEA_DB_PASSWORD: 'password',
    WEA_DB_SSL: 'ssl',
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

const LLM_PROBE_ROLE_KEYS = {
  chat: ['LLM_CHAT_BASE_URL', 'LLM_CHAT_API_KEY', 'LLM_CHAT_MODEL'],
  vision: ['LLM_VISION_BASE_URL', 'LLM_VISION_API_KEY', 'LLM_VISION_MODEL'],
  asr: ['LLM_ASR_BASE_URL', 'LLM_ASR_API_KEY', 'LLM_ASR_MODEL'],
};

/**
 * LLM probe payload: explicit overrides win; missing credentials resolve from
 * the config resolver server-side, so a masked client value never becomes the
 * probe secret. The client only needs to send `{ role }`.
 */
function buildLlmProbePayload(pending) {
  const role = String(pending.role || '');
  const keys = LLM_PROBE_ROLE_KEYS[role];
  if (!keys) return { role };
  const resolver = getSharedResolver();
  const resolveKey = (key) => {
    const explicit = pending[key] ?? pending[toCamelProbeField(key)];
    if (explicit !== undefined && explicit !== null && explicit !== SECRET_MASK) return explicit;
    return typeof resolver.getConfigSync === 'function' ? resolver.getConfigSync(key) : undefined;
  };
  return {
    role,
    baseUrl: resolveKey(keys[0]),
    apiKey: resolveKey(keys[1]),
    model: resolveKey(keys[2]),
  };
}

function toCamelProbeField(key) {
  if (key.endsWith('_BASE_URL')) return 'baseUrl';
  if (key.endsWith('_API_KEY')) return 'apiKey';
  return 'model';
}

// Fields that turn an LLM config test into a PENDING-value test. Only a test
// against the stored config may republish the adapter capability matrix.
const LLM_PROBE_OVERRIDE_KEYS = {
  chat: ['LLM_CHAT_BASE_URL', 'LLM_CHAT_API_KEY', 'LLM_CHAT_MODEL', 'baseUrl', 'apiKey', 'model'],
  vision: [
    'LLM_VISION_BASE_URL',
    'LLM_VISION_API_KEY',
    'LLM_VISION_MODEL',
    'baseUrl',
    'apiKey',
    'model',
  ],
  asr: ['LLM_ASR_BASE_URL', 'LLM_ASR_API_KEY', 'LLM_ASR_MODEL', 'baseUrl', 'apiKey', 'model'],
};

function hasLlmProbeOverrides(role, pending) {
  const keys = LLM_PROBE_OVERRIDE_KEYS[role] || [];
  return keys.some((key) => {
    const value = pending[key];
    return value !== undefined && value !== null && value !== '' && value !== SECRET_MASK;
  });
}

// Middleware to check if user is admin (same pattern as settings.js)
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Stateless admin check for GET /api/admin/health only: trusts the JWT
// is_admin claim (set by authenticateToken) instead of a DB-backed
// User.findById lookup, so the health snapshot stays reachable during a
// metadata-DB outage and the admin health card can render the failure.
const isAdminFromToken = asyncHandler(async (req, res, next) => {
  if (!req.user?.is_admin) {
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
      } else if (isCuratedSettingKey(key)) {
        // Curated AI governance keys journal their previous value in the same
        // TX as the write (settings-domain undo feed). Never secrets.
        await commitSettingChange({ key, value: String(value), actor: req.user.id });
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

    // LLM role lifecycle: a role configured for the first time after boot has
    // no prior adapter signature, so it must be registered/probed explicitly.
    // Best-effort: registry reconciliation never fails the config write.
    if (changedKeys.some((key) => key.startsWith('LLM_'))) {
      const adapter = getLlmAdapter();
      if (adapter && typeof adapter.reconcileConfiguredRoles === 'function') {
        try {
          await adapter.reconcileConfiguredRoles();
        } catch {
          /* registry reconciliation must never fail the config write */
        }
      }
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
      if (target === 'llm') ensureLlmProbeTarget();
      const effective = await getSharedResolver().getEffectiveConfig();
      const probePayload =
        target === 'llm'
          ? buildLlmProbePayload(pending)
          : buildProbePayload(target, pending, effective);
      const result = await runProbe(target, probePayload);

      // A successful manual LLM test against the STORED config must also
      // publish the capability matrix; the AI dashboard reads probeState, not
      // this route's one-shot health report. Pending-value tests are excluded
      // (their values are not the active config).
      if (target === 'llm') {
        const role = String(pending.role || '');
        if (['chat', 'vision', 'asr'].includes(role) && !hasLlmProbeOverrides(role, pending)) {
          const adapter = getLlmAdapter();
          try {
            if (adapter && typeof adapter.publishRoleProbeOutcome === 'function') {
              await adapter.publishRoleProbeOutcome(role, result);
            } else if (adapter && typeof adapter.probeRole === 'function') {
              await adapter.probeRole(role);
            }
          } catch {
            /* capability republish is best-effort; the test result stands */
          }
        }
      }

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
// Stateless token-claim admin check (no DB read) so it works during a DB outage.
router.get('/health', authenticateToken, isAdminFromToken, (req, res) => {
  const backends = getBackendHealth().getHealth();
  // vectorStore seam wire value (vectorStore.md §1, routes/admin.md §2.7):
  // native when the boot probe selected a native adapter, fallback_js
  // otherwise (the JS fallback is a performance warning, never a feature gate).
  const vectorOps = backends.vector && backends.vector.status === 'ok' ? 'native' : 'fallback_js';
  res.json({ backends, vectorOps });
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
    const envValueOf = (key) => (effective[key]?.source === 'env' ? process.env[key] : undefined);
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
    const envValueOf = (key) => (effective[key]?.source === 'env' ? process.env[key] : undefined);

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

// AI governance surface + unified re-embed launcher. Mounted here (the config
// module is already mounted at /api/admin) so server/index.js stays untouched;
// final paths are /api/admin/ai/*.
router.use('/ai', require('./ai'));

module.exports = router;
