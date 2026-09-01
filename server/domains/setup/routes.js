'use strict';

const path = require('path');
const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler, createError } = require('../../utils/errorHandler');
const { encryptSecret, generateKey, hasEncryptedRows } = require('../../utils/configEncryption');
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
const { resolveEnvPath } = require('../../infrastructure/envPath');
const { writeEnv } = require('../../infrastructure/envFileWriter');
const { isT0, isSecret, getDefault, TIER } = require('../../infrastructure/configRegistry');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const User = require('../../models/User');
const Settings = require('../../models/Settings');

// Mount base for the resolved env file must match server/index.js:10-12, which
// resolves against the server root (__dirname of index.js). The routes module
// lives at <server>/domains/setup, so the server root is two levels up.
const SERVER_ROOT = path.join(__dirname, '..', '..');

const METADATA_KEYS = ['backend', 'host', 'port', 'database', 'user', 'password', 'ssl', 'max'];
const S3_KEYS = [
  'backend',
  'bucket',
  'region',
  'accessKeyId',
  'secretAccessKey',
  'endpoint',
  'accessKey',
  'secretKey',
];
const WEBDAV_KEYS = ['backend', 'url', 'username', 'password', 'authType'];
const ADMIN_KEYS = ['password'];
const JWT_KEYS = ['secret', 'expiresIn'];
const SERVER_KEYS = ['port', 'corsOrigins'];
const EMAIL_KEYS = ['host', 'port', 'user', 'password', 'secure', 'fromName'];

const FILE_KEYS_UNION = [...new Set([...S3_KEYS, ...WEBDAV_KEYS])];
const TOP_LEVEL_KEYS = ['metadata', 'file', 'admin', 'jwt', 'server', 'email'];

const METADATA_T0_KEYS = [
  'WEA_STORAGE_BACKEND',
  'WEA_PG_HOST',
  'WEA_PG_PORT',
  'WEA_PG_DATABASE',
  'WEA_PG_USER',
  'WEA_PG_PASSWORD',
  'WEA_PG_SSL',
  'WEA_PG_MAX',
];

function isMissing(value) {
  return value == null || String(value).trim() === '';
}

function pickField(payload, primary, aliases) {
  if (!isMissing(payload[primary])) return payload[primary];
  for (const alias of aliases) {
    if (!isMissing(payload[alias])) return payload[alias];
  }
  return undefined;
}

function isBooleanish(value) {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(value.trim().toLowerCase());
}

function booleanToString(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 'true' : 'false';
}

function isPositiveInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1;
  if (typeof value === 'string') return /^\d+$/.test(value.trim()) && Number(value.trim()) >= 1;
  return false;
}

function isValidPort(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 65535;
  if (typeof value === 'string') {
    return /^\d+$/.test(value.trim()) && Number(value.trim()) >= 1 && Number(value.trim()) <= 65535;
  }
  return false;
}

/**
 * Records unknown keys and validates that a block is a plain object.
 * @returns {boolean} true when the block is a usable object (caller may continue)
 */
function validateBlockObject(block, allowedKeys, prefix, fields) {
  if (block == null) {
    fields[prefix] = 'required';
    return false;
  }
  if (typeof block !== 'object' || Array.isArray(block)) {
    fields[prefix] = 'invalid';
    return false;
  }
  for (const key of Object.keys(block)) {
    if (!allowedKeys.includes(key)) fields[`${prefix}.${key}`] = 'unknown';
  }
  return true;
}

function validateMetadata(block, fields) {
  if (!validateBlockObject(block, METADATA_KEYS, 'metadata', fields)) return;
  if (isMissing(block.backend)) {
    fields['metadata.backend'] = 'required';
    return;
  }
  if (block.backend !== 'sqlite' && block.backend !== 'postgresql') {
    fields['metadata.backend'] = 'invalid';
    return;
  }
  if (block.backend === 'postgresql') {
    fields.metadata = 'notAllowed';
    return;
  }
  if (block.ssl !== undefined && !isBooleanish(block.ssl)) fields['metadata.ssl'] = 'invalid';
  if (block.max !== undefined && !isPositiveInteger(block.max)) fields['metadata.max'] = 'invalid';
}

function validateFile(block, fields) {
  if (!validateBlockObject(block, FILE_KEYS_UNION, 'file', fields)) return;
  if (isMissing(block.backend)) {
    fields['file.backend'] = 'required';
    return;
  }
  if (block.backend === 's3') {
    for (const key of Object.keys(block)) {
      if (key !== 'backend' && !S3_KEYS.includes(key)) fields[`file.${key}`] = 'unknown';
    }
    if (isMissing(block.bucket)) fields['file.bucket'] = 'required';
    if (isMissing(block.region)) fields['file.region'] = 'required';
    if (isMissing(pickField(block, 'accessKeyId', ['accessKey'])))
      fields['file.accessKeyId'] = 'required';
    if (isMissing(pickField(block, 'secretAccessKey', ['secretKey'])))
      fields['file.secretAccessKey'] = 'required';
  } else if (block.backend === 'webdav') {
    for (const key of Object.keys(block)) {
      if (key !== 'backend' && !WEBDAV_KEYS.includes(key)) fields[`file.${key}`] = 'unknown';
    }
    for (const key of ['url', 'username', 'password']) {
      if (isMissing(block[key])) fields[`file.${key}`] = 'required';
    }
  } else {
    fields['file.backend'] = 'invalid';
  }
}

function validateAdmin(block, fields) {
  if (!validateBlockObject(block, ADMIN_KEYS, 'admin', fields)) return;
  if (isMissing(block.password)) fields['admin.password'] = 'required';
}

function validateJwt(block, fields) {
  if (!validateBlockObject(block, JWT_KEYS, 'jwt', fields)) return;
  if (isMissing(block.secret)) fields['jwt.secret'] = 'required';
}

function validateServer(block, fields) {
  if (block == null) return;
  if (!validateBlockObject(block, SERVER_KEYS, 'server', fields)) return;
  if (block.port !== undefined && String(block.port).trim() !== '' && !isValidPort(block.port))
    fields['server.port'] = 'invalid';
}

function validateEmail(block, fields) {
  if (block == null) return;
  if (!validateBlockObject(block, EMAIL_KEYS, 'email', fields)) return;
  if (block.port !== undefined && String(block.port).trim() !== '' && !isValidPort(block.port))
    fields['email.port'] = 'invalid';
  if (block.secure !== undefined && !isBooleanish(block.secure)) fields['email.secure'] = 'invalid';
}

function validateApplyPayload(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      errorCode: SETUP_INVALID_PAYLOAD_CODE,
      message: 'Invalid setup payload',
      fields: { body: 'invalid' },
    };
  }

  const fields = {};
  for (const key of Object.keys(body)) {
    if (!TOP_LEVEL_KEYS.includes(key)) fields[key] = 'unknown';
  }

  // D7: the DB connection is .env-owned — the metadata block is OPTIONAL. When
  // present, only sqlite is allowed (postgresql is rejected as notAllowed).
  if (body.metadata !== null && body.metadata !== undefined) {
    validateMetadata(body.metadata, fields);
  }
  validateFile(body.file, fields);
  validateAdmin(body.admin, fields);
  validateJwt(body.jwt, fields);
  validateServer(body.server, fields);
  validateEmail(body.email, fields);

  if (Object.keys(fields).length === 0) return null;
  return {
    errorCode: SETUP_INVALID_PAYLOAD_CODE,
    message:
      fields.metadata === 'notAllowed'
        ? 'PostgreSQL metadata backend is not configurable via the setup wizard; the database connection is managed by environment variables.'
        : 'Invalid setup payload',
    fields,
  };
}

function buildEnvEntries(body) {
  const entries = {};
  const { file, jwt } = body;

  entries.WEA_FILE_STORAGE = String(file.backend);
  if (file.backend === 's3') {
    entries.S3_BUCKET = String(file.bucket);
    entries.AWS_REGION = String(file.region);
    entries.AWS_ACCESS_KEY_ID = String(pickField(file, 'accessKeyId', ['accessKey']));
    entries.AWS_SECRET_ACCESS_KEY = String(pickField(file, 'secretAccessKey', ['secretKey']));
    if (!isMissing(file.endpoint)) entries.S3_ENDPOINT = String(file.endpoint);
  } else {
    entries.WEBDAV_URL = String(file.url);
    entries.WEBDAV_USERNAME = String(file.username);
    entries.WEBDAV_PASSWORD = String(file.password);
    if (!isMissing(file.authType)) entries.WEBDAV_AUTH_TYPE = String(file.authType);
  }

  entries.JWT_SECRET = String(jwt.secret);
  if (!isMissing(jwt.expiresIn)) entries.JWT_EXPIRES_IN = String(jwt.expiresIn);

  if (body.server != null) {
    if (body.server.port !== undefined && String(body.server.port).trim() !== '') {
      entries.PORT = String(body.server.port);
    }
    if (!isMissing(body.server.corsOrigins)) entries.CORS_ORIGINS = String(body.server.corsOrigins);
  }

  if (body.email != null) {
    const { email } = body;
    if (!isMissing(email.host)) entries.EMAIL_HOST = String(email.host);
    if (!isMissing(email.port)) entries.EMAIL_PORT = String(email.port);
    if (!isMissing(email.user)) entries.EMAIL_USER = String(email.user);
    if (!isMissing(email.password)) entries.EMAIL_PASSWORD = String(email.password);
    if (email.secure !== undefined) entries.EMAIL_SECURE = booleanToString(email.secure);
    if (!isMissing(email.fromName)) entries.EMAIL_FROM_NAME = String(email.fromName);
  }

  return entries;
}

/**
 * Split the full entries map into the T0 subset that must be written to .env
 * (PLAN §2 D2/D3/D4/D7 — startup-critical, .env-only) and everything else,
 * which is upserted into the metadata DB `settings` table (D11; row key = the
 * raw env var name). Classification comes from the config registry, never a
 * local allowlist, so the wizard cannot drift from the tier model.
 *
 * The metadata backend T0 keys (WEA_STORAGE_BACKEND, WEA_PG_*) are excluded
 * from the .env partition: the DB connection is `.env`-owned (D6) and the
 * wizard serves non-T0 only (D7), so they are never written by apply.
 */
function partitionEntries(entries) {
  const envEntries = {};
  const dbEntries = {};
  for (const [key, value] of Object.entries(entries)) {
    if (isT0(key)) {
      if (METADATA_T0_KEYS.includes(key)) continue;
      envEntries[key] = value;
    } else {
      dbEntries[key] = value;
    }
  }
  return { envEntries, dbEntries };
}

function encryptSecretValue(value, masterKey) {
  return JSON.stringify(encryptSecret(String(value), masterKey));
}

const EFFECTIVE_SECRET_MASK = '****';

/**
 * getEffectiveConfig() masks every secret as '****' — even one that resolves to
 * nothing (no env value, no DB row, no built-in default; configResolver spec
 * §2.6). setupStatus's presence checks run on the merged view, so an absent
 * required secret would be treated as present and dropped from `missing`.
 * Drop the mask for secrets that are genuinely unset — a T0 secret with no env
 * value (env-only source), or a DB-fallback secret with no env/DB/default — so
 * the effective view drives `missing` / `setup_complete` / `current` correctly
 * (Q1b).
 */
function normalizeEffectiveForStatus(effective) {
  const out = { ...effective };
  for (const [key, meta] of Object.entries(effective)) {
    if (!meta.secret || meta.value !== EFFECTIVE_SECRET_MASK) continue;
    const t0Unset = meta.tier === TIER.T0 && !process.env[key];
    const dbUnset = meta.source === 'default' && getDefault(key) === undefined;
    if (t0Unset || dbUnset) out[key] = { ...meta, value: undefined };
  }
  return out;
}

/**
 * Upsert non-T0 wizard values into the metadata DB through the app's own
 * Settings model (plaintext config as-is; the store JSON-stringifies on PG /
 * stores raw TEXT on sqlite; a secret is the JSON string of the encrypted
 * payload).
 */
async function writeSettings(dbEntries, masterKey) {
  for (const [key, value] of Object.entries(dbEntries)) {
    if (isSecret(key)) await Settings.set(key, encryptSecretValue(value, masterKey));
    else await Settings.set(key, value);
  }
}

async function updateAdminPassword(password) {
  const admin = await User.findByUsername('admin');
  if (!admin) {
    console.warn(
      '[setup] admin user not found; skipping direct password update (default credential applies on next boot)'
    );
    return;
  }
  await User.updatePassword(admin.id, password);
}

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

    // key-lost warning (PLAN §7): an encrypted DB secret row cannot be
    // decrypted/prefilled without the master key. Detection is shape-only — this
    // path never decrypts, so prefill cannot leak plaintext.
    const all = await Settings.getAll();

    res.json({
      ...status,
      key_lost_warning: Boolean(hasEncryptedRows(all) && !process.env.encrypt_secret_key),
    });
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
router.post(
  '/apply',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    const validation = validateApplyPayload(req.body);
    if (validation) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(validation);
    }

    const body = req.body;
    const entries = buildEnvEntries(body);

    // Masked (unchanged) secrets keep their existing DB ciphertext — the
    // only-re-encrypt-on-new-value rule (PLAN §7 / D6). The client sends the
    // prefill mask '****' for a secret it did not edit; validation accepts it
    // (non-empty) but writeSettings must NOT re-encrypt it, so drop it here.
    for (const [key, value] of Object.entries(entries)) {
      if (isSecret(key) && value === '****') delete entries[key];
    }

    const { envEntries, dbEntries } = partitionEntries(entries);

    // encrypt_secret_key lifecycle (PLAN §7): keep an existing key — never
    // regenerate it and never write it to .env. Only auto-generate when none
    // exists; the generated key is T0 / .env-only and used to encrypt this
    // apply's DB secrets.
    const masterKey = process.env.encrypt_secret_key || generateKey();
    if (!process.env.encrypt_secret_key) envEntries.encrypt_secret_key = masterKey;

    // Write .env FIRST (atomic temp-file + rename). If it fails, the DB has not
    // been touched, so boot still shows setup mode — a failed apply can never
    // leave a committed-but-error "complete" state (the non-atomic bug that
    // surfaced when a 400'd apply still left the DB configured).
    const envPath = resolveEnvPath(SERVER_ROOT);
    writeEnv(envPath, envEntries);

    // sqlite admin password update happens only after the .env write succeeded,
    // so a failure cannot leave the credential changed mid-apply.
    await updateAdminPassword(String(body.admin.password));

    await writeSettings(dbEntries, masterKey);

    // Clear the shared T2 cache so the DB writes are visible to restart-free
    // (T2) reads immediately after this apply.
    getSharedResolver().invalidateCache();

    res.json({ restart_required: true });
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
        return res.json({ current: {}, key_lost_warning: false });
      }

      const rows = await readSettingsRows(metadata);
      res.json({
        current: buildPrefillCurrent(rows),
        key_lost_warning: Boolean(hasEncryptedRows(rows) && !process.env.encrypt_secret_key),
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
