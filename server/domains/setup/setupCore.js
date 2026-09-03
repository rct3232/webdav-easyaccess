'use strict';

/**
 * Shared first-run setup apply core used by the HTTP wizard
 * (server/domains/setup/routes.js → POST /api/setup/apply) and the headless CLI
 * setup tool (server/scripts/setup.js). Extracted from the setup routes so both
 * entry points run identical validation, partitioning and apply orchestration.
 * This module is deliberately HTTP-free: it only throws typed validation errors
 * (see applySetup) and returns plain result objects.
 * @see docs/features/setup-cli.md
 */

const path = require('path');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { createError } = require('../../utils/errorHandler');
const { SETUP_INVALID_PAYLOAD_CODE } = require('../../infrastructure/backendProbe');
const { isT0, isSecret, getDefault, TIER } = require('../../infrastructure/configRegistry');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const { resolveEnvPath } = require('../../infrastructure/envPath');
const { writeEnv } = require('../../infrastructure/envFileWriter');
const User = require('../../models/User');
const Settings = require('../../models/Settings');

// Mount base for the resolved env file must match server/index.js:10-12, which
// resolves against the server root (__dirname of index.js). This module lives at
// <server>/domains/setup, so the server root is two levels up.
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

const EFFECTIVE_SECRET_MASK = '****';

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

/**
 * Validate a full wizard/CLI apply payload. Mirror of the shared payload shape
 * both entry points accept.
 * @param {*} body raw apply payload
 * @returns {null | { errorCode: string, message: string, fields: Record<string,string> }}
 *   null when the payload is valid, otherwise the 400-style error detail.
 */
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

/**
 * Build the flat key → value map from a validated apply payload.
 * @param {object} body validated apply payload
 * @returns {Record<string, string>} wizard-produced config entries
 */
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
 * @param {Record<string, string>} entries flat key → value map
 * @returns {{ envEntries: Record<string, string>, dbEntries: Record<string, string> }}
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

/**
 * Normalize the effective config so masked-but-unset secrets drive
 * `missing` / `setup_complete` / `current` correctly. See the mask-drop rule
 * explained at the call site in routes.js (Q1b).
 * @param {Record<string, object>} effective configResolver effective config
 * @returns {Record<string, object>} effective config with unset masks removed
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
 * Settings model. Values are stored as plaintext strings; the store
 * JSON-stringifies on PG / stores raw TEXT on sqlite.
 * @param {Record<string, string>} dbEntries DB-partition config entries
 */
async function writeSettings(dbEntries) {
  for (const [key, value] of Object.entries(dbEntries)) {
    await Settings.set(key, value);
  }
}

/**
 * Reset the local sqlite admin password during apply. The `.env` write happens
 * first, so a failure here cannot leave the credential changed mid-apply.
 * @param {string} password new admin password
 */
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
 * Apply a validated-or-not setup payload — the exact orchestration the HTTP
 * wizard runs on POST /api/setup/apply, minus HTTP. Designed for the CLI:
 *
 * 1. validate (same rules + message as the wizard),
 * 2. build entries, drop masked ('****') unchanged secrets,
 * 3. partition T0 (.env) vs DB-settings entries,
 * 4. write the .env FIRST,
 * 5. update the admin password, then upsert DB settings as plaintext,
 * 6. invalidate the shared resolver cache.
 *
 * @param {*} body raw apply payload
 * @returns {Promise<{ restart_required: boolean }>} success result
 * @throws {Error} typed error with `errorCode === 'serverErrors.setup.invalidPayload'`,
 *   `status === 400`, `message` and `fields` when the payload is invalid;
 *   genuine write errors bubble up unchanged.
 */
async function applySetup(body) {
  const validation = validateApplyPayload(body);
  if (validation) {
    const error = createError(validation.errorCode, HTTP_STATUS.BAD_REQUEST);
    error.message = validation.message;
    error.fields = validation.fields;
    throw error;
  }

  const entries = buildEnvEntries(body);

  // Masked (unchanged) secrets keep their existing DB value — the
  // keep-existing rule. The client sends the prefill mask '****' for a secret
  // it did not edit; validation accepts it (non-empty) but writeSettings must
  // NOT overwrite the stored value, so drop it here.
  for (const [key, value] of Object.entries(entries)) {
    if (isSecret(key) && value === '****') delete entries[key];
  }

  const { envEntries, dbEntries } = partitionEntries(entries);

  // Write .env FIRST (atomic temp-file + rename). If it fails, the DB has not
  // been touched, so boot still shows setup mode — a failed apply can never
  // leave a committed-but-error "complete" state (the non-atomic bug that
  // surfaced when a 400'd apply still left the DB configured).
  const envPath = resolveEnvPath(SERVER_ROOT);
  writeEnv(envPath, envEntries);

  // sqlite admin password update happens only after the .env write succeeded,
  // so a failure cannot leave the credential changed mid-apply.
  await updateAdminPassword(String(body.admin.password));

  await writeSettings(dbEntries);

  // Clear the shared T2 cache so the DB writes are visible to restart-free
  // (T2) reads immediately after this apply.
  getSharedResolver().invalidateCache();

  return { restart_required: true };
}

module.exports = {
  EFFECTIVE_SECRET_MASK,
  applySetup,
  buildEnvEntries,
  isMissing,
  normalizeEffectiveForStatus,
  partitionEntries,
  validateApplyPayload,
};
